import { createHash } from "node:crypto";

export const CONTRACT_PATH = ".crosscheck/contract.json";
export const CONTRACT_SCHEMA = "https://www.zfinia.com/schemas/crosscheck-contract-v1.json";
export const SUPPORTED_DECISIONS = new Set(["package.manager", "runtime.node", "database.orm", "database.engine", "auth.provider"]);
export const ENFORCEMENT = new Set(["block", "warn", "off"]);

const VALUES = {
  "package.manager": new Set(["npm", "pnpm", "yarn", "bun"]),
  "database.orm": new Set(["prisma", "drizzle", "typeorm", "sequelize"]),
  "database.engine": new Set(["postgresql", "mysql", "sqlite", "mongodb", "cockroachdb", "sqlserver"]),
  "auth.provider": new Set(["authjs", "clerk", "better-auth", "auth0", "lucia"]),
};
const TOP_KEYS = new Set(["$schema", "version", "changePolicy", "decisions"]);
const DECISION_KEYS = new Set(["key", "scope", "allowed", "enforcement", "reason"]);
const RANK = { off: 0, warn: 1, block: 2 };

export class ContractError extends Error {
  constructor(message) {
    super(`${CONTRACT_PATH}: ${message}`);
    this.name = "ContractError";
  }
}

export function normalizeScope(value = ".") {
  if (typeof value !== "string") throw new ContractError("decision scope must be a string");
  let scope = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!scope || scope === ".") return ".";
  if (scope.startsWith("/") || /^[A-Za-z]:/.test(scope) || scope.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new ContractError(`invalid exact scope ${JSON.stringify(value)}`);
  }
  return scope;
}

function normalizedValue(key, value) {
  if (typeof value !== "string" || !value.trim()) throw new ContractError(`decision ${key} has an empty or non-string allowed value`);
  const out = value.trim().toLowerCase();
  if (key === "runtime.node") {
    if (!/^[1-9]\d*$/.test(out)) throw new ContractError(`decision runtime.node allowed value ${JSON.stringify(value)} must be a Node major`);
  } else if (!VALUES[key]?.has(out)) {
    throw new ContractError(`decision ${key} has unsupported allowed value ${JSON.stringify(value)}`);
  }
  return out;
}

export function parseContract(raw) {
  let input;
  try { input = typeof raw === "string" ? JSON.parse(raw.replace(/^\uFEFF/, "")) : raw; }
  catch (error) { throw new ContractError(`invalid JSON: ${String(error.message).split("\n")[0]}`); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ContractError("top level must be an object");
  for (const key of Object.keys(input)) if (!TOP_KEYS.has(key)) throw new ContractError(`unknown top-level property ${JSON.stringify(key)}`);
  if (input.$schema !== undefined && input.$schema !== CONTRACT_SCHEMA) throw new ContractError(`unsupported $schema ${JSON.stringify(input.$schema)}`);
  if (input.version !== 1) throw new ContractError(`unsupported version ${JSON.stringify(input.version)}; expected 1`);
  const changePolicy = input.changePolicy ?? "approval-required";
  if (changePolicy !== "approval-required") throw new ContractError(`unsupported changePolicy ${JSON.stringify(changePolicy)}`);
  if (!Array.isArray(input.decisions)) throw new ContractError("decisions must be an array");

  const decisions = [];
  const seen = new Set();
  for (let i = 0; i < input.decisions.length; i += 1) {
    const value = input.decisions[i];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractError(`decisions[${i}] must be an object`);
    for (const key of Object.keys(value)) if (!DECISION_KEYS.has(key)) throw new ContractError(`decisions[${i}] has unknown property ${JSON.stringify(key)}`);
    if (!SUPPORTED_DECISIONS.has(value.key)) throw new ContractError(`decisions[${i}] has unsupported key ${JSON.stringify(value.key)}`);
    const scope = normalizeScope(value.scope);
    const enforcement = value.enforcement ?? "warn";
    if (!ENFORCEMENT.has(enforcement)) throw new ContractError(`decisions[${i}] has invalid enforcement ${JSON.stringify(enforcement)}`);
    if (!Array.isArray(value.allowed) || value.allowed.length === 0) throw new ContractError(`decisions[${i}] allowed must be a non-empty array`);
    const allowed = [...new Set(value.allowed.map((item) => normalizedValue(value.key, item)))].sort();
    const id = `${value.key}@${scope}`;
    if (seen.has(id)) throw new ContractError(`duplicate decision for ${value.key} at scope ${scope}`);
    seen.add(id);
    const decision = { key: value.key, scope, allowed, enforcement };
    if (value.reason !== undefined) {
      if (typeof value.reason !== "string" || !value.reason.trim()) throw new ContractError(`decisions[${i}] reason must be a non-empty string when present`);
      decision.reason = value.reason.trim();
    }
    decisions.push(decision);
  }
  decisions.sort((a, b) => a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key));
  return { $schema: CONTRACT_SCHEMA, version: 1, changePolicy, decisions };
}

