// Public API: scan a file set, or compare two file sets (base vs head).
import { extractEvidence } from "./evidence.mjs";
import { evaluate } from "./rules.mjs";

export const VERSION = "0.1.1";

export function scanFiles(files) {
  const extracted = extractEvidence(files);
  const { findings, model } = evaluate(extracted);
  return { findings, model, filesRead: files.size, scopes: extracted.scopes, evidence: extracted.evidence };
}

/**
 * Classifies every finding across two repository states.
 *   introduced — absent at base, present at head (or its value set grew)
 *   existing   — present at both, unchanged
 *   resolved   — present at base, gone at head
 * Only `introduced` is actionable on a pull request: repository debt that was
 * already there must not make an unrelated change noisy.
 */
export function diffStates(base, head) {
  const baseById = new Map(base.findings.map((f) => [f.id, f]));
  const headById = new Map(head.findings.map((f) => [f.id, f]));
  const introduced = [];
  const existing = [];
  const resolved = [];
  // "Introduced by" = evidence that did not exist anywhere at base, so a PR
  // that adds package-lock.json is blamed for that file, not for the
  // pnpm-lock.yaml that was already there.
  const known = new Set([...(base.evidence || []), ...base.findings.flatMap((f) => f.evidence)].map(evKey));

  for (const f of head.findings) {
    const before = baseById.get(f.id);
    const newEvidence = f.evidence.filter((e) => !known.has(evKey(e)));
    if (!before) { introduced.push({ ...f, change: "introduced", newEvidence: newEvidence.length ? newEvidence : f.evidence }); continue; }
    const grew = f.values.some((v) => !before.values.includes(v));
    if (grew) introduced.push({ ...f, change: "worsened", previousValues: before.values, newEvidence });
    else existing.push({ ...f, change: "existing", newEvidence });
  }
  for (const f of base.findings) if (!headById.has(f.id)) resolved.push({ ...f, change: "resolved" });
  return { introduced, existing, resolved };
}

const evKey = (e) => `${e.source}|${e.value}|${e.kind}|${e.detail}`;

/**
 * Default output contains only rules proven on unseen repositories.
 * Experimental rules appear only when asked for, and never fail a build.
 */
export function selectTiers(findings, { experimental = false } = {}) {
  const shown = findings.filter((f) => f.tier === "proven" || experimental);
  return { shown, hiddenExperimental: findings.length - shown.length };
}
export const failing = (findings) => findings.filter((f) => f.tier === "proven");
