// Evidence extraction. Every rule in rules.mjs reads only what this module
// produces, and this module reads only files a provider hands it, so the same
// logic runs over a working tree, a git commit, or an in-memory fixture.
//
// Precision policy (why each source is or is not trusted):
// - Lockfiles, the packageManager field, package.json dependencies, the Prisma
//   datasource provider and a single hard-coded Drizzle dialect are
//   configuration: they are the repository's decision, not a description of it.
// - README prose is never evidence. READMEs routinely list alternatives for
//   *users* ("install with npm, yarn or pnpm"), feature text ("auto-detects
//   npm, pnpm, yarn, bun") and publishing notes ("npm trusted publishing").
// - Agent instruction files (AGENTS.md, CLAUDE.md, CODEX.md, GEMINI.md,
//   .github/copilot-instructions.md) count only for assertive, single-valued
//   declarations ("Package manager: pnpm", "ORM: Drizzle"), because that is
//   exactly what an agent will act on.
// - CI / container install commands count only when they install *this*
//   project, at a directory CrossCheck can resolve, unconditionally.

export const LOCKFILES = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

// The supported ORM set. Framework-owned ORMs (e.g. MikroORM inside Medusa)
// are deliberately absent: they arrive as framework requirements, not choices.
const ORM_DEPS = { "@prisma/client": "prisma", prisma: "prisma", "drizzle-orm": "drizzle", typeorm: "typeorm", sequelize: "sequelize" };
// Auth providers that own the whole sign-in flow; two of them in one package is
// a decision conflict. Passport (middleware) and Supabase (also a database
// client) are deliberately excluded: coexistence is routinely legitimate.
const AUTH_DEPS = {
  "next-auth": "authjs", "@auth/core": "authjs", "@auth/sveltekit": "authjs", "@auth/express": "authjs",
  "@clerk/nextjs": "clerk", "@clerk/clerk-react": "clerk", "@clerk/clerk-sdk-node": "clerk", "@clerk/express": "clerk", "@clerk/backend": "clerk", "@clerk/remix": "clerk",
  "better-auth": "better-auth",
  "@auth0/nextjs-auth0": "auth0", "@auth0/auth0-react": "auth0", "@auth0/auth0-spa-js": "auth0", "express-openid-connect": "auth0",
  lucia: "lucia",
};
const DOC_DB_DEPS = { mongodb: "mongodb", mongoose: "mongodb" };
const SQL_DB_DEPS = { pg: "postgresql", postgres: "postgresql", "@neondatabase/serverless": "postgresql", mysql: "mysql", mysql2: "mysql", sqlite3: "sqlite", "better-sqlite3": "sqlite", "@libsql/client": "sqlite" };

export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CODEX.md", "GEMINI.md"];
// Directories that never hold the project's own decisions: dependencies, build
// output, and corpora of sample/fixture packages (a parser's test fixtures may
// deliberately contain every ORM at once).
export const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".nuxt", ".svelte-kit", "dist", "build", "out", "coverage", ".turbo", ".vercel", ".output", "vendor", "tmp", ".cache", "target", ".venv", "venv", "__pycache__", "fixtures", "__fixtures__", "testdata", "test-fixtures", "e2e-fixtures", "examples", "example", "templates", "template", "test", "tests", "__tests__", "testing", "spec", "__mocks__", "mocks", "samples", "sample"]);
export const MAX_DEPTH = 6;

