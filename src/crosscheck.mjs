// Public API: scan a file set, or compare two file sets (base vs head).
import { extractEvidence } from "./evidence.mjs";
import { evaluate } from "./rules.mjs";
import { CONTRACT_PATH, parseContract, contractDigest, evaluateContract, diffContracts, contractChangeFindings } from "./contract.mjs";

export const VERSION = "0.2.0";

export function scanFiles(files, options = {}) {
  const extracted = extractEvidence(files);
  const { findings, model } = evaluate(extracted);
  const ownContract = files.has(CONTRACT_PATH) ? parseContract(files.get(CONTRACT_PATH)) : null;
  const contract = Object.hasOwn(options, "authorityContract") ? options.authorityContract : ownContract;
  const contractFindings = evaluateContract(contract, extracted.evidence);
  const result = { findings: [...findings, ...contractFindings].sort((a, b) => a.scope.localeCompare(b.scope) || a.rule.localeCompare(b.rule)), model, filesRead: files.size, scopes: extracted.scopes, evidence: extracted.evidence };
  if (ownContract) { result.contract = ownContract; result.contractDigest = contractDigest(ownContract); }
  if (contract && contract !== ownContract) { result.authorityContract = contract; result.authorityContractDigest = contractDigest(contract); }
  return result;
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

/** Contract-aware PR comparison. Base policy remains authoritative unless approved. */
export function diffRepositories(baseFiles, headFiles, { allowContractChange = false } = {}) {
  const baseOwn = scanFiles(baseFiles);
  const headOwn = scanFiles(headFiles);
  const changes = diffContracts(baseOwn.contract || null, headOwn.contract || null);
  const initialAdoption = !baseOwn.contract && Boolean(headOwn.contract);
  const needsApproval = changes.some((change) => change.requiresApproval);
  let authority = baseOwn.contract || null;
  let approved = false;
  if (initialAdoption || (allowContractChange && needsApproval) || (!needsApproval && headOwn.contract)) {
    authority = headOwn.contract || null;
    approved = allowContractChange && needsApproval;
  }
  const base = scanFiles(baseFiles, { authorityContract: baseOwn.contract || null });
  const head = scanFiles(headFiles, { authorityContract: authority });
  if (needsApproval && !allowContractChange) head.findings.push(...contractChangeFindings(changes));
  head.findings.sort((a, b) => a.scope.localeCompare(b.scope) || a.rule.localeCompare(b.rule));
  const diff = diffStates(base, head);
  return { base, head, diff, contractChanges: changes, contractChangeApproved: approved, initialContractAdoption: initialAdoption };
}

const evKey = (e) => `${e.source}|${e.value}|${e.kind}|${e.detail}`;

/**
 * Default output contains only rules proven on unseen repositories.
 * Experimental rules appear only when asked for, and never fail a build.
 */
export function selectTiers(findings, { experimental = false } = {}) {
  const shown = findings.filter((f) => f.tier === "proven" || f.tier === "contract" || experimental);
  return { shown, hiddenExperimental: findings.length - shown.length };
}
export const failing = (findings, { contractEnforcementAuthorized = false } = {}) => findings.filter((f) => {
  if (f.tier === "proven") return true;
  if (!contractEnforcementAuthorized || f.tier !== "contract") return false;
  return (f.rule === "contract/violation" && f.enforcement === "block") || f.rule === "contract/change-unapproved";
});
