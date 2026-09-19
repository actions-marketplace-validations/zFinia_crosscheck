// Rules turn evidence into findings. A finding is only ever raised inside one
// package scope, so two packages that legitimately chose differently never
// collide. Every rule is deterministic and cites the exact files involved.

const LABEL = {
  "package.manager": "Package manager",
  "database.orm": "ORM",
  "database.engine": "Database",
  "auth.provider": "Authentication provider",
  "runtime.node": "Node runtime",
  manifest: "Manifest",
};
const PRETTY = {
  npm: "npm", pnpm: "pnpm", yarn: "Yarn", bun: "Bun",
  prisma: "Prisma", drizzle: "Drizzle", typeorm: "TypeORM", sequelize: "Sequelize", "mikro-orm": "MikroORM",
  postgresql: "PostgreSQL", mysql: "MySQL", sqlite: "SQLite", mongodb: "MongoDB", sqlserver: "SQL Server",
  authjs: "Auth.js (NextAuth)", clerk: "Clerk", "better-auth": "Better Auth", auth0: "Auth0", lucia: "Lucia",
};
export const pretty = (v) => PRETTY[v] || v;
const where = (scope) => (scope ? ` in ${scope}/` : "");
const uniq = (xs) => [...new Set(xs)].sort();

export function evaluate({ scopes, evidence, incomplete, instructionFiles }) {
  const findings = [];
  const notes = [];
  const by = (scope, cls, pred = () => true) => evidence.filter((e) => e.scope === scope && e.class === cls && pred(e));

  for (const scope of scopes) {
    // ---------- package manager ----------
    const pmConfig = by(scope, "package.manager", (e) => e.kind === "lockfile" || e.kind === "packageManager-field");
    const pmValues = uniq(pmConfig.map((e) => e.value));
    if (pmValues.length > 1) {
      const locks = pmConfig.filter((e) => e.kind === "lockfile");
      const field = pmConfig.find((e) => e.kind === "packageManager-field");
      const intended = field ? field.value : null;
      // Which of the conflicting managers this package's own CI, Docker and
      // deploy steps actually install with (unconditional, scope-resolved steps
      // only). It is supporting evidence: it never creates or removes a finding.
      const installs = by(scope, "package.manager", (e) => (e.kind === "install-command" || e.kind === "install-command-unpinned") && pmValues.includes(e.value));
      const installers = uniq(installs.map((e) => e.value));
      const at = (group) => [...new Set(group.map((g) => `${g.source}${g.line ? `:${g.line}` : ""}`))].join(", ");
      const lockOf = (m) => locks.filter((l) => l.value === m).map((l) => l.source);
      let fix;
      if (intended) {
        fix = `"packageManager" declares ${pretty(intended)}. Remove ${locks.filter((l) => l.value !== intended).map((l) => l.source).join(", ")} and reinstall with ${intended}, or change "packageManager" if you are deliberately migrating.`;
        const others = installers.filter((m) => m !== intended);
        if (others.length) fix += ` Also note: ${others.map((m) => `${at(installs.filter((e) => e.value === m))} install${installs.filter((e) => e.value === m).length === 1 ? "s" : ""} with ${pretty(m)}`).join("; ")}.`;
      } else if (installers.length === 1 && lockOf(installers[0]).length) {
        const used = installers[0];
        const stale = locks.filter((l) => l.value !== used).map((l) => l.source);
        // Stated as evidence plus a conditional fix: teams sometimes keep a second
        // lockfile on purpose, so which one to delete is their decision.
        const unused = pmValues.filter((m) => m !== used);
        fix = `Every install step CrossCheck found for this package uses ${pretty(used)} (${at(installs)}); none uses ${unused.map(pretty).join(" or ")}. If ${pretty(used)} is your package manager, delete ${stale.join(", ")}, keep ${lockOf(used).join(", ")}, and add "packageManager" to package.json so every tool agrees. If you use ${unused.map(pretty).join(" or ")} on purpose, make these install steps use it too.`;
      } else if (installers.length > 1) {
        fix = `Install steps for this package disagree: ${installers.map((m) => `${pretty(m)} in ${at(installs.filter((e) => e.value === m))}`).join("; ")}. What you test can differ from what you build or ship. Pick one manager, delete the other lockfile, and make every install step use it.`;
      } else {
        fix = `Keep one lockfile${where(scope)}: delete the one for the manager you do not use and reinstall.`;
      }
      findings.push(finding("package-manager/conflicting-config", "package.manager", scope, pmValues, [...pmConfig, ...installs],
        `${LABEL["package.manager"]} conflict${where(scope)}: ${pmValues.map(pretty).join(" vs ")}`, fix));
    }
    const established = pmValues.length === 1 ? pmValues[0] : null;
    if (established) {
      const cmds = by(scope, "package.manager", (e) => e.kind === "install-command" && e.value !== established);
      for (const [manager, group] of groupBy(cmds, (e) => e.value)) {
        findings.push(finding("package-manager/install-command", "package.manager", scope, uniq([established, manager]), [...pmConfig, ...group],
          `Lockfile-strict ${pretty(manager)} install${where(scope)}, but the package is managed by ${pretty(established)} (${pmConfig.map((e) => e.source.split("/").pop()).join(", ")}): that step needs a ${manager} lockfile that does not exist`,
          `Change ${group.map((g) => `${g.source}${g.line ? `:${g.line}` : ""}`).join(", ")} to ${installFor(established)}, or migrate the package manager intentionally.`));
      }
      // Plain installs with another manager are often deliberate (e.g. Bun used
      // only to compile a binary), so they are surfaced as notes, never findings.
      for (const [manager, group] of groupBy(by(scope, "package.manager", (e) => e.kind === "install-command-unpinned" && e.value !== established), (e) => e.value)) {
        notes.push({ scope, text: `${group.map((g) => `${g.source}${g.line ? `:${g.line}` : ""}`).join(", ")} installs with ${pretty(manager)} (not lockfile-pinned) although${where(scope) || " the repository"} uses ${pretty(established)}` });
      }
      const docs = by(scope, "package.manager", (e) => e.kind === "instruction" && e.value !== established);
      for (const [value, group] of groupBy(docs, (e) => e.value)) {
        findings.push(finding("package-manager/agent-instructions", "package.manager", scope, uniq([established, value]), [...pmConfig, ...group],
          `Agent instructions say ${pretty(value)}, but${where(scope) || " the repository"} uses ${pretty(established)}`,
          `Update ${group.map((g) => `${g.source}:${g.line}`).join(", ")} to ${pretty(established)} so agents stop running ${value}.`));
      }
    }

    // ---------- ORM ----------
    const ormConfig = by(scope, "database.orm", (e) => e.kind !== "instruction");
    const ormValues = uniq(ormConfig.map((e) => e.value));
    if (ormValues.length > 1) {
      findings.push(finding("orm/conflicting-config", "database.orm", scope, ormValues, ormConfig,
        `${LABEL["database.orm"]} conflict${where(scope)}: ${ormValues.map(pretty).join(" and ")} are both configured`,
        `Finish or revert the migration${where(scope)}: remove the ORM you are not keeping (its dependency and config), then regenerate the client.`));
    }
    if (ormValues.length >= 1) {
      const docs = by(scope, "database.orm", (e) => e.kind === "instruction" && !ormValues.includes(e.value));
      for (const [value, group] of groupBy(docs, (e) => e.value)) {
        findings.push(finding("orm/agent-instructions", "database.orm", scope, uniq([...ormValues, value]), [...ormConfig, ...group],
          `Agent instructions say ${pretty(value)}, but${where(scope) || " the repository"} is configured for ${ormValues.map(pretty).join(" + ")}`,
          `Update ${group.map((g) => `${g.source}:${g.line}`).join(", ")} so agents do not write ${pretty(value)} code.`));
      }
    }

    // ---------- authentication ----------
    const authConfig = by(scope, "auth.provider", (e) => e.kind !== "instruction");
    const authValues = uniq(authConfig.map((e) => e.value));
    if (authValues.length > 1) {
      findings.push(finding("auth/conflicting-providers", "auth.provider", scope, authValues, authConfig,
        `${LABEL["auth.provider"]} conflict${where(scope)}: ${authValues.map(pretty).join(" and ")} are both installed`,
        `Keep one sign-in provider${where(scope)}; remove the other's packages once its routes and sessions are migrated.`));
    }
    if (authValues.length >= 1) {
      const docs = by(scope, "auth.provider", (e) => e.kind === "instruction" && !authValues.includes(e.value));
      for (const [value, group] of groupBy(docs, (e) => e.value)) {
        findings.push(finding("auth/agent-instructions", "auth.provider", scope, uniq([...authValues, value]), [...authConfig, ...group],
          `Agent instructions say ${pretty(value)}, but${where(scope) || " the repository"} uses ${authValues.map(pretty).join(" + ")}`,
          `Update ${group.map((g) => `${g.source}:${g.line}`).join(", ")} to match the installed provider.`));
      }
    }

    // ---------- database ----------
    const decls = by(scope, "database.engine", (e) => e.kind === "datasource");
    const declValues = uniq(decls.map((e) => e.value));
    if (declValues.length > 1) {
      findings.push(finding("database/conflicting-datasource", "database.engine", scope, declValues, decls,
        `${LABEL["database.engine"]} conflict${where(scope)}: configured for ${declValues.map(pretty).join(" and ")}`,
        `Make the Prisma provider, Drizzle dialect and example DATABASE_URL${where(scope)} name the same engine.`));
    }
    const drivers = by(scope, "database.engine", (e) => e.kind === "runtime-driver");
    const sqlSide = [...decls, ...drivers].filter((e) => e.value !== "mongodb");
    const docSide = [...decls, ...drivers].filter((e) => e.value === "mongodb");
    if (declValues.length <= 1 && sqlSide.length && docSide.length) {
      // A document database next to a SQL database is usually deliberate in
      // real repositories (integration tools, local-dev infrastructure): 0/2
      // verified on the unseen live holdout. Surfaced as a note, never a finding.
      const values = uniq([...docSide, ...sqlSide].map((e) => e.value));
      notes.push({ scope, text: `${values.map(pretty).join(" and ")} are both runtime dependencies${where(scope)} (often intentional; not reported as a contradiction)` });
    }
    if (declValues.length === 1) {
      const docs = by(scope, "database.engine", (e) => e.kind === "instruction" && e.value !== declValues[0]);
      for (const [value, group] of groupBy(docs, (e) => e.value)) {
        findings.push(finding("database/agent-instructions", "database.engine", scope, uniq([declValues[0], value]), [...decls, ...group],
          `Agent instructions say ${pretty(value)}, but${where(scope) || " the repository"} is configured for ${pretty(declValues[0])}`,
          `Update ${group.map((g) => `${g.source}:${g.line}`).join(", ")} to ${pretty(declValues[0])}.`));
      }
    }
  }

  for (const item of incomplete) {
    findings.push(finding("manifest/unparseable", "manifest", item.scope, ["invalid-json"], [{ source: item.source, line: null, detail: item.reason, value: "invalid-json", kind: "manifest" }],
      `${item.source} is not valid JSON, so its dependencies were not checked (npm cannot read it either)`,
      `Fix the JSON in ${item.source} (unresolved merge markers are the usual cause).`));
  }

  findings.sort((a, b) => a.scope.localeCompare(b.scope) || a.rule.localeCompare(b.rule) || a.values.join().localeCompare(b.values.join()));
  return { findings, model: { ...buildModel({ scopes, evidence, instructionFiles }), notes } };
}

