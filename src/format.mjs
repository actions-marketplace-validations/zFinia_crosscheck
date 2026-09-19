// Output formats: human text, JSON, and GitHub Actions (annotations + job summary).
import { pretty } from "./rules.mjs";
import { CONTRACT_PATH, decisionLabel } from "./contract.mjs";

// `proven` = a conflict in this class is reported by a proven rule. Otherwise the
// model must not say CONFLICT while the findings list (default mode) says none.
const decisionText = (d, proven = true) => {
  if (d == null) return "not established";
  if (typeof d === "string") return pretty(d);
  if (d.conflict) return proven ? `CONFLICT (${d.conflict.map(pretty).join(" vs ")})` : `not established (both ${d.conflict.map(pretty).join(" and ")} present)`;
  if (d.drivers) return `drivers only (${d.drivers.map(pretty).join(", ")}) — not established`;
  return "not established";
};

/** "What CrossCheck understood": the value a developer gets even when nothing is wrong. */
export function modelLines(model, { experimental = false } = {}) {
  const lines = [];
  const pkgs = model.packages;
  const root = pkgs.find((p) => p.scope === "");
  const nested = pkgs.filter((p) => p.scope !== "");
  lines.push(`Packages evaluated: ${pkgs.length}${nested.length ? ` (root + ${nested.length} nested)` : ""}`);
  const pmNested = nested.filter((p) => p.packageManager != null);
  lines.push(`Package manager:    ${root?.packageManager != null || !pmNested.length
    ? decisionText(root?.packageManager)
    : `${pmNested.map((p) => `${decisionText(p.packageManager)} (${p.scope})`).join("; ")}; root not established`}`);
  const nodePackages = pkgs.filter((p) => p.nodeRuntime != null);
  if (nodePackages.length) {
    const rootNode = root?.nodeRuntime;
    lines.push(`Node runtime:       ${rootNode != null
      ? decisionText(rootNode, false)
      : `${nodePackages.map((p) => `${decisionText(p.nodeRuntime, false)} (${p.scope || "root"})`).join("; ")}${root ? "; root not established" : ""}`}`);
  }
  const rows = [
    ["ORM", "orm"],
    ["Database", "database"],
    ["Authentication", "auth"],
  ];
  for (const [label, key] of rows) {
    const found = pkgs.filter((p) => p[key] != null);
    if (!found.length) { lines.push(`${(label + ":").padEnd(20)}${key === "orm" || key === "auth" ? "none detected" : "not established"}`); continue; }
    if (found.length === 1 && found[0].scope === "") { lines.push(`${(label + ":").padEnd(20)}${decisionText(found[0][key], experimental)}${key === "database" && found[0].databaseSource === "driver" ? " (from driver)" : ""}`); continue; }
    lines.push(`${(label + ":").padEnd(20)}${found.map((p) => `${decisionText(p[key], experimental)} (${p.scope || "root"})`).join("; ")}`);
  }
  lines.push(`Agent instructions: ${model.instructionFiles.length ? model.instructionFiles.join(", ") : "none found"}`);
  for (const n of model.notes || []) lines.push(`Note: ${n.text}`);
  return lines;
}

function findingLines(f, { indent = "  " } = {}) {
  const prefix = f.tier === "experimental" ? "[experimental] " : f.tier === "contract" ? `[contract:${f.enforcement}] ` : "";
  const out = [`${prefix}${f.summary}`];
  for (const e of f.evidence) out.push(`${indent}- ${e.source}${e.line ? `:${e.line}` : ""} → ${pretty(e.value)} (${e.detail})`);
  out.push(`${indent}Fix: ${f.fix}`);
  return out;
}

