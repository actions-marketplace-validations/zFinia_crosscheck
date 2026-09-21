// Re-enumerates any stratum the first pass did not retrieve completely.
// A stratum whose page requests transiently returned nothing would otherwise
// drop its whole population out of the frame without trace.
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
const OUT = "data/frame.jsonl", LOG = "data/frame-strata.json";
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function api(path) {
  for (let a = 0; a < 8; a++) {
    try { return JSON.parse(execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], { encoding: "utf8", maxBuffer: 1 << 28 })); }
    catch (e) { if (a === 7) throw new Error(String(e.stderr || e.message).slice(0, 200)); wait(/rate limit|secondary|403|429/i.test(String(e.stderr)) ? 30000 : 5000); }
  }
}
const q = (s) => encodeURIComponent(s);
const meta = JSON.parse(readFileSync(LOG, "utf8"));
const seen = new Set(readFileSync(OUT, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).full_name));
const before = seen.size;

for (const s of meta.strata) {
  if (s.complete) continue;
  if (s.retrieved >= 1000) continue;              // genuinely larger than the page cap; keep flagged
  console.log(`recovering: ${s.query}  (had ${s.retrieved}/${s.total_count})`);
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const r = api(`/search/repositories?q=${q(s.query)}&per_page=100&page=${page}&sort=updated&order=desc`);
    items.push(...r.items); wait(2500);
    if (r.items.length < 100) break;
  }
  let added = 0;
  for (const it of items) {
    if (seen.has(it.full_name)) continue;
    seen.add(it.full_name); added++;
    appendFileSync(OUT, JSON.stringify({
      full_name: it.full_name, default_branch: it.default_branch, stars: it.stargazers_count,
      language: it.language, pushed_at: it.pushed_at, created_at: it.created_at, size_kb: it.size,
      license: it.license?.spdx_id ?? null, fork: it.fork, stratum: s.query,
    }) + "\n");
  }
  s.retrieved = items.length;
  s.complete = s.total_count <= 1000 && items.length >= Math.min(s.total_count, 1000);
  s.recovered = true;
  console.log(`  -> retrieved ${items.length}, new ${added}, complete=${s.complete}`);
  writeFileSync(LOG, JSON.stringify(meta, null, 2));
}
console.log(`frame ${before} -> ${seen.size}`);