const CONDITIONAL = /(^|[\s;(])(if|then|elif|else|fi|case|esac|while|until)(?=[\s;)]|$)|\|\||\[\s+-[a-z]\s/;
const NEGATION = /\b(no|not|never|don'?t|do not|avoid|without|instead of|rather than|replac\w*|remov\w*|migrat\w*|drop(?:ped|ping)?|deprecat\w*|reject\w*|legacy|formerly|previously|used to|switched from|moved? (?:off|away))\b/i;

export function normalizePath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Which paths CrossCheck reads. Shared by every provider so they see the same files. */
export function isRelevantPath(path) {
  const rel = normalizePath(path);
  if (!rel) return false;
  if (rel === ".crosscheck/contract.json") return true;
  const parts = rel.split("/");
  if (parts.length > MAX_DEPTH + 1) return false;
  const dirs = parts.slice(0, -1);
  if (dirs.some((d) => SKIP_DIRS.has(d) || (d.startsWith(".") && d !== ".github"))) return false;
  const base = parts[parts.length - 1];
  if (base === "package.json" || LOCKFILES[base]) return true;
  if ([".nvmrc", ".node-version", ".tool-versions"].includes(base)) return true;
  if (/^drizzle\.config\.(ts|js|mjs|cjs|mts|cts)$/.test(base)) return true;
  if (/^schema\.[\w-]+\.prisma$/.test(base) && dirs[dirs.length - 1] === "prisma") return true; // presence only
  if (base === "schema.prisma" && dirs[dirs.length - 1] === "prisma") return true;
  if ([".env.example", ".env.sample", ".env.template"].includes(base)) return true;
  if (INSTRUCTION_FILES.includes(base)) return true;
  if (rel === ".github/copilot-instructions.md") return true;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel)) return true;
  if (base === "Dockerfile" || base === "vercel.json") return true;
  return false;
}

export function isPresenceOnly(path) {
  return Boolean(LOCKFILES[normalizePath(path).split("/").pop()]);
}

/**
 * files: Map<path, string|null>  (null = present, content not needed/read)
 * returns { scopes, evidence, incomplete, instructionFiles, installCommands }
 */
