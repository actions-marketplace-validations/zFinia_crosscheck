import test from "node:test";
import assert from "node:assert/strict";
import {
  parseContract, canonicalContractJson, contractDigest, diffContracts, resolveDecision,
  renderAgentContext, contextObject,
} from "../src/contract.mjs";
import { normalizeNodeMajor } from "../src/evidence.mjs";
import { scanFiles, diffRepositories, failing } from "../src/crosscheck.mjs";

const raw = (value) => JSON.stringify(value, null, 2);
const contract = (decisions, extra = {}) => raw({ version: 1, decisions, ...extra });
const decision = (key, allowed, extra = {}) => ({ key, allowed: Array.isArray(allowed) ? allowed : [allowed], enforcement: "block", ...extra });
const files = (value) => new Map(Object.entries(value).map(([key, item]) => [key, item === true ? null : typeof item === "string" ? item : raw(item)]));
const pnpm = { "package.json": { name: "app", packageManager: "pnpm@10" }, "pnpm-lock.yaml": true };
const npm = { "package.json": { name: "app", packageManager: "npm@11" }, "package-lock.json": true };

test("valid contract parses with defaults and deterministic sorting", () => {
  const value = parseContract(contract([
    { key: "runtime.node", allowed: ["22"], scope: "./apps/web/" },
    { key: "package.manager", allowed: ["pnpm", "pnpm"] },
  ]));
  assert.equal(value.changePolicy, "approval-required");
  assert.equal(value.decisions[0].scope, ".");
  assert.equal(value.decisions[0].enforcement, "warn");
  assert.deepEqual(value.decisions[0].allowed, ["pnpm"]);
});

test("semantic formatting and key order yield the same digest", () => {
  const a = contract([{ key: "package.manager", allowed: ["pnpm", "npm"], enforcement: "block" }]);
  const b = JSON.stringify({ decisions: [{ enforcement: "block", allowed: ["npm", "pnpm", "npm"], key: "package.manager", scope: "." }], changePolicy: "approval-required", version: 1 });
  assert.equal(contractDigest(parseContract(a)), contractDigest(parseContract(b)));
  assert.equal(canonicalContractJson(parseContract(a)), canonicalContractJson(parseContract(b)));
});

for (const [name, value, pattern] of [
  ["invalid JSON", "{", /invalid JSON/],
  ["unsupported version", raw({ version: 2, decisions: [] }), /unsupported version/],
  ["unknown decision key", contract([{ key: "editor.theme", allowed: ["dark"] }]), /unsupported key/],
  ["invalid enforcement", contract([{ key: "package.manager", allowed: ["pnpm"], enforcement: "error" }]), /invalid enforcement/],
  ["empty allowed", contract([{ key: "package.manager", allowed: [] }]), /non-empty array/],
  ["unknown property", contract([{ key: "package.manager", allowed: ["pnpm"], inherit: true }]), /unknown property/],
  ["invalid scope", contract([{ key: "package.manager", allowed: ["pnpm"], scope: "../web" }]), /invalid exact scope/],
]) test(`contract rejects ${name}`, () => assert.throws(() => parseContract(value), pattern));

test("contract rejects duplicate key and scope", () => {
  assert.throws(() => parseContract(contract([decision("package.manager", "pnpm"), decision("package.manager", "npm")])), /duplicate decision/);
});

test("resolveDecision is exact-scope only", () => {
  const value = parseContract(contract([decision("package.manager", "pnpm"), decision("package.manager", "npm", { scope: "apps/web" })]));
  assert.equal(resolveDecision(value, "apps/web", "package.manager").allowed[0], "npm");
  assert.equal(resolveDecision(value, "services/api", "package.manager"), null);
});

test("contract diff distinguishes additions, migrations, tightening and removal", () => {
  const base = parseContract(contract([decision("package.manager", "pnpm"), { key: "runtime.node", allowed: ["22"], enforcement: "warn" }]));
  const head = parseContract(contract([decision("package.manager", "npm"), { key: "runtime.node", allowed: ["22"], enforcement: "block" }, decision("database.orm", "prisma", { scope: "apps/api" })]));
  const changes = diffContracts(base, head);
  assert.deepEqual(changes.map((item) => [item.id, item.type, item.requiresApproval]), [
    ["database.orm@apps/api", "added", false], ["package.manager@.", "changed", true], ["runtime.node@.", "changed", false],
  ]);
  assert.equal(diffContracts(head, null).every((item) => item.requiresApproval), true);
});

