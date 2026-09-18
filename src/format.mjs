// Output formats: human text, JSON, and GitHub Actions (annotations + job summary).
import { pretty } from "./rules.mjs";

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
  const out = [`${f.tier === "experimental" ? "[experimental] " : ""}${f.summary}`];
  for (const e of f.evidence) out.push(`${indent}- ${e.source}${e.line ? `:${e.line}` : ""} → ${pretty(e.value)} (${e.detail})`);
  out.push(`${indent}Fix: ${f.fix}`);
  return out;
}

export function renderScan(result, { root, experimental }) {
  const lines = ["CrossCheck repository model", `(${root})`, "", ...modelLines(result.model, { experimental }), ""];
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

export function renderDiff(diff, head, { base, headLabel, experimental }) {
  const lines = [`CrossCheck: ${base.slice(0, 12)} → ${headLabel}`, "", ...modelLines(head.model, { experimental }), ""];
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

// ---------- GitHub Actions ----------

const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** Workflow commands: one annotation per NEW contradiction, on the file that introduced it. */
export function githubAnnotations(diff, { level = "warning" } = {}) {
  const out = [];
  for (const f of diff.introduced) {
    const anchor = (f.newEvidence?.find((e) => e.source) || f.evidence[0]);
    const props = [`file=${escProp(anchor.source)}`];
    // Lockfiles have no line; without one GitHub will not attach the annotation to the file in "Files changed".
    props.push(`line=${anchor.line || 1}`);
    props.push(`title=${escProp(`CrossCheck${f.tier === "experimental" ? " (experimental)" : ""}: ${f.summary}`)}`);
    const body = [...f.evidence.map((e) => `${e.source}${e.line ? `:${e.line}` : ""} → ${pretty(e.value)} (${e.detail})`), `Fix: ${f.fix}`].join("\n");
    // Experimental rules are notices at most, whatever the enforcement level.
    out.push(`::${f.tier === "experimental" ? "notice" : level} ${props.join(",")}::${esc(body)}`);
  }
  return out;
}

export function githubSummary(diff, head, { base, headSha, advisory, experimental }) {
  const md = [];
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
  md.push("", "<details><summary>Repository model</summary>", "", "```", ...modelLines(head.model, { experimental }), "```", "", `Compared \`${base.slice(0, 12)}\` → \`${headSha.slice(0, 12)}\`. Runs entirely in this workflow; no repository data leaves it.`, "</details>");
  return md.join("\n");
}
