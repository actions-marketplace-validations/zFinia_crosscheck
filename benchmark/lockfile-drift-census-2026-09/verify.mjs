// Integrity checker for the lockfile drift census.
//
// It does not trust report.json. It recomputes every published number from
// raw/scan.jsonl with analyze.mjs's own logic and fails if anything disagrees,
// then checks the structural invariants that must hold for the published claims
// to mean what they say.
import { readFileSync, existsSync } from "node:fs";
import { readJsonl, jsonlExists } from "./lib/jsonl.mjs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Every path below is relative to this directory, so the checker works from the
// repository root (npm run census:verify) as well as from inside the harness.
process.chdir(dirname(fileURLToPath(import.meta.url)));

const fail = [];
const ok = [];
const check = (condition, message) => (condition ? ok : fail).push(message);

// ---- 1. Every required file is present -------------------------------------
const REQUIRED = [
  "data/report.json", "data/findings.jsonl", "data/frame.jsonl", "data/sample.jsonl",
  "data/sample-allocation.json", "data/frame-strata.json", "raw/scan.jsonl",
  "raw/provider-equivalence.txt", "METHODOLOGY.md",
];
for (const f of REQUIRED) check(f.endsWith(".jsonl") ? jsonlExists(f) : existsSync(f), `present: ${f}`);
if (fail.length) { for (const f of fail) console.log("FAIL  " + f); process.exit(1); }

const report = JSON.parse(readFileSync("data/report.json", "utf8"));
const alloc = JSON.parse(readFileSync("data/sample-allocation.json", "utf8"));
const strata = JSON.parse(readFileSync("data/frame-strata.json", "utf8"));
const jsonl = readJsonl;
const frame = jsonl("data/frame.jsonl");
const sample = jsonl("data/sample.jsonl");
const scan = jsonl("raw/scan.jsonl");
const findings = jsonl("data/findings.jsonl");

// ---- 2. The sample really is a subset of the frame, drawn by the stated seed -
const frameNames = new Set(frame.map((r) => r.full_name));
check(sample.every((r) => frameNames.has(r.full_name)), "every sampled repository comes from the frame");
check(new Set(sample.map((r) => r.full_name)).size === sample.length, "the sample contains no duplicates");
check(alloc.frame_size === frame.length, `sample-allocation frame_size (${alloc.frame_size}) equals frame.jsonl (${frame.length})`);
check(alloc.sample_size === sample.length, `sample-allocation sample_size (${alloc.sample_size}) equals sample.jsonl (${sample.length})`);

// Re-draw the sample with the recorded seed and require the identical set.
try {
  execFileSync(process.execPath, ["sample.mjs"], {
    env: { ...process.env, SEED: String(alloc.seed), TARGET: String(alloc.target), OUT: "data/.verify-sample.jsonl" },
    stdio: "pipe",
  });
  const redrawn = jsonl("data/.verify-sample.jsonl").map((r) => r.full_name).sort();
  const original = sample.map((r) => r.full_name).sort();
  check(redrawn.length === original.length && redrawn.every((x, i) => x === original[i]),
    `re-drawing with SEED=${alloc.seed} reproduces the identical sample`);
} catch (e) {
  fail.push("re-drawing the sample failed: " + String(e.message).slice(0, 160));
}

// ---- 3. Frozen commits are real and findings cite them ---------------------
const scanned = new Map(scan.map((r) => [r.full_name, r]));
check(scan.every((r) => !r.ok || /^[0-9a-f]{40}$/.test(r.sha)), "every successful scan records a 40-character commit SHA");
check(new Set(scan.map((r) => r.full_name)).size === scan.length, "raw/scan.jsonl contains no duplicate repositories");
check(findings.every((f) => scanned.get(f.repo)?.sha === f.sha),
  "every finding's commit matches the scan record for that repository");
check(findings.every((f) => f.evidence.length > 0), "every finding cites at least one file");
check(findings.every((f) => f.evidence.every((e) => e.url.startsWith(`https://github.com/${f.repo}/blob/${f.sha}/`))),
  "every cited permalink is pinned to the frozen commit");

// ---- 4. Recompute the headline straight from the raw scan ------------------
const inSample = new Set(sample.map((r) => r.full_name));
const seen = new Set();
const rows = scan.filter((r) => inSample.has(r.full_name) && !seen.has(r.full_name) && seen.add(r.full_name));
const okRows = rows.filter((r) => r.ok);
const js = okRows.filter((r) => r.relevant_paths.some((p) => p === "package.json" || p.endsWith("/package.json")));
const PM = "package-manager/conflicting-config";
const hasPM = (r) => r.findings_default.some((f) => f.rule === PM);

check(report.coverage.scanned === rows.length, `coverage.scanned recomputes (${report.coverage.scanned} vs ${rows.length})`);
check(report.coverage.ok === okRows.length, `coverage.ok recomputes (${report.coverage.ok} vs ${okRows.length})`);
check(report.coverage.with_package_json === js.length, `denominator recomputes (${report.coverage.with_package_json} vs ${js.length})`);