test("Node major normalization accepts exact single-major expressions", () => {
  for (const value of ["22", "v22", "22.12.0", "22.x", "^22.0.0", ">=22 <23"]) assert.equal(normalizeNodeMajor(value), "22", value);
});

test("Node major normalization rejects ambiguous expressions", () => {
  for (const value of ["node", "lts/*", ">=18", "${{ matrix.node }}", "18 || 20", ">=20 <23"]) assert.equal(normalizeNodeMajor(value), null, value);
});

for (const [name, input] of [
  [".nvmrc", { ".nvmrc": "22\n" }],
  [".node-version", { ".node-version": "v22.12.0\n" }],
  [".tool-versions", { ".tool-versions": "nodejs 22.12.0\n" }],
  ["package engines", { "package.json": { engines: { node: "22.x" } } }],
  ["setup-node", { ".github/workflows/ci.yml": "on: push\njobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n" }],
]) test(`${name} establishes Node 22`, () => assert.equal(scanFiles(files(input)).model.packages[0].nodeRuntime, "22"));

test("ambiguous package engines and dynamic setup-node are ignored", () => {
  const result = scanFiles(files({ "package.json": { engines: { node: ">=18" } }, ".github/workflows/ci.yml": "steps:\n - uses: actions/setup-node@v4\n   with:\n     node-version: ${{ matrix.node }}\n" }));
  assert.equal(result.model.packages[0].nodeRuntime, undefined);
});

test("matching package-manager contract is clean", () => {
  const result = scanFiles(files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) }));
  assert.equal(result.findings.some((item) => item.tier === "contract"), false);
  assert.match(result.contractDigest, /^[a-f0-9]{64}$/);
});

test("block, warn and off enforcement have distinct failure semantics", () => {
  const state = (enforcement) => scanFiles(files({ ...npm, ".crosscheck/contract.json": contract([{ key: "package.manager", allowed: ["pnpm"], enforcement }]) }));
  assert.equal(failing(state("block").findings).some((item) => item.tier === "contract"), false);
  assert.equal(failing(state("block").findings, { contractEnforcementAuthorized: true }).some((item) => item.tier === "contract"), true);
  assert.equal(failing(state("warn").findings).some((item) => item.tier === "contract"), false);
  assert.equal(state("off").findings.some((item) => item.tier === "contract"), false);
});

test("contract pnpm plus package-lock creates a contract violation", () => {
  const result = scanFiles(files({ ...pnpm, "package-lock.json": true, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) }));
  assert.equal(result.findings.some((item) => item.rule === "contract/violation" && item.values.includes("npm")), true);
});

test("weak evidence produces advisory possible-violation or unverified findings", () => {
  const matchingWeak = scanFiles(files({
    "package.json": {},
    ".github/workflows/ci.yml": "on: push\njobs:\n  t:\n    steps:\n      - run: pnpm install --no-frozen-lockfile\n",
    ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]),
  }));
  assert.equal(matchingWeak.findings.some((item) => item.rule === "contract/unverified"), true);
  const conflictingWeak = scanFiles(files({
    "package.json": { packageManager: "pnpm@10" }, "pnpm-lock.yaml": true,
    ".github/workflows/ci.yml": "on: push\njobs:\n  t:\n    steps:\n      - run: npm install\n",
    ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]),
  }));
  assert.equal(conflictingWeak.findings.some((item) => item.rule === "contract/possible-violation" && item.values.includes("npm")), true);
  assert.equal(failing(conflictingWeak.findings, { contractEnforcementAuthorized: true }).length, 0);
});

test("a runtime database driver alone does not establish a database-engine decision", () => {
  const result = scanFiles(files({ "package.json": { dependencies: { pg: "8" } }, ".crosscheck/contract.json": contract([decision("database.engine", "postgresql")]) }));
  assert.equal(result.findings.some((item) => item.rule === "contract/unverified"), true);
});

test("Node 22 contract blocks CI configured for Node 20", () => {
  const workflow = "on: push\njobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n";
  const result = scanFiles(files({ "package.json": { engines: { node: "22.x" } }, ".github/workflows/ci.yml": workflow, ".crosscheck/contract.json": contract([decision("runtime.node", "22")]) }));
  assert.equal(result.findings.some((item) => item.class === "runtime.node" && item.values.includes("20")), true);
});