// Tiers are earned on unseen real repositories, never assumed:
//   proven       — verified precision on held-out live sets (package-manager
//                  config conflicts: 47/47 on never-tuned repositories); shown
//                  by default and the only tier that can fail a build.
//   experimental — too few verified emissions or a weaker record; hidden unless
//                  --experimental, and never able to fail a build.
export const PROVEN_RULES = new Set(["package-manager/conflicting-config", "manifest/unparseable"]);
export const tierOf = (rule) => (PROVEN_RULES.has(rule) ? "proven" : "experimental");

function finding(rule, cls, scope, values, evidence, summary, fix) {
  const seen = new Set();
  const ev = [];
  for (const e of evidence) {
    const key = `${e.source}:${e.line ?? ""}:${e.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ev.push({ source: e.source, line: e.line ?? null, value: e.value, kind: e.kind, detail: e.detail });
  }
  return { id: `${rule}@${scope || "."}`, rule, tier: tierOf(rule), class: cls, scope, values, summary, fix, evidence: ev };
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) || []), item]);
  return map;
}

function installFor(m) {
  return { npm: "npm ci", pnpm: "pnpm install --frozen-lockfile", yarn: "yarn install --frozen-lockfile", bun: "bun install --frozen-lockfile" }[m] || `${m} install`;
}

// ---------- repository model: what CrossCheck understood ----------

function buildModel({ scopes, evidence, instructionFiles }) {
  const packages = scopes.map((scope) => {
    const ev = evidence.filter((e) => e.scope === scope && e.kind !== "instruction");
    const decide = (values) => {
      const u = uniq(values);
      return u.length === 0 ? null : u.length === 1 ? u[0] : { conflict: u };
    };
    const pm = decide(ev.filter((e) => e.class === "package.manager" && (e.kind === "lockfile" || e.kind === "packageManager-field")).map((e) => e.value));
    const orm = decide(ev.filter((e) => e.class === "database.orm").map((e) => e.value));
    const declared = decide(ev.filter((e) => e.kind === "datasource").map((e) => e.value));
    const drivers = uniq(ev.filter((e) => e.kind === "runtime-driver").map((e) => e.value));
    const auth = decide(ev.filter((e) => e.class === "auth.provider").map((e) => e.value));
    const nodeRuntime = decide(ev.filter((e) => e.class === "runtime.node").map((e) => e.value));
    return {
      scope,
      packageManager: pm,
      orm,
      database: declared ?? (drivers.length === 1 ? drivers[0] : drivers.length ? { drivers } : null),
      databaseSource: declared ? "declared" : drivers.length ? "driver" : null,
      auth,
      ...(nodeRuntime == null ? {} : { nodeRuntime }),
    };
  });
  return { packages, instructionFiles: [...instructionFiles].sort() };
}
