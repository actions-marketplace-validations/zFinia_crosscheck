// Turns raw/scan.jsonl into the published tables. Every number here is derived
// from the raw file and can be recomputed by running this script again.
import { readFileSync, writeFileSync } from "node:fs";
import { readJsonlText } from "./lib/jsonl.mjs";
const RAW = process.env.RAW || "raw/scan.jsonl";
const SAMPLE = process.env.SAMPLE || "data/sample.jsonl";

const inSample = new Set(readFileSync(SAMPLE, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).full_name));
const seen = new Set();
const rows = [];
for (const l of readJsonlText(RAW).split("\n")) {
  if (!l.trim()) continue;
  const r = JSON.parse(l);
  if (!inSample.has(r.full_name) || seen.has(r.full_name)) continue;   // sample members only, once each
  seen.add(r.full_name); rows.push(r);
}

// Wilson score interval: well-behaved for the small proportions we report.
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
const pct = (x) => (100 * x).toFixed(2);
const rate = (k, n) => { const [lo, hi] = wilson(k, n); return { k, n, pct: +(100 * k / n).toFixed(2), ci95: [+pct(lo), +pct(hi)] }; };

const ok = rows.filter(r => r.ok);
const errs = rows.filter(r => !r.ok);
// The denominator throughout: repositories that actually contain a package.json,
// i.e. the ones CrossCheck's package-manager rule can say anything about.
const js = ok.filter(r => r.relevant_paths.some(p => p === "package.json" || p.endsWith("/package.json")));

const PM = "package-manager/conflicting-config";
const hasPM = (r) => r.findings_default.some(f => f.rule === PM);
const hasInstr = (r) => r.instruction_files.length > 0;
// NOT r.packages[].packageManager: the engine decides that from a lockfile OR
// the field, so it answers "is a manager established?", not "is it declared?".
const declaresPM = (r) => (r.package_manager_fields ?? []).length > 0;
const managerEstablished = (r) => r.packages.some((p) => p.packageManager);
const lockManagers = (r) => new Set(r.lockfiles.map(p => p.split("/").pop())
  .map(b => ({ "package-lock.json": "npm", "npm-shrinkwrap.json": "npm", "pnpm-lock.yaml": "pnpm",
               "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun" })[b]).filter(Boolean));

const band = (s) => s >= 5000 ? "5000+" : s >= 1500 ? "1500-4999" : s >= 500 ? "500-1499"
  : s >= 150 ? "150-499" : s >= 50 ? "50-149" : "20-49";
// Individual years before 2015 hold single-digit counts whose intervals span
// almost the whole range, which is noise rather than a finding. Bucket them.
const year = (d) => { const y = Number(String(d || "").slice(0, 4)); return !y ? "?" : y < 2015 ? "before 2015" : String(y); };
const YEAR_ORDER = ["before 2015", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];

const BAND_ORDER = ["20-49", "50-149", "150-499", "500-1499", "1500-4999", "5000+"];
const group = (list, key, pred, order) => {
  const m = new Map();
  for (const r of list) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  const rank = (k) => (order ? (order.indexOf(k) < 0 ? 999 : order.indexOf(k)) : 0);
  return [...m.entries()]
    .sort((x, y) => rank(x[0]) - rank(y[0]) || (x[0] < y[0] ? -1 : 1))
    .map(([k, v]) => ({ key: k, ...rate(v.filter(pred).length, v.length) }));
};