export function renderScan(result, { root, experimental, contractEnforcementAuthorized = false }) {
  const lines = ["CrossCheck repository model", `(${root})`, ""];
  if (result.contract) lines.push("Repository contract:", "  Decision contract: active", `  Enforcement: ${contractEnforcementAuthorized ? "managed monitoring" : "preview (automatic contract blocking requires managed monitoring)"}`, `  Contract digest: ${result.contractDigest}`, `  Decisions: ${result.contract.decisions.length}`, "");
  lines.push(...modelLines(result.model, { experimental }), "");
  if (!result.findings.length) {
    lines.push("Contradictions: none");
    if (result.hiddenExperimental) lines.push(`(${result.hiddenExperimental} lower-confidence experimental observation${result.hiddenExperimental === 1 ? "" : "s"} not shown; run with --experimental to see ${result.hiddenExperimental === 1 ? "it" : "them"}.)`);
    lines.push("CrossCheck reads only lockfiles, manifests, ORM/datasource config, CI install steps and agent instruction files. Nothing left this machine.");
  } else {
    lines.push(`Contradictions: ${result.findings.length}`, "");
    result.findings.forEach((f, i) => { lines.push(`${i + 1}. ${findingLines(f).join("\n   ")}`, ""); });
  }
  return lines.join("\n").trimEnd();
}

export function renderDiff(diff, head, { base, headLabel, experimental, contractEnforcementAuthorized = false }) {
  const lines = [`CrossCheck: ${base.slice(0, 12)} → ${headLabel}`, ""];
  const digest = head.authorityContractDigest || head.contractDigest;
  if (digest) lines.push(`Repository decision contract: ${digest}`, `Contract enforcement: ${contractEnforcementAuthorized ? "managed monitoring" : "preview (automatic blocking requires managed monitoring)"}`, "");
  if (diff.contractChanges?.length) {
    lines.push("Repository decision changes:");
    for (const change of diff.contractChanges) lines.push(`  - ${changeText(change)} — ${change.requiresApproval ? (diff.contractChangeApproved ? "approved" : "approval required") : "adopted/tightened"}`);
    lines.push("");
  }
  lines.push(...modelLines(head.model, { experimental }), "");
  if (diff.introduced.length) {
    lines.push(`NEW contradictions introduced by this change: ${diff.introduced.length}`, "");
    diff.introduced.forEach((f, i) => {
      lines.push(`${i + 1}. ${findingLines(f).join("\n   ")}`);
      const added = f.newEvidence?.filter((e) => e.source) || [];
      if (added.length && added.length < f.evidence.length) lines.push(`   Introduced by: ${[...new Set(added.map((e) => e.source + (e.line ? `:${e.line}` : "")))].join(", ")}`);
      lines.push("");
    });
  } else {
    lines.push("New contradictions: none");
  }
  if (diff.resolved.length) lines.push(`Resolved by this change: ${diff.resolved.map((f) => f.summary).join("; ")}`);
  if (diff.existing.length) lines.push(`Pre-existing (not caused by this change, not reported as new): ${diff.existing.length} — run \`crosscheck\` to list them.`);
  return lines.join("\n").trimEnd();
}

// ---------- Markdown audit report ----------

// What a finding means for the team, in plain English. Rule-level, so it never
// claims more than the evidence in the finding itself.
const MEANING = {
  "package-manager/conflicting-config": "Two package managers are configured for the same package. Developers, CI and AI coding tools can each install a different dependency tree depending on which one they pick.",
  "package-manager/install-command": "A CI or deployment step installs this package's dependencies with a different package manager from the one the package is set up for.",
  "package-manager/agent-instructions": "Agent instruction files tell AI coding tools to use a different package manager from the one the package is set up for.",
  "orm/conflicting-config": "Two ORMs are configured for the same package.",
  "orm/agent-instructions": "Agent instruction files name a different ORM from the one that is configured.",
  "auth/conflicting-providers": "Two sign-in providers are installed in the same package.",
  "auth/agent-instructions": "Agent instruction files name a different sign-in provider from the one that is installed.",
  "database/conflicting-datasource": "The database configuration names more than one database engine.",
  "database/agent-instructions": "Agent instruction files name a different database from the one that is configured.",
  "manifest/unparseable": "A package.json file is not valid JSON, so its dependencies could not be checked (package managers cannot read it either).",
  "contract/violation": "The repository state does not satisfy an explicit decision committed in the CrossCheck contract.",
  "contract/possible-violation": "Weak repository evidence may conflict with an explicit decision. This is always advisory.",
  "contract/unverified": "CrossCheck did not find strong repository evidence that verifies this explicit decision. This is always advisory.",
  "contract/change-unapproved": "An established repository decision is being changed or removed without explicit maintainer approval.",
};
const mdCode = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const mdText = (s) => String(s).replace(/([|<>])/g, "\\$1");

