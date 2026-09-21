// Draws a reproducible, proportionally-allocated stratified random sample.
// Proportional allocation makes the design self-weighting: the sample proportion
// is an unbiased estimate of the population proportion, with no post-hoc weights.
import { readFileSync, writeFileSync } from "node:fs";
import { readJsonlText } from "./lib/jsonl.mjs";
const SEED = Number(process.env.SEED || 20260921);
const TARGET = Number(process.env.TARGET || 6000);
const FRAME = process.env.FRAME || "data/frame.jsonl";
const OUT = process.env.OUT || "data/sample.jsonl";

// mulberry32: small, fully specified, so anyone can reproduce this exact draw.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

const rows = readJsonlText(FRAME).split("\n").filter(Boolean).map(JSON.parse);
const strataMeta = JSON.parse(readFileSync("data/frame-strata.json", "utf8"));
const completeOf = new Map(strataMeta.strata.map(s => [s.query, s.complete]));

const byStratum = new Map();
for (const r of rows) {
  if (!byStratum.has(r.stratum)) byStratum.set(r.stratum, []);
  byStratum.get(r.stratum).push(r);
}
const total = rows.length;
const picked = [];
const alloc = [];
for (const [stratum, list] of [...byStratum.entries()].sort()) {
  const want = Math.min(list.length, Math.max(5, Math.round(TARGET * list.length / total)));
  // Fisher-Yates on a copy, driven by the seeded PRNG: deterministic given SEED.
  const idx = list.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  for (const i of idx.slice(0, want)) picked.push({ ...list[i], stratum_complete: completeOf.get(stratum) ?? null });
  alloc.push({ stratum, population: list.length, sampled: want, complete: completeOf.get(stratum) ?? null });
}
writeFileSync(OUT, picked.map(p => JSON.stringify(p)).join("\n") + "\n");
writeFileSync("data/sample-allocation.json", JSON.stringify({
  seed: SEED, target: TARGET, algorithm: "mulberry32 + Fisher-Yates, proportional allocation, min 5 per stratum",
  frame_size: total, sample_size: picked.length, strata: alloc }, null, 2));
console.log(`frame=${total} strata=${byStratum.size} sample=${picked.length}`);