const pmCount = js.filter(hasPM).length;
const h = report.headline.contradictory_package_manager_config;
check(h.k === pmCount, `headline count recomputes (${h.k} vs ${pmCount})`);
check(h.n === js.length, `headline denominator recomputes (${h.n} vs ${js.length})`);
const pct = +(100 * pmCount / js.length).toFixed(2);
check(h.pct === pct, `headline percentage recomputes (${h.pct} vs ${pct})`);

// Findings file must contain exactly the default findings of in-sample repos.
const expectedFindings = js.reduce((a, r) => a + r.findings_default.length, 0);
check(findings.length === expectedFindings, `findings.jsonl row count matches the scan (${findings.length} vs ${expectedFindings})`);

// ---- 5. Structural invariants that make the claims meaningful --------------
const LOCK = { "package-lock.json": "npm", "npm-shrinkwrap.json": "npm", "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun" };
const managers = (r) => new Set(r.lockfiles.map((p) => LOCK[p.split("/").pop()]).filter(Boolean));
check(js.filter(hasPM).every((r) => managers(r).size > 1 || r.packages.some((p) => p.packageManager)),
  "a contradiction always has either two lockfile managers or a packageManager declaration");
// A contradiction needs EITHER two lockfile managers in one package OR one
// lockfile disagreeing with a declared packageManager. Check the decomposition
// published in report.json really partitions the headline.
const twoLockContradictions = js.filter((r) => hasPM(r) && managers(r).size > 1).length;
const cs = report.contradiction_shape;
check(cs.total === pmCount, `contradiction_shape.total recomputes (${cs.total} vs ${pmCount})`);
check(cs.two_lockfile_managers === twoLockContradictions,
  `two-lockfile contradictions recompute (${cs.two_lockfile_managers} vs ${twoLockContradictions})`);
check(cs.two_lockfile_managers + cs.single_lockfile_vs_packageManager_field === pmCount,
  "the two contradiction shapes account for every contradiction exactly once");
check(js.length <= okRows.length && okRows.length <= rows.length && rows.length <= sample.length,
  "coverage numbers are monotonic: denominator <= read <= scanned <= sampled");

// "Declares the packageManager field" must come from raw packageManager-field
// evidence, never from model.packages[].packageManager, which the engine decides
// from a lockfile OR the field and therefore answers a different question.
const declares = js.filter((r) => (r.package_manager_fields ?? []).length > 0).length;
const established = js.filter((r) => r.packages.some((p) => p.packageManager)).length;
check(report.headline.declares_packageManager_field.k === declares,
  `packageManager-field adoption recomputes (${report.headline.declares_packageManager_field.k} vs ${declares})`);
check(report.headline.package_manager_established.k === established,
  `established-manager rate recomputes (${report.headline.package_manager_established.k} vs ${established})`);
check(declares <= established, "declaring the field cannot be more common than having a manager at all");
check(js.every((r) => Array.isArray(r.package_manager_fields)),
  "every scan record carries raw packageManager-field evidence");

// The headline must use proven-tier rules only.
check(findings.every((f) => f.rule !== undefined), "every finding names its rule");
const tiers = new Set(js.flatMap((r) => r.findings_default.map((f) => f.tier)));
check(!tiers.has("experimental"), `no experimental finding is in the default set (tiers seen: ${[...tiers].join(", ") || "none"})`);

// ---- 6. Strata honesty ------------------------------------------------------
const partial = strata.strata.filter((s) => !s.complete);
// A stratum whose repositories were all already captured by an earlier stratum
// contributes no unique rows, so the allocation can be shorter than the log.
const loggedQueries = new Set(strata.strata.map((s) => s.query));
check(alloc.strata.every((a) => loggedQueries.has(a.stratum)),
  "every stratum in the allocation appears in the frame log");
check(alloc.strata.length <= strata.strata.length,
  `allocation strata (${alloc.strata.length}) <= logged strata (${strata.strata.length})`);
check(partial.every((s) => s.total_count > 1000 || s.retrieved >= s.total_count),
  "a stratum is only marked incomplete when it genuinely exceeds the 1000-result cap");

// ---- 7. Provider equivalence ------------------------------------------------
const eq = readFileSync("raw/provider-equivalence.txt", "utf8");
const eqFail = (eq.match(/^(FAIL|ERROR)/gm) || []).length;
const eqPass = (eq.match(/^PASS/gm) || []).length;
check(eqPass > 0, `the provider equivalence run has results (${eqPass} identical)`);
check(eqFail === 0, `no provider equivalence failure (${eqFail})`);

// ---- report -----------------------------------------------------------------
for (const m of ok) console.log("ok    " + m);
for (const m of fail) console.log("FAIL  " + m);
console.log(`\n${ok.length} checks passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
