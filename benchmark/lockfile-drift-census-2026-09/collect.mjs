// Collector: runs the SHIPPED CrossCheck engine over every repo in a frozen list.
// Emits one JSON record per repo carrying the evidence needed to re-verify a
// finding by hand: the frozen commit SHA, every relevant path, and every cited file.
import { readFileSync, appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cloneFrozen, readFrozenCommit } from "./lib/sparse-provider.mjs";
import { scanFiles, selectTiers, VERSION } from "../../src/crosscheck.mjs";

const OUT = process.env.OUT || "raw/scan.jsonl";
const FRAME = process.env.FRAME || "data/frame.jsonl";
const SHARD = Number(process.env.SHARD ?? 0);
const SHARDS = Number(process.env.SHARDS ?? 1);

function collectRepo(full_name) {
  const dir = mkdtempSync(join(tmpdir(), "ccb-"));
  try {
    cloneFrozen(dir, full_name);
    const t = readFrozenCommit(join(dir, "r"));
    const result = scanFiles(t.files);
    const shown = selectTiers(result.findings, { experimental: false }).shown;
    const withExp = selectTiers(result.findings, { experimental: true }).shown;
    const ev = (f) => (f.evidence || []).map(e => ({ kind: e.kind, value: e.value, source: e.source, line: e.line ?? null }));
    return {
      full_name, sha: t.sha, engine: VERSION, ok: true,
      tree_files: t.allPaths.length,
      relevant_paths: t.relevant,
      lockfiles: t.lockfiles,
      content_files_read: t.files.size - t.lockfiles.length,
      oversize_skipped: t.oversize,
      checkout_note: t.checkoutNote,
      packages: result.model.packages,
      instruction_files: result.model.instructionFiles,
      // Recorded so later questions can be answered without re-scanning. The
      // model level cannot answer them: model.packages[].packageManager is
      // decided from a lockfile OR the field, so it does not say which.
      package_manager_fields: result.evidence
        .filter((e) => e.kind === "packageManager-field")
        .map((e) => ({ scope: e.scope, value: e.value, source: e.source })),
      lockfile_evidence: result.evidence
        .filter((e) => e.kind === "lockfile")
        .map((e) => ({ scope: e.scope, value: e.value, source: e.source })),
      evidence_kinds: result.evidence.reduce((a, e) => { a[e.kind] = (a[e.kind] || 0) + 1; return a; }, {}),
      findings_default: shown.map(f => ({ rule: f.rule, scope: f.scope, values: f.values, tier: f.tier, evidence: ev(f) })),
      findings_experimental_only: withExp.filter(f => !shown.includes(f)).map(f => ({ rule: f.rule, scope: f.scope, values: f.values, evidence: ev(f) })),
      incomplete: result.incomplete ?? [],
    };
  } catch (e) {
    return { full_name, ok: false, error: String(e.message).slice(0, 300) };
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
}

const done = new Set();
if (existsSync(OUT)) for (const l of readFileSync(OUT, "utf8").split("\n")) if (l.trim()) { try { done.add(JSON.parse(l).full_name); } catch {} }
const all = readFileSync(FRAME, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const mine = all.filter((_, i) => i % SHARDS === SHARD).filter(r => !done.has(r.full_name));
console.error(`shard ${SHARD}/${SHARDS}: ${mine.length} pending (of ${all.length})`);

let n = 0, okN = 0, findN = 0;
const t0 = Date.now();
for (const item of mine) {
  const rec = collectRepo(item.full_name);
  for (const k of ["stratum", "stars", "language", "pushed_at", "created_at", "license", "stratum_complete"]) rec[k] = item[k] ?? null;
  appendFileSync(OUT, JSON.stringify(rec) + "\n");
  n++; if (rec.ok) { okN++; if (rec.findings_default.length) findN++; }
  if (n % 50 === 0) console.error(`[shard ${SHARD}] ${n}/${mine.length} ok=${okN} find=${findN} ${(n / ((Date.now() - t0) / 1000)).toFixed(2)}/s`);
}
console.error(`[shard ${SHARD}] DONE ${n} ok=${okN} find=${findN} in ${((Date.now() - t0) / 60000).toFixed(1)}min`);