test("exact monorepo scopes do not inherit implicitly", () => {
  const result = scanFiles(files({
    "package.json": {}, "apps/web/package.json": { packageManager: "npm@11" }, "apps/web/package-lock.json": true,
    "services/api/package.json": { packageManager: "pnpm@10" }, "services/api/pnpm-lock.yaml": true,
    ".crosscheck/contract.json": contract([decision("package.manager", "npm", { scope: "apps/web" })]),
  }));
  assert.equal(result.findings.some((item) => item.tier === "contract"), false);
});

test("manual ORM contract can block while the generic ORM rule remains experimental", () => {
  const state = { "package.json": { dependencies: { "@prisma/client": "6", "drizzle-orm": "0.45" } } };
  const generic = scanFiles(files(state));
  assert.equal(generic.findings.find((item) => item.rule === "orm/conflicting-config").tier, "experimental");
  const explicit = scanFiles(files({ ...state, ".crosscheck/contract.json": contract([decision("database.orm", "prisma")]) }));
  assert.equal(explicit.findings.some((item) => item.tier === "contract" && item.values.includes("drizzle")), true);
});

test("manual database and auth contracts enforce direct repository evidence", () => {
  const result = scanFiles(files({
    "package.json": { dependencies: { mysql2: "3", "@clerk/nextjs": "6" } },
    ".crosscheck/contract.json": contract([decision("database.engine", "postgresql"), decision("auth.provider", "authjs")]),
  }));
  assert.deepEqual(result.findings.filter((item) => item.tier === "contract").map((item) => item.class).sort(), ["auth.provider", "database.engine"]);
});

test("root decision does not inherit into an independent nested package", () => {
  const result = scanFiles(files({
    "package.json": { packageManager: "pnpm@10" }, "pnpm-lock.yaml": true,
    "apps/web/package.json": { packageManager: "npm@11" }, "apps/web/package-lock.json": true,
    ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]),
  }));
  assert.equal(result.findings.some((item) => item.tier === "contract"), false);
});

test("generated AGENT_CONTEXT is not inference evidence", () => {
  const result = scanFiles(files({ ...pnpm, ".crosscheck/AGENT_CONTEXT.md": "Package manager: npm\n" }));
  assert.equal(result.evidence.some((item) => item.source === ".crosscheck/AGENT_CONTEXT.md"), false);
});

test("base contract blocks a repository contradiction when head contract is unchanged", () => {
  const policy = contract([decision("package.manager", "pnpm")]);
  const result = diffRepositories(files({ ...pnpm, ".crosscheck/contract.json": policy }), files({ ...pnpm, "package-lock.json": true, ".crosscheck/contract.json": policy }));
  assert.equal(result.diff.introduced.some((item) => item.rule === "contract/violation"), true);
});

test("PR cannot self-authorize a pnpm to npm migration", () => {
  const result = diffRepositories(
    files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) }),
    files({ ...npm, ".crosscheck/contract.json": contract([decision("package.manager", "npm")]) }),
  );
  assert.equal(result.diff.introduced.some((item) => item.rule === "contract/change-unapproved"), true);
  assert.equal(failing(result.diff.introduced).length, 0);
  assert.equal(failing(result.diff.introduced, { contractEnforcementAuthorized: true }).length > 0, true);
});

test("approved complete migration evaluates the proposed head contract and passes", () => {
  const result = diffRepositories(
    files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) }),
    files({ ...npm, ".crosscheck/contract.json": contract([decision("package.manager", "npm")]) }),
    { allowContractChange: true },
  );
  assert.equal(result.contractChangeApproved, true);
  assert.equal(failing(result.diff.introduced).length, 0);
});

test("approved migration still fails when final state contains npm and pnpm", () => {
  const result = diffRepositories(
    files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) }),
    files({ ...npm, "pnpm-lock.yaml": true, ".crosscheck/contract.json": contract([decision("package.manager", "npm")]) }),
    { allowContractChange: true },
  );
  assert.equal(failing(result.diff.introduced).length > 0, true, "the independent proven mixed-lockfile finding still fails locally");
  assert.equal(failing(result.diff.introduced, { contractEnforcementAuthorized: true }).length > 0, true);
});

