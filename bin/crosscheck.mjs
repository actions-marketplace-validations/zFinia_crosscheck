#!/usr/bin/env node
// CrossCheck CLI. No account, no network: reads the repository on this machine.
import { appendFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import process from "node:process";
import { readWorkingTree, readCommit, isGitRepo, repoRoot, resolveRef } from "../src/providers.mjs";
import { scanFiles, diffStates, selectTiers, failing, VERSION } from "../src/crosscheck.mjs";
import { renderScan, renderDiff, githubAnnotations, githubSummary, renderMarkdown } from "../src/format.mjs";

const HELP = `crosscheck ${VERSION} — repository consistency for AI-assisted development

Usage
  crosscheck [dir]                     scan the working tree
  crosscheck --base <ref> [--head <ref>]
                                       report only contradictions a change introduced
                                       (head defaults to the working tree)
Options
  --format text|json|github|markdown   output format (default: text); markdown is an
                                       audit report, e.g. > crosscheck-audit.md
  --fail-on none|new|any               exit 1 on new (diff) or any (scan) contradictions
                                       (default: none — advisory). Only proven rules can fail.
  --experimental                       also report experimental rules (ORM, auth, database,
                                       CI install steps, agent instructions) — never fail
  -h, --help, -v, --version

Exit codes: 0 ok/advisory · 1 contradictions and --fail-on matched · 2 usage or runtime error
Reads only lockfiles, package.json, ORM/datasource config, CI install steps and agent
instruction files. Nothing is uploaded.`;

function parseArgs(argv) {
  const opts = { format: "text", failOn: "none", dir: "." };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw usage(`${a} needs a value`); return v; };
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a === "--base") opts.base = val();
    else if (a === "--head") opts.head = val();
    else if (a === "--format") opts.format = val();
    else if (a === "--fail-on") opts.failOn = val();
    else if (a === "--experimental") opts.experimental = true;
    else if (a.startsWith("--")) throw usage(`unknown option ${a}`);
    else opts.dir = a;
  }
  if (!["text", "json", "github", "markdown"].includes(opts.format)) throw usage(`--format must be text, json, github or markdown`);
  if (!["none", "new", "any"].includes(opts.failOn)) throw usage(`--fail-on must be none, new or any`);
  if (opts.head && !opts.base) throw usage(`--head requires --base`);
  return opts;
}
function usage(msg) { const e = new Error(msg); e.usage = true; return e; }

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }
  const dir = resolve(opts.dir);

  if (!opts.base) {
    const full = scanFiles(readWorkingTree(dir));
    const { shown, hiddenExperimental } = selectTiers(full.findings, opts);
    const result = { ...full, findings: shown, hiddenExperimental };
    delete result.evidence;
    if (opts.format === "json") console.log(JSON.stringify({ version: VERSION, mode: "scan", root: dir, ...result }, null, 2));
    else if (opts.format === "markdown") {
      const git = isGitRepo(dir);
      let commit = null;
      try { commit = git ? resolveRef(repoRoot(dir), "HEAD") : null; } catch { commit = null; } // repository without commits
      process.stdout.write(renderMarkdown({ result, repoName: basename(git ? repoRoot(dir) : dir), commit, experimental: opts.experimental, version: VERSION }));
    }
    else if (opts.format === "github") {
      for (const line of githubAnnotations({ introduced: shown.map((f) => ({ ...f, newEvidence: f.evidence })) })) console.log(line);
      console.log(renderScan(result, { root: dir, experimental: opts.experimental }));
    } else console.log(renderScan(result, { root: dir, experimental: opts.experimental }));
    return opts.failOn === "any" && failing(shown).length ? 1 : 0;
  }

  if (!isGitRepo(dir)) throw usage(`--base needs a git repository (${dir} is not one)`);
  const top = repoRoot(dir);
  const base = readCommit(top, opts.base);
  const baseResult = scanFiles(base.files);
  let head, headLabel, headSha;
  if (opts.head) { const c = readCommit(top, opts.head); head = scanFiles(c.files); headSha = c.sha; headLabel = c.sha.slice(0, 12); }
  else { head = scanFiles(readWorkingTree(top)); headSha = "working-tree"; headLabel = "working tree"; }
  const all = diffStates(baseResult, head);
  const pick = (list) => selectTiers(list, opts).shown;
  const diff = { introduced: pick(all.introduced), existing: pick(all.existing), resolved: pick(all.resolved), hiddenExperimental: all.introduced.length - pick(all.introduced).length };

  if (opts.format === "json") {
    console.log(JSON.stringify({ version: VERSION, mode: "diff", base: base.sha, head: headSha, introduced: diff.introduced, resolved: diff.resolved, existing: diff.existing, hiddenExperimental: diff.hiddenExperimental, model: head.model }, null, 2));
  } else if (opts.format === "markdown") {
    process.stdout.write(renderMarkdown({ result: head, diff, head, repoName: basename(top), base: base.sha, headSha, experimental: opts.experimental, version: VERSION }));
  } else if (opts.format === "github") {
    const advisory = opts.failOn === "none";
    for (const line of githubAnnotations(diff, { level: advisory ? "warning" : "error" })) console.log(line);
    console.log(renderDiff(diff, head, { base: base.sha, headLabel, experimental: opts.experimental }));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(diff, head, { base: base.sha, headSha, advisory, experimental: opts.experimental }) + "\n");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `introduced=${diff.introduced.length}\nresolved=${diff.resolved.length}\nexisting=${diff.existing.length}\n`);
  } else {
    console.log(renderDiff(diff, head, { base: base.sha, headLabel, experimental: opts.experimental }));
  }
  return (opts.failOn === "new" || opts.failOn === "any") && failing(diff.introduced).length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`crosscheck: ${error.message}`);
  if (error.usage) console.error("Run `crosscheck --help` for usage.");
  process.exitCode = 2;
}
