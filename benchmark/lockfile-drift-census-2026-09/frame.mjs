// Builds a FROZEN, reproducible sample frame from the GitHub Search API.
// Design: the sample is the union of strata that are each enumerated COMPLETELY
// (every stratum query returns total_count <= 1000, the Search API page cap), so
// there is no "top N by stars" convenience bias inside a stratum. Strata that are
// too large are recursively split by creation date until they fit.
import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";

const PUSHED_SINCE = "2026-03-21";   // active in the last 6 months
const FROZEN_AT = new Date().toISOString();
const OUT = "data/frame.jsonl";
const LOG = "data/frame-strata.json";
const MAX_PER_STRATUM = 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function api(path) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return JSON.parse(execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path],
        { encoding: "utf8", maxBuffer: 1 << 28 }));
    } catch (e) {
      const msg = String(e.stderr || e.message);
      if (attempt === 5) throw new Error(msg.slice(0, 300));
      const wait = /rate limit|secondary|403|429/i.test(msg) ? 25000 : 4000;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}
const q = (s) => encodeURIComponent(s);
function count(query) { const r = api(`/search/repositories?q=${q(query)}&per_page=1`); return r.total_count; }
function enumerate(query) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = api(`/search/repositories?q=${q(query)}&per_page=100&page=${page}&sort=updated&order=desc`);
    out.push(...r.items);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2200);
    if (r.items.length < 100) break;
  }
  return out;
}

const YEAR_SPLITS = [
  "created:<2019-01-01", "created:2019-01-01..2020-12-31", "created:2021-01-01..2021-12-31",
  "created:2022-01-01..2022-12-31", "created:2023-01-01..2023-12-31", "created:2024-01-01..2024-06-30",
  "created:2024-07-01..2024-12-31", "created:2025-01-01..2025-06-30", "created:2025-07-01..2025-12-31",
  "created:>=2026-01-01",
];
const HALF_SPLITS = { // second-level split when a year is still too big
  "created:2023-01-01..2023-12-31": ["created:2023-01-01..2023-06-30","created:2023-07-01..2023-12-31"],
  "created:2022-01-01..2022-12-31": ["created:2022-01-01..2022-06-30","created:2022-07-01..2022-12-31"],
  "created:2021-01-01..2021-12-31": ["created:2021-01-01..2021-06-30","created:2021-07-01..2021-12-31"],
  "created:<2019-01-01": ["created:<2016-01-01","created:2016-01-01..2017-12-31","created:2018-01-01..2018-12-31"],
  "created:2019-01-01..2020-12-31": ["created:2019-01-01..2019-12-31","created:2020-01-01..2020-12-31"],
  "created:>=2026-01-01": ["created:2026-01-01..2026-03-31","created:2026-04-01..2026-06-30","created:>=2026-07-01"],
};

const LANGS = ["JavaScript", "TypeScript"];
const BANDS = process.env.BANDS ? JSON.parse(process.env.BANDS)
  : ["stars:>=5000","stars:1500..4999","stars:500..1499","stars:150..499","stars:50..149","stars:20..49"];

const base = `pushed:>=${PUSHED_SINCE} archived:false fork:false is:public`;
const strata = [];
const seen = new Set();
if (existsSync(OUT)) { for (const l of readFileSync(OUT,"utf8").split("\n")) if (l.trim()) seen.add(JSON.parse(l).full_name); }

for (const lang of LANGS) for (const band of BANDS) {
  const root = `${base} language:${lang} ${band}`;
  const total = count(root);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2200);
  let queries;
  if (total <= MAX_PER_STRATUM) queries = [root];
  else {
    queries = [];
    for (const y of YEAR_SPLITS) {
      const sub = `${root} ${y}`;
      const t = count(sub);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2200);
      if (t === 0) continue;
      if (t <= MAX_PER_STRATUM) queries.push(sub);
      else for (const h of (HALF_SPLITS[y] || [y])) queries.push(`${root} ${h}`);
    }
  }
  for (const query of queries) {
    const t = count(query);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2200);
    const items = enumerate(query);
    const complete = t <= MAX_PER_STRATUM && items.length >= Math.min(t, 1000);
    strata.push({ lang, band, query, total_count: t, retrieved: items.length, complete });
    let added = 0;
    for (const it of items) {
      if (seen.has(it.full_name)) continue;
      seen.add(it.full_name); added++;
      appendFileSync(OUT, JSON.stringify({
        full_name: it.full_name, default_branch: it.default_branch, stars: it.stargazers_count,
        language: it.language, pushed_at: it.pushed_at, created_at: it.created_at, size_kb: it.size,
        license: it.license?.spdx_id ?? null, fork: it.fork, stratum: query,
      }) + "\n");
    }
    console.log(`${complete?"OK ":"PARTIAL"} n=${items.length} new=${added} total_count=${t}  ${query}`);
    writeFileSync(LOG, JSON.stringify({ frozen_at: FROZEN_AT, pushed_since: PUSHED_SINCE, max_per_stratum: MAX_PER_STRATUM, strata }, null, 2));
  }
}
console.log(`\nFRAME SIZE: ${seen.size}`);