test("approved contract-only migration fails when repository does not satisfy it", () => {
  const result = diffRepositories(
    files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) }),
    files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "npm")]) }),
    { allowContractChange: true },
  );
  assert.equal(result.diff.introduced.some((item) => item.rule === "contract/violation"), true);
});

test("contract deletion requires approval", () => {
  const base = files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) });
  assert.equal(diffRepositories(base, files(pnpm)).diff.introduced.some((item) => item.rule === "contract/change-unapproved"), true);
  assert.equal(failing(diffRepositories(base, files(pnpm), { allowContractChange: true }).diff.introduced).length, 0);
});

test("initial valid contract adoption needs no migration approval but must match head", () => {
  const clean = diffRepositories(files(pnpm), files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "pnpm")]) }));
  assert.equal(clean.initialContractAdoption, true);
  assert.equal(failing(clean.diff.introduced).length, 0);
  const bad = diffRepositories(files(pnpm), files({ ...pnpm, ".crosscheck/contract.json": contract([decision("package.manager", "npm")]) }));
  assert.equal(bad.diff.introduced.some((item) => item.rule === "contract/violation"), true);
});

test("strong and weak contract evidence preserve the precision boundary", () => {
  const pmPolicy = contract([decision("package.manager", "pnpm")]);
  const weakPm = scanFiles(files({ ...pnpm, ".github/workflows/ci.yml": "steps:\n  - run: npm install\n", ".crosscheck/contract.json": pmPolicy }));
  assert.equal(weakPm.findings.some((item) => item.rule === "contract/possible-violation"), true);
  assert.equal(weakPm.findings.some((item) => item.rule === "contract/violation"), false);
  const strongPm = scanFiles(files({ ...pnpm, ".github/workflows/ci.yml": "steps:\n  - run: npm ci\n", ".crosscheck/contract.json": pmPolicy }));
  assert.equal(strongPm.findings.some((item) => item.rule === "contract/violation"), true);

  const dbPolicy = contract([decision("database.engine", "postgresql")]);
  const weakDb = scanFiles(files({ "package.json": { dependencies: { mongodb: "6" } }, "prisma/schema.prisma": "datasource db {\n provider = \"postgresql\"\n}\n", ".crosscheck/contract.json": dbPolicy }));
  assert.equal(weakDb.findings.some((item) => item.rule === "contract/possible-violation"), true);
  assert.equal(failing(weakDb.findings, { contractEnforcementAuthorized: true }).length, 0);
  const strongDb = scanFiles(files({ "package.json": {}, "prisma/schema.prisma": "datasource db {\n provider = \"mysql\"\n}\n", ".crosscheck/contract.json": dbPolicy }));
  assert.equal(strongDb.findings.some((item) => item.rule === "contract/violation"), true);
});

test("auth contracts distinguish unverified, satisfied, and strongly contradicted", () => {
  const authPolicy = contract([decision("auth.provider", "clerk")]);
  assert.equal(scanFiles(files({ "package.json": {}, ".crosscheck/contract.json": authPolicy })).findings.some((item) => item.rule === "contract/unverified"), true);
  assert.equal(scanFiles(files({ "package.json": { dependencies: { "@clerk/nextjs": "6" } }, ".crosscheck/contract.json": authPolicy })).findings.some((item) => item.tier === "contract"), false);
  assert.equal(scanFiles(files({ "package.json": { dependencies: { "next-auth": "5" } }, ".crosscheck/contract.json": authPolicy })).findings.some((item) => item.rule === "contract/violation"), true);
});

test("generic proven findings still fail locally and experimental findings never do", () => {
  const result = scanFiles(files({ "package.json": { packageManager: "pnpm@10", dependencies: { "next-auth": "5", "@clerk/nextjs": "6" } }, "pnpm-lock.yaml": true, "package-lock.json": true }));
  assert.equal(failing(result.findings).some((item) => item.tier === "proven"), true);
  assert.equal(failing(result.findings).some((item) => item.tier === "experimental"), false);
});

test("agent context and JSON are deterministic and digest-backed", () => {
  const value = parseContract(contract([decision("package.manager", "pnpm"), decision("runtime.node", "22")]));
  assert.equal(renderAgentContext(value), renderAgentContext(value));
  assert.equal(contextObject(value).contractDigest, contractDigest(value));
  assert.match(renderAgentContext(value), /Do not edit this file manually/);
});