export function canonicalContract(contract) { return parseContract(contract); }

export function canonicalContractJson(contract, { pretty = false } = {}) {
  return JSON.stringify(canonicalContract(contract), null, pretty ? 2 : 0) + (pretty ? "\n" : "");
}

export function contractDigest(contract) {
  return createHash("sha256").update(canonicalContractJson(contract)).digest("hex");
}

export const decisionId = (decision) => `${decision.key}@${normalizeScope(decision.scope)}`;

export function resolveDecision(contract, scope, key) {
  if (!contract) return null;
  const wanted = normalizeScope(scope || ".");
  return contract.decisions.find((decision) => decision.key === key && decision.scope === wanted) || null;
}

const decisionSemantics = (decision) => decision ? JSON.stringify({ allowed: decision.allowed, enforcement: decision.enforcement }) : null;

export function diffContracts(base, head) {
  const before = new Map((base?.decisions || []).map((d) => [decisionId(d), d]));
  const after = new Map((head?.decisions || []).map((d) => [decisionId(d), d]));
  const changes = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldDecision = before.get(id) || null;
    const newDecision = after.get(id) || null;
    if (!oldDecision) changes.push({ id, type: "added", before: null, after: newDecision, requiresApproval: false });
    else if (!newDecision) changes.push({ id, type: "removed", before: oldDecision, after: null, requiresApproval: true });
    else if (decisionSemantics(oldDecision) !== decisionSemantics(newDecision)) {
      const sameAllowed = JSON.stringify(oldDecision.allowed) === JSON.stringify(newDecision.allowed);
      const tightening = sameAllowed && RANK[newDecision.enforcement] > RANK[oldDecision.enforcement];
      changes.push({ id, type: "changed", before: oldDecision, after: newDecision, requiresApproval: !tightening });
    }
  }
  return changes;
}

const evidenceKinds = {
  "package.manager": new Set(["lockfile", "packageManager-field", "install-command", "install-command-unpinned"]),
  "runtime.node": new Set(["runtime-config"]),
  "database.orm": new Set(["dependency", "orm-config"]),
  "database.engine": new Set(["datasource", "runtime-driver"]),
  "auth.provider": new Set(["dependency"]),
};
const strongKinds = {
  "package.manager": new Set(["lockfile", "packageManager-field", "install-command"]),
  "runtime.node": new Set(["runtime-config"]),
  "database.orm": new Set(["dependency", "orm-config"]),
  "database.engine": new Set(["datasource"]),
  "auth.provider": new Set(["dependency"]),
};

export const decisionLabel = {
  "package.manager": "Package manager",
  "runtime.node": "Node runtime",
  "database.orm": "ORM",
  "database.engine": "Database engine",
  "auth.provider": "Authentication provider",
};

export function evaluateContract(contract, evidence) {
  if (!contract) return [];
  const findings = [];
  for (const decision of contract.decisions) {
    if (decision.enforcement === "off") continue;
    const scope = decision.scope === "." ? "" : decision.scope;
    const relevant = evidence.filter((item) => item.scope === scope && item.class === decision.key && evidenceKinds[decision.key].has(item.kind));
    const strong = relevant.filter((item) => strongKinds[decision.key].has(item.kind));
    const weak = relevant.filter((item) => !strongKinds[decision.key].has(item.kind));
    const strongMatching = strong.filter((item) => decision.allowed.includes(item.value));
    const strongConflicting = strong.filter((item) => !decision.allowed.includes(item.value));
    const weakConflicting = weak.filter((item) => !decision.allowed.includes(item.value));
    if (!strongConflicting.length && !weakConflicting.length && strongMatching.length) continue;
    const rule = strongConflicting.length ? "contract/violation" : weakConflicting.length ? "contract/possible-violation" : "contract/unverified";
    const cited = strongConflicting.length ? strongConflicting : weakConflicting.length ? weakConflicting : relevant.length ? relevant : [{ source: CONTRACT_PATH, line: 1, value: "missing", kind: "contract", detail: `no strong repository evidence verifies ${decision.key}` }];
    const observed = [...new Set(cited.filter((item) => item.kind !== "contract").map((item) => item.value))].sort();
    const expected = decision.allowed.join(" or ");
    const actual = observed.length ? observed.join(", ") : "no matching evidence";
    const description = rule === "contract/violation" ? "violated" : rule === "contract/possible-violation" ? "may be contradicted by weak evidence" : "could not be verified";
    findings.push({
      id: `${rule}@${decision.key}@${decision.scope}`,
      rule,
      tier: "contract",
      class: decision.key,
      scope,
      expected: decision.allowed,
      values: observed,
      enforcement: rule === "contract/violation" ? decision.enforcement : "warn",
      summary: `${decisionLabel[decision.key]} decision ${description}${scope ? ` in ${scope}/` : ""}: expected ${expected}; observed ${actual}`,
      fix: rule === "contract/violation"
        ? `Restore ${decisionLabel[decision.key].toLowerCase()} ${expected}${scope ? ` in ${scope}/` : ""}, or propose an explicit contract change for maintainer approval.`
        : `Review the cited evidence and either align it with ${expected} or add strong repository configuration that makes the decision verifiable.`,
      evidence: cited.map((item) => ({ source: item.source, line: item.line ?? null, value: item.value, kind: item.kind, detail: item.detail })),
    });
  }
  return findings.sort((a, b) => a.scope.localeCompare(b.scope) || a.class.localeCompare(b.class));
}