function mdFinding(f, i, { introducedBy = null } = {}) {
  const out = [`### ${i + 1}. ${mdText(f.summary)}`, ""];
  if (MEANING[f.rule]) out.push(MEANING[f.rule], "");
  out.push(`- **Rule:** ${mdCode(f.rule)}${f.scope ? ` (package ${mdCode(f.scope + "/")})` : ""}`);
  out.push("- **Evidence:**");
  for (const e of f.evidence) out.push(`  - ${mdCode(`${e.source}${e.line ? `:${e.line}` : ""}`)} → ${pretty(e.value)} (${e.kind?.startsWith("install") ? mdCode(String(e.detail).replace(/^-?\s*(?:run\s*:\s*|RUN\s+)/, "")) : mdText(e.detail)})`);
  if (introducedBy?.length) out.push(`- **Introduced by:** ${introducedBy.map(mdCode).join(", ")}`);
  out.push(`- **Recommended fix:** ${mdText(f.fix)}`, "");
  return out;
}

function mdModelTable(model) {
  const lines = modelLines(model).filter((l) => !l.startsWith("Note: "));
  const rows = lines.map((l) => { const at = l.indexOf(":"); return [l.slice(0, at).trim(), l.slice(at + 1).trim()]; });
  return ["| | |", "|---|---|", ...rows.map(([k, v]) => `| ${mdText(k)} | ${mdText(v)} |`), ...(model.notes?.length ? ["", ...model.notes.map((n) => `- Note: ${mdText(n.text)}`)] : [])];
}

const MD_CHECKED = [
  "## What CrossCheck checked",
  "",
  "CrossCheck compared the setup decisions recorded in this repository's configuration files: lockfiles, the `packageManager` field in each `package.json`, ORM and datasource configuration, install steps in GitHub Actions workflows, Dockerfiles and `vercel.json`, and AI-agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, …). Each package in a monorepo is checked on its own.",
  "",
  "Proven findings come from rules that were right every time on public repositories they were never tuned on. Only proven findings can fail a check. CrossCheck is not a general code reviewer: it does not read application code, install packages or run anything.",
  "",
  "## Privacy",
  "",
  "This scan ran locally. CrossCheck made no network requests and uploaded no repository contents.",
  "",
];

/**
 * A self-contained audit report, suitable to save as crosscheck-audit.md.
 * Deterministic: no timestamps and no absolute paths, only the repository
 * directory name and commit identifiers the caller passes in.
 */