export function extractEvidence(files) {
  const paths = [...files.keys()].map(normalizePath).filter(isRelevantPath).sort();
  const text = (p) => files.get(p) ?? files.get(p.replace(/\//g, "\\")) ?? null;

  const scopes = ["", ...paths.filter((p) => p.endsWith("/package.json")).map((p) => p.slice(0, -"/package.json".length))].filter((v, i, a) => a.indexOf(v) === i).sort();
  const scopeSet = new Set(scopes);
  const scopeOf = (path) => {
    const parts = normalizePath(path).split("/");
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const cand = parts.slice(0, i).join("/");
      if (scopeSet.has(cand)) return cand;
    }
    return "";
  };
  const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

  const evidence = [];
  const incomplete = [];
  const instructionFiles = [];
  const switchablePrisma = new Set([...files.keys()].map(normalizePath).filter((p) => /(^|\/)prisma\/schema\.[\w-]+\.prisma$/.test(p)).map(dirOf));
  const add = (e) => evidence.push({ line: null, ...e });

  for (const path of paths) {
    const base = path.split("/").pop();
    const dir = dirOf(path);

    if (LOCKFILES[base]) {
      // A lockfile speaks only for the package directory it sits in; an orphan
      // lockfile in a directory without package.json is not charged to a parent.
      if (scopeSet.has(dir)) add({ kind: "lockfile", class: "package.manager", value: LOCKFILES[base], scope: dir, source: path, detail: "lockfile present", strength: "config" });
      continue;
    }

    if (base === "package.json") {
      const raw = text(path);
      if (raw == null) continue;
      let pkg;
      try {
        pkg = JSON.parse(raw.replace(/^﻿/, "")); // npm tolerates a UTF-8 BOM; so do we
      } catch (error) {
        incomplete.push({ source: path, scope: dir, reason: `not valid JSON: ${String(error.message).split("\n")[0].slice(0, 120)}` });
        continue;
      }
      if (!pkg || typeof pkg !== "object") continue;
      const scope = dir;
      const runtime = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
      const all = { ...runtime, ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) };
      for (const name of Object.keys(all)) {
        if (ORM_DEPS[name]) add({ kind: "dependency", class: "database.orm", value: ORM_DEPS[name], scope, source: path, detail: `dependency ${name}`, strength: "config" });
        if (AUTH_DEPS[name]) add({ kind: "dependency", class: "auth.provider", value: AUTH_DEPS[name], scope, source: path, detail: `dependency ${name}`, strength: "config" });
      }
      for (const name of Object.keys(runtime)) {
        if (DOC_DB_DEPS[name]) add({ kind: "runtime-driver", class: "database.engine", value: DOC_DB_DEPS[name], scope, source: path, detail: `runtime dependency ${name}`, strength: "driver" });
        if (SQL_DB_DEPS[name]) add({ kind: "runtime-driver", class: "database.engine", value: SQL_DB_DEPS[name], scope, source: path, detail: `runtime dependency ${name}`, strength: "driver" });
      }
      if (typeof pkg.packageManager === "string") {
        const manager = pkg.packageManager.split("@")[0].trim().toLowerCase();
        if (["npm", "pnpm", "yarn", "bun"].includes(manager)) add({ kind: "packageManager-field", class: "package.manager", value: manager, scope, source: path, detail: `"packageManager": "${pkg.packageManager}"`, strength: "config" });
      }
      if (typeof pkg.engines?.node === "string") {
        const major = normalizeNodeMajor(pkg.engines.node);
        if (major) add({ kind: "runtime-config", class: "runtime.node", value: major, scope, source: path, detail: `"engines.node": "${pkg.engines.node}"`, strength: "config" });
      }
      continue;
    }

    if (base === ".nvmrc" || base === ".node-version") {
      const raw = (text(path) || "").trim();
      const major = normalizeNodeMajor(raw);
      if (major && scopeSet.has(dir)) add({ kind: "runtime-config", class: "runtime.node", value: major, scope: dir, source: path, detail: `${base}: ${raw}`, strength: "config" });
      continue;
    }

    if (base === ".tool-versions") {
      const rows = (text(path) || "").split(/\r?\n/).map((line) => /^\s*nodejs\s+(.+?)\s*(?:#.*)?$/.exec(line)).filter(Boolean);
      if (rows.length === 1 && rows[0][1].trim().split(/\s+/).length === 1) {
        const major = normalizeNodeMajor(rows[0][1]);
        if (major && scopeSet.has(dir)) add({ kind: "runtime-config", class: "runtime.node", value: major, scope: dir, source: path, detail: `nodejs ${rows[0][1].trim()}`, strength: "config" });
      }
      continue;
    }

    if (base === "schema.prisma") {
      const raw = text(path);
      const scope = scopeOf(path);
      add({ kind: "orm-config", class: "database.orm", value: "prisma", scope, source: path, detail: "Prisma schema present", strength: "config" });
      // Sibling schema variants (schema.postgres.prisma, …) mean the provider is swapped per environment.
      if (switchablePrisma.has(dir)) continue;
      const ds = raw && /datasource\s+\w+\s*\{([\s\S]*?)\}/.exec(raw);
      const m = ds && /^\s*provider\s*=\s*["'](postgresql|postgres|mysql|sqlite|mongodb|cockroachdb|sqlserver)["']/m.exec(ds[1]);
      if (m) add({ kind: "datasource", class: "database.engine", value: normDb(m[1]), scope, source: path, line: lineOf(raw, m.index + ds.index), detail: `datasource provider = "${m[1]}"`, strength: "declaration" });
      continue;
    }

    if (/^drizzle\.config\./.test(base)) {
      const raw = text(path) || "";
      const scope = scopeOf(path);
      add({ kind: "orm-config", class: "database.orm", value: "drizzle", scope, source: path, detail: "Drizzle config present", strength: "config" });
      // Only a single, hard-coded dialect is a decision. A config that selects
      // between dialects at runtime supports several engines by design.
      const dialects = [...raw.matchAll(/dialect\s*:\s*["'](postgresql|mysql|sqlite|turso|singlestore|gel)["']/g)];
      const distinct = [...new Set(dialects.map((d) => normDb(d[1])))];
      if (distinct.length === 1) add({ kind: "datasource", class: "database.engine", value: distinct[0], scope, source: path, line: lineOf(raw, dialects[0].index), detail: `dialect: "${dialects[0][1]}"`, strength: "declaration" });
      continue;
    }

    if (base.startsWith(".env")) {
      const raw = text(path) || "";
      const scope = scopeOf(path);
      const found = [];
      const commented = new Set();
      raw.split(/\r?\n/).forEach((line, i) => {
        const m = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*["']?([a-z0-9+]+):/i.exec(line);
        if (m) { const e = dbFromScheme(m[1]); if (e) found.push({ e, i }); }
        const c = /^\s*#\s*(?:export\s+)?DATABASE_URL\s*=\s*["']?([a-z0-9+]+):/i.exec(line);
        if (c) { const e = dbFromScheme(c[1]); if (e) commented.add(e); }
      });
      // A commented-out DATABASE_URL for another engine documents a supported choice, not a decision.
      if ([...commented].some((e) => !found.some((f) => f.e === e))) continue;
      const distinct = [...new Set(found.map((f) => f.e))];
      // Several DATABASE_URL examples for different engines = documented choice, not a decision.
      if (distinct.length === 1) add({ kind: "datasource", class: "database.engine", value: distinct[0], scope, source: path, line: found[0].i + 1, detail: "example DATABASE_URL", strength: "declaration" });
      continue;
    }

    if (INSTRUCTION_FILES.includes(base) || path === ".github/copilot-instructions.md") {
      instructionFiles.push(path);
      const raw = text(path) || "";
      const scope = path === ".github/copilot-instructions.md" ? "" : scopeOf(path) === dir ? dir : (scopeSet.has(dir) ? dir : scopeOf(path));
      for (const d of instructionDeclarations(raw, scopeSet)) {
        add({ kind: "instruction", class: d.class, value: d.value, scope: d.scope ?? scope, source: path, line: d.line, detail: d.text, strength: "instruction" });
      }
      continue;
    }

    if (/^\.github\/workflows\//.test(path)) {
      if (manualOnly(text(path) || "")) continue; // workflow_dispatch-only: not part of normal CI
      const workflow = text(path) || "";
      for (const c of workflowInstalls(workflow, scopeSet)) add({ kind: c.strict ? "install-command" : "install-command-unpinned", class: "package.manager", value: c.manager, scope: c.scope, source: path, line: c.line, detail: c.text, strength: "command" });
      for (const n of workflowNodeVersions(workflow)) add({ kind: "runtime-config", class: "runtime.node", value: n.major, scope: "", source: path, line: n.line, detail: `actions/setup-node node-version: ${n.raw}`, strength: "config" });
      continue;
    }
    if (base === "Dockerfile") {
      // A Dockerfile installs the package in its own directory; in a workspace
      // the install may target any member, so only single-package repos count.
      if (scopes.length > 1) continue;
      for (const c of dockerInstalls(text(path) || "")) add({ kind: c.strict ? "install-command" : "install-command-unpinned", class: "package.manager", value: c.manager, scope: dir, source: path, line: c.line, detail: c.text, strength: "command" });
      continue;
    }
    if (base === "vercel.json") {
      let v; try { v = JSON.parse((text(path) || "").replace(/^﻿/, "")); } catch { continue; }
      const cmd = typeof v?.installCommand === "string" ? v.installCommand : null;
      const inst = cmd && parseInstall(cmd);
      if (inst) add({ kind: inst.strict ? "install-command" : "install-command-unpinned", class: "package.manager", value: inst.manager, scope: dir, source: path, line: null, detail: `installCommand: ${cmd}`, strength: "command" });
    }
  }

  return { scopes, evidence, incomplete, instructionFiles };
}

/** Returns a Node major only when the expression admits exactly one major. */
export function normalizeNodeMajor(value) {
  const raw = String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw || /\$\{\{|\blts\b|\bnode\b|\|\||\s+-\s+/i.test(raw)) return null;
  let match = /^v?(\d+)(?:\.\d+(?:\.\d+)?)?$/.exec(raw);
  if (match) return String(Number(match[1]));
  match = /^(\d+)\.x(?:\.x)?$/i.exec(raw);
  if (match) return String(Number(match[1]));
  match = /^\^(\d+)\.0\.0$/.exec(raw);
  if (match) return String(Number(match[1]));
  match = /^>=\s*(\d+)(?:\.0(?:\.0)?)?\s+<\s*(\d+)(?:\.0(?:\.0)?)?$/.exec(raw);
  if (match && Number(match[2]) === Number(match[1]) + 1) return String(Number(match[1]));
  return null;
}

function workflowNodeVersions(raw) {
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/uses:\s*actions\/setup-node@/i.test(lines[i])) continue;
    const indent = /^\s*/.exec(lines[i])[0].length;
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
      const currentIndent = /^\s*/.exec(lines[j])[0].length;
      if (j > i + 1 && /^\s*-\s+(?:uses|run|name):/.test(lines[j]) && currentIndent <= indent) break;
      const match = /^\s*node-version\s*:\s*(.+?)\s*(?:#.*)?$/.exec(lines[j]);
      if (!match) continue;
      const major = normalizeNodeMajor(match[1]);
      if (major) out.push({ major, raw: match[1].trim().replace(/^['"]|['"]$/g, ""), line: j + 1 });
      break;
    }
  }
  return out;
}

// ---------------- agent instruction declarations ----------------

const PM = "(pnpm|npm|yarn|bun)";
const PATTERNS = [
  { class: "package.manager", re: new RegExp(`\\bpackage[- ]manager\\b[*_\`\\s]*(?::|=|\\bis\\b|—|–|-)\\s*[*_\`]*${PM}\\b`, "i") },
  { class: "package.manager", re: new RegExp(`^\\s*(?:[-*]\\s+)?(?:always\\s+|only\\s+)?use\\s+[*_\`]*${PM}[*_\`]*(?=\\s*(?:$|[.,;:(]|\\s+(?:for|to|as|when|with|only|—|–|-)\\b))`, "i") },
  { class: "database.orm", re: /\b(?:orm|data(?:base)? layer|database library)\b[*_`\s]*(?::|=|\bis\b|—|–|-)\s*[*_`]*(prisma|drizzle|typeorm|sequelize)\b/i },
  { class: "database.orm", re: /\buses?\s+[*_`]*(prisma|drizzle|typeorm|sequelize)\b/i },
  { class: "database.engine", re: /\bdatabase(?:\s+engine)?\b[*_`\s]*(?::|=|\bis\b|—|–|-)\s*[*_`]*(postgres(?:ql)?|mysql|sqlite|mongodb|mongo)\b/i },
  { class: "auth.provider", re: /\bauth(?:entication)?(?:\s+provider)?\b[*_`\s]*(?::|=|\bis\b|—|–|-)\s*[*_`]*(clerk|auth\.js|next-?auth|better[- ]auth|auth0|lucia)\b/i },
];
const ALL_VALUES = {
  "package.manager": /\b(pnpm|npm|yarn|bun)\b/gi,
  "database.orm": /\b(prisma|drizzle|typeorm|sequelize)\b/gi,
  "database.engine": /\b(postgres(?:ql)?|mysql|sqlite|mongodb|mongo)\b/gi,
  "auth.provider": /\b(clerk|auth\.js|next-?auth|better[- ]auth|auth0|lucia)\b/gi,
};
const NORMALIZE = {
  "package.manager": (v) => v.toLowerCase(),
  "database.orm": (v) => v.toLowerCase(),
  "database.engine": (v) => normDb(v),
  "auth.provider": (v) => normAuth(v),
};

export function instructionDeclarations(raw, scopeSet = new Set([""])) {
  const out = [];
  let inFence = false;
  raw.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence || !line.trim()) return;
    if (/^\s*>/.test(line)) return; // quoted material is not a declaration
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      // Exactly one value of this class on the line, and no negation anywhere.
      const values = new Set([...line.matchAll(ALL_VALUES[p.class])].map((x) => NORMALIZE[p.class](x[1])));
      if (values.size !== 1) continue;
      if (NEGATION.test(line)) continue;
      // Tooling mentions that are not a package-manager decision.
      if (p.class === "package.manager" && /\b(publish|trusted publishing|registry|audit|npx|dlx|bunx|global|-g)\b/i.test(line)) continue;
      const scopeMatch = /(?:^|[\s`*(-])((?:apps|packages|services|libs|backend|frontend|server|client|web|api)(?:\/[\w.-]+)?)\/?[`*]?\s*[:—–-]/.exec(line);
      const scope = scopeMatch && scopeSet.has(scopeMatch[1]) ? scopeMatch[1] : undefined;
      out.push({ class: p.class, value: NORMALIZE[p.class](m[1]), line: i + 1, text: line.trim().slice(0, 160), scope });
      break;
    }
  });
  return out;
}

// ---------------- install commands ----------------

/**
 * If `cmd` installs the current project's dependencies, returns
 * { manager, strict }. `strict` means the step requires that manager's lockfile
 * (npm ci, --frozen-lockfile, --immutable, and pnpm install inside CI, where pnpm
 * freezes the lockfile by default): under the wrong manager it cannot succeed.
 * Returns null for anything that does not install this project.
 */
export function parseInstall(cmd, { ci = false } = {}) {
  const c = cmd.trim();
  if (!c || c.startsWith("#")) return null;
  // Conditionals and fallbacks describe several possible managers, not one decision.
  if (CONDITIONAL.test(c)) return null;
  if (/\b(npx|dlx|bunx|corepack)\b/.test(c)) return null;
  const m = /^(?:sudo\s+)?(npm|pnpm|yarn|bun)(\s+.*)?$/.exec(c);
  if (!m) return null;
  const manager = m[1];
  const args = (m[2] || "").trim().split(/\s+/).filter(Boolean);
  const sub = args[0] && !args[0].startsWith("-") ? args[0] : null;
  const rest = sub ? args.slice(1) : args;
  const installVerbs = { npm: ["install", "i", "ci", "clean-install", "isntall"], pnpm: ["install", "i"], yarn: ["install"], bun: ["install", "i", "ci"] };
  if (manager === "yarn" && sub === null) { /* bare `yarn` / `yarn --frozen-lockfile` installs */ }
  else if (!installVerbs[manager].includes(sub)) return null;
  // Global installs, other directories and named packages are tooling, not this project's decision.
  if (rest.some((a) => ["-g", "--global", "--prefix", "--cwd", "-C", "--dir", "--location=global", "--no-save", "--no-package-lock", "--package-lock-only", "--dry-run", "--lockfile-only"].includes(a) || a.startsWith("--prefix=") || a.startsWith("--dir=") || a.startsWith("--cwd="))) return null;
  // Any positional argument means a named package, tarball or path is being
  // installed (or a flag value we cannot interpret): not this project's install.
  if (rest.some((a) => !a.startsWith("-"))) return null;
  const frozen = rest.some((a) => a === "--frozen-lockfile" || a === "--frozen-lockfile=true" || a === "--immutable");
  const unfrozen = rest.some((a) => a === "--no-frozen-lockfile" || a === "--frozen-lockfile=false");
  const strict = !unfrozen && (frozen || (manager === "npm" && ["ci", "clean-install"].includes(sub)) || (manager === "bun" && sub === "ci") || (manager === "pnpm" && ci));
  return { manager, strict };
}

function workflowInstalls(raw, scopeSet) {
  // Line-oriented YAML reading: enough to find `run:` commands and the
  // `working-directory:` that governs them, without a YAML dependency.
  const lines = raw.split(/\r?\n/);
  const out = [];
  let defaultsWd = null; // workflow/job `defaults.run.working-directory`
  let inRunBlock = false, runIndent = -1, cdSeen = false, condDepth = 0;
  const resolveScope = (wd) => {
    if (wd == null) return "";
    const w = normalizePath(String(wd).replace(/^["']|["']$/g, "").replace(/\/$/, ""));
    if (w === "" || w === ".") return "";
    if (/\$\{\{/.test(w)) return null; // expression: unresolvable
    return scopeSet.has(w) ? w : null;
  };
  // pre-pass: step boundaries and working directories
  const steps = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)-\s+/.exec(line);
    if (m) steps.push({ start: i, indent: m[1].length });
  });
  const wdForLine = (i) => {
    let step = null;
    for (const s of steps) if (s.start <= i) step = s;
    if (!step) return undefined;
    for (let j = step.start; j < lines.length; j += 1) {
      if (j > step.start && /^(\s*)-\s+/.exec(lines[j]) && /^(\s*)/.exec(lines[j])[1].length <= step.indent) break;
      const w = /^\s*-?\s*working-directory\s*:\s*(.+?)\s*$/.exec(lines[j]);
      if (w) return w[1];
    }
    return undefined;
  };
  const defaults = /defaults\s*:\s*\n\s+run\s*:\s*\n\s+working-directory\s*:\s*(.+)/.exec(raw);
  if (defaults) defaultsWd = defaults[1].trim();

  lines.forEach((line, i) => {
    let cmdText = null;
    const runInline = /^(\s*)-?\s*run\s*:\s*(?![|>])(.+)$/.exec(line);
    const runBlock = /^(\s*)-?\s*run\s*:\s*[|>][-+]?\s*$/.exec(line);
    if (runBlock) { inRunBlock = true; runIndent = runBlock[1].length; cdSeen = false; condDepth = 0; return; }
    if (inRunBlock) {
      const ind = /^(\s*)/.exec(line)[1].length;
      if (line.trim() && ind <= runIndent) inRunBlock = false;
      else cmdText = line.trim();
    }
    if (runInline) { cmdText = runInline[2].trim().replace(/^["']|["']$/g, ""); cdSeen = false; condDepth = 0; }
    if (!cmdText) return;
    // Inside if/case/loops the install is one branch among several: not a decision.
    const opens = (cmdText.match(/(^|[\s;(])(if|case|while|until|for)(?=\s)/g) || []).length;
    const closes = (cmdText.match(/(^|[\s;])(fi|esac|done)(?=[\s;)]|$)/g) || []).length;
    const wasInside = condDepth > 0;
    condDepth = Math.max(0, condDepth + opens - closes);
    if (wasInside || opens || CONDITIONAL.test(cmdText)) return;
    // A `cd` earlier in the same script moves the install somewhere we did not resolve.
    if (/^\s*(cd|pushd)\s+/.test(cmdText) || /\bcd\s+\S+\s*&&/.test(cmdText)) { cdSeen = true; if (!/&&/.test(cmdText)) return; }
    if (cdSeen) return;
    for (const part of cmdText.split(/\s*&&\s*|\s*;\s*/)) {
      const inst = parseInstall(part, { ci: true });
      if (!inst) continue;
      const wd = wdForLine(i) ?? defaultsWd;
      const scope = resolveScope(wd);
      if (scope === null) continue;
      out.push({ ...inst, scope, line: i + 1, text: line.trim().slice(0, 160) });
    }
  });
  return out;
}

function dockerInstalls(raw) {
  const out = [];
  const lines = raw.split(/\r?\n/);
  let buf = "", start = 0, workdirMoved = false;
  lines.forEach((line, i) => {
    if (!buf) start = i;
    buf += line.replace(/\\\s*$/, " ");
    if (/\\\s*$/.test(line)) return;
    const stmt = buf.trim(); buf = "";
    if (/^WORKDIR\s+/i.test(stmt) && !/^WORKDIR\s+\/?(app|usr\/src\/app|srv|code|workspace|home\/\w+\/app)\/?\s*$/i.test(stmt)) workdirMoved = true;
    const run = /^RUN\s+(?:--\S+\s+)*(.+)$/i.exec(stmt);
    if (!run || workdirMoved) return;
    // A RUN that branches (if/elif, case, ||) supports several managers; it is not a decision.
    if (CONDITIONAL.test(run[1])) return;
    for (const part of run[1].split(/\s*&&\s*|\s*;\s*/)) {
      const inst = parseInstall(part);
      if (inst) out.push({ ...inst, line: start + 1, text: stmt.slice(0, 160) });
    }
  });
  return out;
}

/** A workflow whose only trigger is workflow_dispatch never runs in normal CI. */
function manualOnly(raw) {
  const on = /^["']?on["']?[ \t]*:[ \t]*(.*)$/m.exec(raw);
  if (!on) return false;
  const inline = on[1].replace(/#.*$/, "").trim();
  if (inline) return /^\[?\s*workflow_dispatch\s*\]?$/.test(inline);
  const keys = [];
  for (const line of raw.slice(on.index + on[0].length).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^(\s+)([\w-]+)\s*:/.exec(line);
    if (!m) break;
    if (!keys.indent) keys.indent = m[1].length;
    if (m[1].length === keys.indent) keys.push(m[2]);
  }
  return keys.length > 0 && keys.every((k) => k === "workflow_dispatch");
}

// ---------------- helpers ----------------

export function normDb(v) {
  const s = String(v).toLowerCase();
  if (["postgres", "postgresql", "cockroachdb"].includes(s)) return "postgresql";
  if (["mongo", "mongodb"].includes(s)) return "mongodb";
  if (["turso", "libsql"].includes(s)) return "sqlite";
  return s;
}
export function normAuth(v) {
  const s = String(v).toLowerCase().replace(/\s+/g, "-");
  if (["auth.js", "nextauth", "next-auth"].includes(s)) return "authjs";
  if (s === "betterauth") return "better-auth";
  return s;
}
function dbFromScheme(s) {
  const v = s.toLowerCase();
  if (v.startsWith("postgres")) return "postgresql";
  if (v.startsWith("mysql")) return "mysql";
  if (v.startsWith("mongodb")) return "mongodb";
  if (v === "file" || v.startsWith("sqlite") || v === "libsql") return "sqlite";
  return null;
}
function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}