export function contractChangeFindings(changes) {
  return changes.filter((change) => change.requiresApproval).map((change) => {
    const decision = change.after || change.before;
    const from = change.before?.allowed?.join(" or ") ?? "not set";
    const to = change.after?.allowed?.join(" or ") ?? "removed";
    return {
      id: `contract/change-unapproved@${change.id}`,
      rule: "contract/change-unapproved",
      tier: "contract",
      class: decision?.key || "contract",
      scope: decision?.scope === "." ? "" : (decision?.scope || ""),
      expected: change.before?.allowed || [],
      values: change.after?.allowed || [],
      enforcement: "block",
      summary: `${decision ? decisionLabel[decision.key] : "Repository contract"} decision change requires approval: ${from} → ${to}`,
      fix: "Have a maintainer approve this repository decision migration with --allow-contract-change or the crosscheck:decision-change pull-request label.",
      evidence: [{ source: CONTRACT_PATH, line: 1, value: to, kind: "contract-change", detail: `${change.type} decision ${change.id}` }],
    };
  });
}

export function buildInitialContract(model) {
  const decisions = [];
  for (const pkg of model.packages) {
    const scope = pkg.scope || ".";
    if (typeof pkg.packageManager === "string") decisions.push({ key: "package.manager", scope, allowed: [pkg.packageManager], enforcement: "block", reason: `This package is managed with ${pkg.packageManager}.` });
    if (typeof pkg.nodeRuntime === "string") decisions.push({ key: "runtime.node", scope, allowed: [pkg.nodeRuntime], enforcement: "block", reason: `This package runs on Node ${pkg.nodeRuntime}.` });
  }
  return parseContract({ version: 1, changePolicy: "approval-required", decisions });
}

export function contractSuggestions(result) {
  const existing = new Set((result.contract?.decisions || []).map(decisionId));
  const fields = [["database.orm", "orm"], ["database.engine", "database"], ["auth.provider", "auth"]];
  const suggestions = [];
  for (const pkg of result.model.packages) {
    for (const [key, field] of fields) {
      const value = pkg[field];
      if (typeof value !== "string" || existing.has(`${key}@${pkg.scope || "."}`)) continue;
      const evidence = result.evidence.filter((item) => item.scope === pkg.scope && item.class === key && item.value === value)
        .map((item) => ({ source: item.source, line: item.line ?? null, kind: item.kind, detail: item.detail }));
      suggestions.push({ key, scope: pkg.scope || ".", suggested: value, genericTier: "experimental", evidence, explanation: `Confirm ${value} as an intentional ${decisionLabel[key].toLowerCase()} decision before adding it to the contract.` });
    }
  }
  return suggestions.sort((a, b) => a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key));
}

export function contextObject(contract) {
  return { schemaVersion: 1, contractDigest: contractDigest(contract), decisions: contract.decisions.map(({ key, scope, allowed, enforcement }) => ({ key, scope, allowed, enforcement })) };
}

export function renderAgentContext(contract) {
  const lines = ["# CrossCheck Repository Decisions", "", "Generated from `.crosscheck/contract.json`.", "Do not edit this file manually.", ""];
  const groups = new Map();
  for (const decision of contract.decisions) groups.set(decision.scope, [...(groups.get(decision.scope) || []), decision]);
  for (const [scope, decisions] of groups) {
    lines.push(`## ${scope === "." ? "Root" : scope}`, "");
    for (const decision of decisions) lines.push(`- ${decisionLabel[decision.key]}: ${decision.allowed.join(" or ")} (${decision.enforcement})`);
    lines.push("");
  }
  lines.push("## Rules for automated changes", "", "- Do not change an established repository decision implicitly.");
  if (contract.decisions.some((d) => d.key === "package.manager")) lines.push("- Do not create a lockfile for a different package manager; use the contracted manager for dependency operations.");
  if (contract.decisions.some((d) => d.key === "runtime.node")) lines.push("- Do not change the Node major version implicitly.");
  lines.push("- If a task genuinely requires a decision change, update `.crosscheck/contract.json` in the same pull request.", "- Existing decision migrations may require maintainer approval with `crosscheck:decision-change`.");
  return lines.join("\n").trimEnd() + "\n";
}

export function renderContextText(contract) {
  return renderAgentContext(contract).replace(/^# /, "").replace("Generated from `.crosscheck/contract.json`.\nDo not edit this file manually.\n\n", "");
}