export function renderMarkdown({ result, diff = null, head = null, repoName, commit = null, base = null, headSha = null, experimental = false, version }) {
  const model = (head || result).model;
  const shownFindings = diff ? diff.introduced : result.findings;
  const proven = shownFindings.filter((f) => f.tier === "proven");
  const contracted = shownFindings.filter((f) => f.tier === "contract");
  const exp = shownFindings.filter((f) => f.tier === "experimental");
  const hidden = diff ? diff.hiddenExperimental : result.hiddenExperimental;
  const pm = modelLines(model).find((l) => l.startsWith("Package manager:"))?.split(":").slice(1).join(":").trim();
  const md = ["# CrossCheck Repository Audit", ""];
  md.push(`- **Repository:** ${mdCode(repoName)}`);
  if (diff) md.push(`- **Compared:** ${mdCode(base.slice(0, 12))} → ${mdCode(headSha === "working-tree" ? "working tree" : headSha.slice(0, 12))}`);
  else md.push(`- **Scanned:** ${commit ? `working tree at commit ${mdCode(commit.slice(0, 12))}` : "working tree"}`);
  md.push(`- **CrossCheck:** ${version}`, "");

  md.push("## Summary", "", "| | |", "|---|---|");
  md.push(`| Scan mode | ${diff ? "Change review (only contradictions this change introduced)" : "Full repository scan"} |`);
  md.push(`| Packages evaluated | ${model.packages.length} |`);
  md.push(`| Established package manager | ${mdText(pm ?? "not established")} |`);
  md.push(`| ${diff ? "New proven contradictions" : "Proven contradictions"} | ${proven.length} |`);
  if ((head || result).contract || contracted.length || diff?.contractChanges?.length) md.push(`| Contract findings | ${contracted.length} |`);
  md.push(`| Experimental observations | ${experimental ? exp.length : `not requested${hidden ? ` (${hidden} available with --experimental)` : ""}`} |`);
  if (diff) md.push(`| Pre-existing (not caused by this change) | ${diff.existing.filter((f) => f.tier === "proven" || experimental).length} |`, `| Resolved by this change | ${diff.resolved.filter((f) => f.tier === "proven" || experimental).length} |`);
  md.push("");

  md.push("## Proven findings", "");
  if (!proven.length) md.push(diff ? "None. This change introduces no proven contradictions." : "None. CrossCheck found no proven contradictions.", "");
  proven.forEach((f, i) => {
    const introducedBy = diff ? [...new Set((f.newEvidence || []).filter((e) => e.source).map((e) => `${e.source}${e.line ? `:${e.line}` : ""}`))] : null;
    md.push(...mdFinding(f, i, { introducedBy: introducedBy && introducedBy.length < f.evidence.length ? introducedBy : null }));
  });

  const contractResult = head || result;
  const activeContract = contractResult.authorityContract || contractResult.contract;
  const activeDigest = contractResult.authorityContractDigest || contractResult.contractDigest;
  if (activeContract || contracted.length || diff?.contractChanges?.length) {
    md.push("## Repository decision contract", "");
    if (activeContract) {
      md.push(`- **Contract:** ${mdCode(CONTRACT_PATH)}`, "- **Enforcement:** preview; automatic contract blocking requires managed monitoring", `- **Schema version:** ${activeContract.version}`, `- **SHA-256:** ${mdCode(activeDigest)}`, `- **Decisions:** ${activeContract.decisions.length}`, "", "| Scope | Decision | Allowed | Enforcement |", "|---|---|---|---|");
      for (const decision of activeContract.decisions) md.push(`| ${mdCode(decision.scope)} | ${mdCode(decision.key)} | ${decision.allowed.map(pretty).join(", ")} | ${decision.enforcement} |`);
      md.push("");
    }
    if (diff?.contractChanges?.length) {
      md.push("### Repository decision changes", "");
      for (const change of diff.contractChanges) md.push(`- ${mdText(changeText(change))} — **${change.requiresApproval ? (diff.contractChangeApproved ? "approved migration" : "approval required") : "new/tightened policy"}**`);
      md.push("");
    }
    if (contracted.length) {
      md.push("### Contract findings", "");
      contracted.forEach((finding, i) => md.push(...mdFinding(finding, i)));
    } else md.push("Contract findings: none.", "");
  }

  if (experimental) {
    md.push("## Experimental observations", "", "> **EXPERIMENTAL — NOT SAFE TO BLOCK.** These rules have not yet met CrossCheck's precision bar on unseen repositories. Review each one by hand; they can never fail a check.", "");
    if (!exp.length) md.push("None.", "");
    exp.forEach((f, i) => md.push(...mdFinding(f, i)));
  }

  md.push("## Repository model", "", "What CrossCheck understood about this repository.", "", ...mdModelTable(model), "");
  md.push(...MD_CHECKED);
  md.push("## Reproducibility", "");
  md.push(`- CrossCheck version: ${version}`);
  if (diff) md.push(`- Base: ${mdCode(base)}`, `- Head: ${mdCode(headSha)}`);
  else if (commit) md.push(`- Commit: ${mdCode(commit)}`);
  md.push(`- Command: ${mdCode(`npx @zfinia/crosscheck@${version}${diff ? ` --base ${base.slice(0, 12)}${headSha !== "working-tree" ? ` --head ${headSha.slice(0, 12)}` : ""}` : ""} --format markdown${experimental ? " --experimental" : ""}`)}`);
  return md.join("\n").trimEnd() + "\n";
}

