// Every false positive observed in the historical live-precision set is pinned here as a
// regression, next to the true positives that must keep firing.
import test from "node:test";
import assert from "node:assert/strict";
import { scanFiles } from "../src/crosscheck.mjs";
import { parseInstall, instructionDeclarations } from "../src/evidence.mjs";

const scan = (files) => scanFiles(new Map(Object.entries(files).map(([k, v]) => [k, v === true ? null : typeof v === "string" ? v : JSON.stringify(v)])));
const rules = (files) => scan(files).findings.map((f) => `${f.rule}@${f.scope || "."}=${f.values.join("|")}`);

// ---------- true positives from the live set ----------
test("true positive: two lockfiles in one package", () => {
  assert.deepEqual(rules({ "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true }), ["package-manager/conflicting-config@.=npm|pnpm"]);
});
test("bun.lock + CI plain `npm install` is a note, not a finding (indistinguishable from deliberate use)", () => {
  const r = scan({ "package.json": {}, "bun.lock": true, ".github/workflows/ci.yml": "jobs:\n  t:\n    steps:\n      - run: npm install\n" });
  assert.deepEqual(r.findings, []);
  assert.match(r.model.notes[0].text, /installs with npm \(not lockfile-pinned\)/);
});
test("true positive: `npm ci` in a Bun repo cannot succeed (no package-lock.json)", () => {
  assert.deepEqual(rules({ "package.json": {}, "bun.lockb": true, ".github/workflows/node.js.yml": "jobs:\n  t:\n    steps:\n      - run: npm ci\n" }), ["package-manager/install-command@.=bun|npm"]);
});
test("false positive: `bun install` used to compile a release binary in a pnpm repo is only a note", () => {
  const wf = "jobs:\n  b:\n    steps:\n      - uses: oven-sh/setup-bun@v2\n      - run: bun install --ignore-scripts\n      - run: bun build --compile src/cli.ts\n";
  assert.deepEqual(rules({ "package.json": { packageManager: "pnpm@10" }, "pnpm-lock.yaml": true, ".github/workflows/release.yml": wf }), []);
});
test("false positive: Medusa's framework ORM (MikroORM) beside Drizzle is not an ORM conflict", () => {
  assert.deepEqual(rules({ "apps/medusa/package.json": { dependencies: { "@medusajs/framework": "2", "@mikro-orm/core": "6" } }, "apps/medusa/drizzle.config.ts": "export default { dialect: 'postgresql' }" }), []);
});
test("false positive: fixture packages under testing/ are not the project's packages", () => {
  assert.deepEqual(rules({ "package.json": {}, "ast/src/testing/typescript/package.json": { dependencies: { "@prisma/client": "6", sequelize: "6", typeorm: "0.3" } } }), []);
});
test("pnpm install inside CI is lockfile-strict (pnpm freezes by default in CI)", () => {
  assert.deepEqual(rules({ "package.json": {}, "package-lock.json": true, ".github/workflows/ci.yml": "jobs:\n  t:\n    steps:\n      - run: pnpm install\n" }), ["package-manager/install-command@.=npm|pnpm"]);
});

// ---------- false positives from the live set ----------
test("false positive: README listing yarn/npm/pnpm for users is not evidence", () => {
  assert.deepEqual(rules({ "package.json": { packageManager: "pnpm@10" }, "pnpm-lock.yaml": true, "README.md": "Use your package manager — `yarn deploy <env>`, `npm run deploy <env>`, or `pnpm deploy`." }), []);
});
test("false positive: 'npm trusted publishing' in AGENTS.md is not a package-manager decision", () => {
  assert.deepEqual(rules({ "package.json": { packageManager: "pnpm@11" }, "pnpm-lock.yaml": true, "AGENTS.md": "- Releases ship via `.github/workflows/publish.yml` on a `v*` tag, using npm **trusted publishing**." }), []);
});
test("false positive: npm install --prefix <dir> <tarball> smoke test is not the project's install", () => {
  const wf = "jobs:\n  s:\n    steps:\n      - run: |\n          npm install --prefix \"$SMOKE_DIRECTORY\" --ignore-scripts --no-audit --no-fund \"$TARBALL\"\n";
  assert.deepEqual(rules({ "package.json": { packageManager: "pnpm@11" }, "pnpm-lock.yaml": true, ".github/workflows/release.yml": wf, "README.md": "Auto-detects package manager (npm, pnpm, yarn, bun)" }), []);
});
test("false positive: README install alternatives are not evidence", () => {
  assert.deepEqual(rules({ "package.json": {}, "bun.lock": true, "README.md": "# Using npm (recommended)\nnpm install\n# Using yarn\nyarn\n# Using pnpm\npnpm install" }), []);
});
test("false positive: Dockerfile conditional fallback over several lockfiles", () => {
  const df = "FROM node:20\nWORKDIR /app\nRUN \\\n  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \\\n  elif [ -f package-lock.json ]; then npm ci; \\\n  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \\\n  fi\n";
  assert.deepEqual(rules({ "package.json": {}, "yarn.lock": true, Dockerfile: df }), []);
});
test("false positive: Drizzle config that selects its dialect at runtime is not a single decision", () => {
  const cfg = "export default getDbDriver() === 'sqlite'\n  ? defineConfig({ dialect: 'sqlite' })\n  : defineConfig({ dialect: 'postgresql' });\n";
  assert.deepEqual(rules({ "package.json": { dependencies: { postgres: "3" } }, "drizzle.config.ts": cfg, ".env.example": "DATABASE_URL=postgresql://u:p@localhost/db\n" }), []);
});
test("false positive: PostgreSQL via Prisma plus better-sqlite3 used deliberately is not flagged", () => {
  assert.deepEqual(rules({ "backend/package.json": { dependencies: { pg: "8", "better-sqlite3": "11", "@prisma/client": "6" } }, "backend/prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n' }), []);
});
test("false positive: README prose about SQLite does not contradict a PostgreSQL datasource", () => {
  assert.deepEqual(rules({ "package.json": {}, ".env.example": "DATABASE_URL=postgres://localhost/app\n", "AGENTS.md": "- **Database**: PostgreSQL (via Drizzle ORM + node-postgres)\n", "README.md": "| `DATABASE_PATH` | `./data/app.db` | SQLite database location |" }), []);
});
test("false positive: package.json with a UTF-8 BOM parses (npm accepts it)", () => {
  const r = scan({ "package.json": "\uFEFF" + JSON.stringify({ name: "x", packageManager: "npm@10" }), "package-lock.json": true });
  assert.deepEqual(r.findings, []);
  assert.equal(r.model.packages[0].packageManager, "npm");
});

// ---------- install-command parsing ----------
test("install commands that do not establish the project's package manager are ignored", () => {
  for (const c of [
    "npm install -g pnpm", "npm i -g vercel", "yarn global add turbo", "npx prisma generate", "pnpm dlx create-next-app", "bunx tsc",
    "npm install --prefix ./smoke pkg.tgz", "npm install left-pad", "npm ci --prefix web", "corepack enable",
    "# npm ci", "npm run build", "npm publish --provenance", "yarn build", "pnpm --filter web build",
    "npm ci || yarn install", "if [ -f yarn.lock ]; then yarn; fi", "npm install --package-lock-only",
  ]) assert.equal(parseInstall(c), null, c);
  for (const [c, m, strict] of [["npm ci", "npm", true], ["npm install", "npm", false], ["npm ci --include=dev", "npm", true], ["pnpm install --frozen-lockfile", "pnpm", true], ["pnpm i", "pnpm", false], ["yarn", "yarn", false], ["yarn --frozen-lockfile", "yarn", true], ["yarn install --immutable", "yarn", true], ["bun install --frozen-lockfile", "bun", true], ["bun ci", "bun", true], ["pnpm install --no-frozen-lockfile", "pnpm", false]]) assert.deepEqual(parseInstall(c), { manager: m, strict }, c);
});

test("workflow installs in another working-directory are attributed there, or ignored when unresolvable", () => {
  const wf = "jobs:\n  a:\n    steps:\n      - run: npm ci\n        working-directory: docs-site\n      - run: npm ci\n        working-directory: apps/web\n";
  const r = rules({ "package.json": {}, "pnpm-lock.yaml": true, "apps/web/package.json": {}, "apps/web/pnpm-lock.yaml": true, ".github/workflows/ci.yml": wf });
  assert.deepEqual(r, ["package-manager/install-command@apps/web=npm|pnpm"]);
});
test("a cd before the install in a run block moves it somewhere unresolved: ignored", () => {
  const wf = "jobs:\n  a:\n    steps:\n      - run: |\n          cd e2e\n          npm ci\n";
  assert.deepEqual(rules({ "package.json": {}, "pnpm-lock.yaml": true, ".github/workflows/ci.yml": wf }), []);
});
test("installs inside a multi-line if/fi block are not decisions", () => {
  const wf = "jobs:\n  a:\n    steps:\n      - run: |\n          if [ -f package-lock.json ]; then\n            npm ci\n          fi\n";
  assert.deepEqual(rules({ "package.json": {}, "pnpm-lock.yaml": true, ".github/workflows/ci.yml": wf }), []);
});
test("Dockerfiles in a workspace are not attributed (the install target is ambiguous)", () => {
  assert.deepEqual(rules({ "package.json": {}, "pnpm-lock.yaml": true, "apps/api/package.json": {}, Dockerfile: "FROM node\nRUN npm ci\n" }), []);
});

// ---------- agent instruction declarations ----------
test("only assertive, single-valued, non-negated instruction lines count", () => {
  const decl = (s) => instructionDeclarations(s).map((d) => `${d.class}=${d.value}`);
  assert.deepEqual(decl("- **Package Manager**: Yarn 1.x"), ["package.manager=yarn"]);
  assert.deepEqual(decl("Use pnpm for everything."), ["package.manager=pnpm"]);
  assert.deepEqual(decl("- ORM: Drizzle"), ["database.orm=drizzle"]);
  assert.deepEqual(decl("- apps/web: Next.js app. Uses Prisma, TRPC, Tailwind."), ["database.orm=prisma"]);
  assert.deepEqual(decl("Never use npm or yarn."), []);
  assert.deepEqual(decl("Don't use npm."), []);
  assert.deepEqual(decl("We migrated from Prisma to Drizzle."), []);
  assert.deepEqual(decl("Supports npm, pnpm, yarn and bun."), []);
  assert.deepEqual(decl("```\nuse npm\n```"), []);
  assert.deepEqual(decl("> Package manager: npm"), []);
  assert.deepEqual(decl("Run npm publish to release."), []);
});
test("stale agent instructions contradicting the configured ORM are reported with file and line", () => {
  const r = scan({ "package.json": {}, "apps/web/package.json": { dependencies: { "drizzle-orm": "0.45" } }, "AGENTS.md": "# Guide\n\n- apps/web: Next.js app. Uses Prisma, TRPC.\n" });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].rule, "orm/agent-instructions");
  assert.equal(r.findings[0].scope, "apps/web");
  assert.ok(r.findings[0].evidence.some((e) => e.source === "AGENTS.md" && e.line === 3));
});

// ---------- database / auth ----------
test("document DB + SQL runtime drivers are a note, not a finding (0/2 verified on the unseen holdout)", () => {
  const r = scan({ "server/package.json": { dependencies: { mongoose: "8", pg: "8" } } });
  assert.deepEqual(r.findings, []);
  assert.match(r.model.notes[0].text, /MongoDB and PostgreSQL are both runtime dependencies in server\//);
});
test("false positive: MongoDB integration tools and local-dev infra templates are not contradictions", () => {
  assert.deepEqual(rules({ "package.json": { dependencies: { mongodb: "6", postgres: "3" } } }), []);
  assert.deepEqual(rules({ "infra/package.json": { dependencies: { mongodb: "6", mysql2: "3" } } }), []);
});
test("true positive: better-auth next to a still-used Clerk verifier is an auth conflict", () => {
  assert.deepEqual(rules({ "apps/server/package.json": { dependencies: { "better-auth": "1", "@clerk/express": "1" } } }), ["auth/conflicting-providers@apps/server=better-auth|clerk"]);
});
test("Prisma provider and hard-coded Drizzle dialect that disagree are flagged", () => {
  assert.deepEqual(rules({ "package.json": {}, "prisma/schema.prisma": 'datasource db {\n provider = "mysql"\n}\n', "drizzle.config.ts": "export default { dialect: 'postgresql' }" }), ["database/conflicting-datasource@.=mysql|postgresql", "orm/conflicting-config@.=drizzle|prisma"]);
});
test("passport alongside another provider is not an auth conflict", () => {
  assert.deepEqual(rules({ "package.json": { dependencies: { passport: "0.7", "@clerk/express": "1" } } }), []);
});
test("repository model says 'not established' instead of guessing", () => {
  const r = scan({ "package.json": { dependencies: { pg: "8", mysql2: "3" } } });
  assert.equal(r.model.packages[0].packageManager, null);
  assert.deepEqual(r.model.packages[0].database, { drivers: ["mysql", "postgresql"] });
});

// ---------- holdout-v4 refinements (post-hoc: not yet validated on unseen data) ----------
test("false positive: a workflow_dispatch-only workflow is not normal CI", () => {
  const wf = "name: NodeJS with Webpack (DISABLED)\non:\n  workflow_dispatch: # Only manual trigger\n    inputs:\n      reason:\n        required: false\njobs:\n  build:\n    steps:\n    - run: npm ci\n";
  assert.deepEqual(rules({ "package.json": {}, "pnpm-lock.yaml": true, ".github/workflows/webpack.yml": wf }), []);
  const live = "on:\n  push:\n  workflow_dispatch:\njobs:\n  b:\n    steps:\n      - run: npm ci\n";
  assert.deepEqual(rules({ "package.json": {}, "pnpm-lock.yaml": true, ".github/workflows/ci.yml": live }), ["package-manager/install-command@.=npm|pnpm"]);
});
test("false positive: switchable Prisma provider with a commented alternative DATABASE_URL is dual-engine by design", () => {
  const env = '# PostgreSQL (default)\nDATABASE_URL="postgresql://u:p@localhost:5432/db"\n\n# SQLite\n# DATABASE_URL="file:./db.sqlite"\n';
  assert.deepEqual(rules({
    "package.json": {}, ".env.example": env,
    "prisma/schema.prisma": 'datasource db {\n  provider = "sqlite"\n}\n',
    "prisma/schema.postgres.prisma": 'datasource db {\n  provider = "postgresql"\n}\n',
  }), []);
});