// Two-proportion z-test. Published so a cohort difference is reported as
// significant or not, rather than left to eyeballing overlapping intervals.
function twoProportionTest(k1, n1, k2, n2) {
  if (!n1 || !n2) return null;
  const p1 = k1 / n1, p2 = k2 / n2, p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return null;
  const z = (p1 - p2) / se;
  // Two-sided p from the normal CDF (Abramowitz & Stegun 7.1.26 erf approximation).
  const erf = (x) => {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  const pValue = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { z: +z.toFixed(3), p_value: +pValue.toFixed(4), significant_at_05: pValue < 0.05,
           difference_pp: +(100 * (p1 - p2)).toFixed(2) };
}

// How much of the population the stratum queries reported does the frame actually
// hold? Strata that exceed the Search API's 1000-result cap contribute only 1000,
// so the frame under-represents exactly those cells. Stated as a number, not prose.
const strataMeta = JSON.parse(readFileSync("data/frame-strata.json", "utf8"));
const reportedPopulation = strataMeta.strata.reduce((a, s) => a + s.total_count, 0);
const retrieved = strataMeta.strata.reduce((a, s) => a + Math.min(s.retrieved, s.total_count), 0);
const cappedStrata = strataMeta.strata.filter((s) => !s.complete);

const report = {
  generated_at: new Date().toISOString(),
  engine_version: ok[0]?.engine ?? null,
  frame_coverage: {
    reported_population: reportedPopulation,
    retrieved,
    pct: +(100 * retrieved / reportedPopulation).toFixed(2),
    capped_strata: cappedStrata.length,
    capped_detail: cappedStrata.map((s) => ({ query: s.query, retrieved: s.retrieved, total_count: s.total_count })),
  },
  coverage: {
    sample_size: inSample.size, scanned: rows.length, ok: ok.length, failed: errs.length,
    with_package_json: js.length,
    failure_reasons: Object.entries(errs.reduce((a, r) => { const k = r.error.slice(0, 40); a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8),
  },
  headline: {
    contradictory_package_manager_config: rate(js.filter(hasPM).length, js.length),
    two_or_more_lockfile_managers_anywhere: rate(js.filter(r => lockManagers(r).size > 1).length, js.length),
    declares_packageManager_field: rate(js.filter(declaresPM).length, js.length),
    package_manager_established: rate(js.filter(managerEstablished).length, js.length),
    invalid_package_json: rate(js.filter(r => r.findings_default.some(f => f.rule === "manifest/invalid-json")).length, js.length),
    has_agent_instruction_file: rate(js.filter(hasInstr).length, js.length),
  },
  by_star_band: group(js, r => band(r.stars), hasPM, BAND_ORDER),
  by_language: group(js, r => r.language || "?", hasPM),
  by_created_year: group(js, r => year(r.created_at), hasPM, YEAR_ORDER),
  by_agent_instructions: [
    { key: "has agent instruction file", ...rate(js.filter(r => hasInstr(r) && hasPM(r)).length, js.filter(hasInstr).length) },
    { key: "no agent instruction file", ...rate(js.filter(r => !hasInstr(r) && hasPM(r)).length, js.filter(r => !hasInstr(r)).length) },
  ],
  // Does declaring "packageManager" coincide with fewer contradictions?
  by_packageManager_field: [
    { key: 'declares "packageManager"', ...rate(js.filter(r => declaresPM(r) && hasPM(r)).length, js.filter(declaresPM).length) },
    { key: "does not declare it", ...rate(js.filter(r => !declaresPM(r) && hasPM(r)).length, js.filter(r => !declaresPM(r)).length) },
  ],
  // A contradiction is NOT a subset of "two lockfiles somewhere": it can also come
  // from a single lockfile disagreeing with the "packageManager" field, and two
  // lockfiles in different packages of a monorepo are not a contradiction. These
  // two counts decompose the headline so the prose can stay accurate.
  contradiction_shape: (() => {
    const c = js.filter(hasPM);
    const twoLocks = c.filter((r) => lockManagers(r).size > 1).length;
    return {
      total: c.length,
      two_lockfile_managers: twoLocks,
      single_lockfile_vs_packageManager_field: c.length - twoLocks,
      also_counted_in_two_lockfile_row: twoLocks,
    };
  })(),
  // Significance tests for the two cohort comparisons the page makes, so neither
  // is reported as a difference when the data cannot support one.
  cohort_tests: {
    agent_instructions: (() => {
      const withI = js.filter(hasInstr), withoutI = js.filter((r) => !hasInstr(r));
      return twoProportionTest(withI.filter(hasPM).length, withI.length, withoutI.filter(hasPM).length, withoutI.length);
    })(),
    packageManager_field: (() => {
      const withF = js.filter(declaresPM), withoutF = js.filter((r) => !declaresPM(r));
      return twoProportionTest(withF.filter(hasPM).length, withF.length, withoutF.filter(hasPM).length, withoutF.length);
    })(),
    language: (() => {
      const ts = js.filter((r) => r.language === "TypeScript"), jsl = js.filter((r) => r.language === "JavaScript");
      return twoProportionTest(ts.filter(hasPM).length, ts.length, jsl.filter(hasPM).length, jsl.length);
    })(),
  },
  conflict_pairs: Object.entries(js.filter(hasPM).flatMap(r => r.findings_default.filter(f => f.rule === PM).map(f => f.values.join(" + ")))
    .reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]),
  monorepo: {
    note: "A finding is raised inside one package scope, so a monorepo is not penalised for two packages choosing differently.",
    findings_in_root_scope: js.flatMap(r => r.findings_default.filter(f => f.rule === PM && f.scope === "")).length,
    findings_in_sub_scope: js.flatMap(r => r.findings_default.filter(f => f.rule === PM && f.scope !== "")).length,
  },
  install_step_evidence: (() => {
    const conflicted = js.filter(hasPM);
    const withInstall = conflicted.filter(r => r.findings_default.some(f => f.rule === PM && f.evidence.some(e => String(e.kind).startsWith("install-command"))));
    return { conflicted: conflicted.length, with_cited_install_steps: withInstall.length,
      pct: conflicted.length ? +(100 * withInstall.length / conflicted.length).toFixed(2) : 0 };
  })(),
  experimental_only_rules: Object.entries(js.flatMap(r => r.findings_experimental_only.map(f => f.rule))
    .reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]),
};
writeFileSync("data/report.json", JSON.stringify(report, null, 2));

// Every default finding, with a permalink to each cited file at the frozen commit,
// so a reader can check any single one without running anything.
const findings = [];
for (const r of js) for (const f of r.findings_default) {
  findings.push({ repo: r.full_name, sha: r.sha, rule: f.rule, scope: f.scope, values: f.values,
    stars: r.stars, language: r.language, has_agent_instructions: r.instruction_files.length > 0,
    evidence: f.evidence.map(e => ({ ...e, url: `https://github.com/${r.full_name}/blob/${r.sha}/${e.source}${e.line ? `#L${e.line}` : ""}` })) });
}
writeFileSync("data/findings.jsonl", findings.map(f => JSON.stringify(f)).join("\n") + "\n");
console.log(JSON.stringify({ ...report.coverage, headline: report.headline }, null, 2));
console.log(`\nfindings written: ${findings.length}`);