// ---------- GitHub Actions ----------

const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** Workflow commands: one annotation per NEW contradiction, on the file that introduced it. */
export function githubAnnotations(diff, { level = "warning", contractEnforcementAuthorized = false } = {}) {
  const out = [];
  for (const f of diff.introduced) {
    const anchor = (f.newEvidence?.find((e) => e.source) || f.evidence[0] || { source: CONTRACT_PATH, line: 1 });
    const props = [`file=${escProp(anchor.source)}`];
    // Lockfiles have no line; without one GitHub will not attach the annotation to the file in "Files changed".
    props.push(`line=${anchor.line || 1}`);
    props.push(`title=${escProp(`CrossCheck${f.tier === "experimental" ? " (experimental)" : ""}: ${f.summary}`)}`);
    const body = [...f.evidence.map((e) => `${e.source}${e.line ? `:${e.line}` : ""} → ${pretty(e.value)} (${e.detail})`), `Fix: ${f.fix}`].join("\n");
    // Experimental rules are notices at most, whatever the enforcement level.
    const annotationLevel = f.tier === "experimental" ? "notice" : f.tier === "contract" && (!contractEnforcementAuthorized || f.enforcement === "warn") ? "warning" : level;
    out.push(`::${annotationLevel} ${props.join(",")}::${esc(body)}`);
  }
  return out;
}

export function githubSummary(diff, head, { base, headSha, advisory, experimental }) {
  const md = [];
  if (diff.contractChanges?.length) {
    md.push("### CrossCheck repository decision changes", "");
    for (const change of diff.contractChanges) md.push(`- ${changeText(change)} — **${change.requiresApproval ? (diff.contractChangeApproved ? "approved migration" : "approval required") : "new/tightened policy"}**`);
    md.push("");
  }
  if (diff.introduced.length) {
    md.push(`### CrossCheck: ${diff.introduced.length} new repository contradiction${diff.introduced.length === 1 ? "" : "s"}`, "");
    for (const f of diff.introduced) {
      md.push(`**${f.summary}**`, "");
      for (const e of f.evidence) {
        const isNew = f.newEvidence?.some((n) => n.source === e.source && n.value === e.value);
        md.push(`- \`${e.source}${e.line ? `:${e.line}` : ""}\` → ${pretty(e.value)}${isNew ? " — **added in this PR**" : ""}`);
      }
      md.push("", `Suggested resolution: ${f.fix}`, "");
    }
    if (advisory) md.push("_Advisory mode: this check reports but does not fail the build. Set `fail-on: new` to enforce._");
  } else {
    md.push("### CrossCheck: no new repository contradictions", "");
  }
  if (diff.resolved.length) md.push("", `Resolved by this PR: ${diff.resolved.map((f) => f.summary).join("; ")}`);
  if (diff.existing.length) md.push("", `${diff.existing.length} pre-existing contradiction${diff.existing.length === 1 ? "" : "s"} not caused by this PR (not reported as new).`);
  md.push("", "<details><summary>Repository model</summary>", "", "```", ...modelLines(head.model, { experimental }), "```", "", `Compared \`${base.slice(0, 12)}\` → \`${headSha.slice(0, 12)}\`. Scanning stays in this workflow; the managed Action sends only GitHub-signed repository identity for entitlement authorization.`, "</details>");
  return md.join("\n");
}

function changeText(change) {
  const decision = change.after || change.before;
  const name = decisionLabel[decision?.key] || "Repository contract";
  const scope = decision?.scope && decision.scope !== "." ? ` (${decision.scope})` : "";
  const before = change.before?.allowed?.map(pretty).join(" or ") ?? "not set";
  const after = change.after?.allowed?.map(pretty).join(" or ") ?? "removed";
  return `${name}${scope}: ${before} → ${after}`;
}
