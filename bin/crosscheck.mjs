#!/usr/bin/env node
// CrossCheck CLI. No account, no network: reads the repository on this machine.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import process from "node:process";
import { readWorkingTree, readCommit, isGitRepo, repoRoot, resolveRef } from "../src/providers.mjs";
import { scanFiles, diffRepositories, selectTiers, failing, VERSION } from "../src/crosscheck.mjs";
import { renderScan, renderDiff, githubAnnotations, githubSummary, renderMarkdown } from "../src/format.mjs";
import {
  CONTRACT_PATH, buildInitialContract, canonicalContractJson, contractSuggestions,
  contextObject, decisionLabel, renderAgentContext, renderContextText,
} from "../src/contract.mjs";

const HELP = `crosscheck ${VERSION} — repository decision contracts and consistency checks

Usage
  crosscheck [dir]                     scan the working tree
  crosscheck --base <ref> [--head <ref>]
                                       report only contradictions a change introduced
  crosscheck contract init [dir]       create a safe initial decision contract
  crosscheck contract suggest [dir]    show optional policy candidates
  crosscheck context [dir]             show agent-readable repository decisions
Options
  --format text|json|github|markdown   output format (default: text)
  --fail-on none|new|any               fail on proven findings (and authorized managed contract blocks)
  --experimental                       show experimental findings; they never fail
  --allow-contract-change              approve proposed contract migrations (diff mode only)
  --write                              write .crosscheck/AGENT_CONTEXT.md (context only)
  --force                              replace an existing contract (contract init only)
  -h, --help, -v, --version

Exit codes: 0 ok/advisory · 1 proven finding (or authorized managed contract block) matched · 2 usage or runtime error
Runs locally and deterministically. Nothing is uploaded.`;

function parseArgs(argv) {
  const args = [...argv];
  let command = "scan";
  if (args[0] === "contract") {
    const sub = args[1];
    if (!sub || !["init", "suggest"].includes(sub)) throw usage("contract requires init or suggest");
    command = `contract-${sub}`;
    args.splice(0, 2);
  } else if (args[0] === "context") {
    command = "context";
    args.shift();
  }
  const opts = { command, format: "text", failOn: "none", dir: "." };
  let positional = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const val = () => { const value = args[++i]; if (value === undefined || value.startsWith("--")) throw usage(`${arg} needs a value`); return value; };
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "-v" || arg === "--version") opts.version = true;
    else if (arg === "--base") opts.base = val();
    else if (arg === "--head") opts.head = val();
    else if (arg === "--format") opts.format = val();
    else if (arg === "--fail-on") opts.failOn = val();
    else if (arg === "--experimental") opts.experimental = true;
    else if (arg === "--allow-contract-change") opts.allowContractChange = true;
    else if (arg === "--write") opts.write = true;
    else if (arg === "--force") opts.force = true;
    else if (arg.startsWith("--")) throw usage(`unknown option ${arg}`);
    else if (positional) throw usage(`unexpected argument ${arg}`);
    else { opts.dir = arg; positional = true; }
  }
  const formats = command === "scan" ? ["text", "json", "github", "markdown"] : ["text", "json"];
  if (!formats.includes(opts.format)) throw usage(`--format must be ${formats.join(" or ")}`);
  if (!["none", "new", "any"].includes(opts.failOn)) throw usage("--fail-on must be none, new or any");
  if (opts.head && !opts.base) throw usage("--head requires --base");
  if (command !== "scan" && (opts.base || opts.head || opts.allowContractChange || opts.experimental || opts.failOn !== "none")) throw usage(`${command.replace("-", " ")} does not accept scan/diff options`);
  if (command !== "context" && opts.write) throw usage("--write is only valid with context");
  if (command !== "contract-init" && opts.force) throw usage("--force is only valid with contract init");
  if (command === "scan" && opts.allowContractChange && !opts.base) throw usage("--allow-contract-change requires --base");
  return opts;
}

function usage(message) { const error = new Error(message); error.usage = true; return error; }

function writeOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value ?? ""}\n`).join(""));
}

function runInit(dir, opts) {
  const target = join(dir, ...CONTRACT_PATH.split("/"));
  if (existsSync(target) && !opts.force) throw usage(`${CONTRACT_PATH} already exists; use --force to replace it`);
  const working = readWorkingTree(dir);
  if (opts.force) working.delete(CONTRACT_PATH);
  const result = scanFiles(working);
  const contract = buildInitialContract(result.model);
  mkdirSync(join(dir, ".crosscheck"), { recursive: true });
  writeFileSync(target, canonicalContractJson(contract, { pretty: true }));
  if (opts.format === "json") console.log(JSON.stringify({ created: CONTRACT_PATH, contract }, null, 2));
  else {
    console.log(`Created ${CONTRACT_PATH}\n\nDecisions:`);
    if (!contract.decisions.length) console.log("  none (no high-confidence package manager or Node runtime was established)");
    for (const item of contract.decisions) console.log(`  ${item.scope === "." ? "" : `${item.scope}: `}${decisionLabel[item.key]}: ${item.allowed.join(" or ")}`);
  }
  return 0;
}

function runSuggest(dir, opts) {
  const suggestions = contractSuggestions(scanFiles(readWorkingTree(dir)));
  if (opts.format === "json") console.log(JSON.stringify({ suggestions }, null, 2));
  else {
    console.log("Contract suggestions");
    if (!suggestions.length) console.log("\nNone.");
    for (const item of suggestions) {
      console.log(`\n${item.scope === "." ? "Root" : item.scope}\n  ${decisionLabel[item.key]}: ${item.suggested}\n  Evidence:`);
      for (const evidence of item.evidence) console.log(`    ${evidence.source}${evidence.line ? `:${evidence.line}` : ""} → ${evidence.detail}`);
      console.log(`  Generic detection: ${item.genericTier}\n  Suggestion only. ${item.explanation}`);
    }
  }
  return 0;
}

function runContext(dir, opts) {
  const result = scanFiles(readWorkingTree(dir));
  if (!result.contract) throw usage(`no ${CONTRACT_PATH} found`);
  if (opts.write) {
    const target = join(dir, ".crosscheck", "AGENT_CONTEXT.md");
    mkdirSync(join(dir, ".crosscheck"), { recursive: true });
    writeFileSync(target, renderAgentContext(result.contract));
    if (opts.format === "text") console.log("Wrote .crosscheck/AGENT_CONTEXT.md\n");
  }
  if (opts.format === "json") console.log(JSON.stringify(contextObject(result.contract), null, 2));
  else process.stdout.write(renderContextText(result.contract));
  return 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }
  const dir = resolve(opts.dir);
  const contractEnforcementAuthorized = process.env.GITHUB_ACTIONS === "true" && process.env.CROSSCHECK_MANAGED_MONITORING_AUTHORIZED === "true";
  if (opts.command === "contract-init") return runInit(dir, opts);
  if (opts.command === "contract-suggest") return runSuggest(dir, opts);
  if (opts.command === "context") return runContext(dir, opts);

  if (!opts.base) {
    const full = scanFiles(readWorkingTree(dir));
    const { shown, hiddenExperimental } = selectTiers(full.findings, opts);
    const result = { ...full, findings: shown, hiddenExperimental };
    delete result.evidence;
    if (opts.format === "json") console.log(JSON.stringify({ version: VERSION, mode: "scan", root: dir, contractEnforcement: contractEnforcementAuthorized ? "managed" : "preview", ...result }, null, 2));
    else if (opts.format === "markdown") {
      const repository = isGitRepo(dir);
      let commit = null;
      try { commit = repository ? resolveRef(repoRoot(dir), "HEAD") : null; } catch { commit = null; }
      process.stdout.write(renderMarkdown({ result, repoName: basename(repository ? repoRoot(dir) : dir), commit, experimental: opts.experimental, version: VERSION }));
    } else if (opts.format === "github") {
      const scanDiff = { introduced: shown.map((finding) => ({ ...finding, newEvidence: finding.evidence })), existing: [], resolved: [], contractChanges: [] };
      for (const line of githubAnnotations(scanDiff, { level: opts.failOn === "none" ? "warning" : "error", contractEnforcementAuthorized })) console.log(line);
      console.log(renderScan(result, { root: dir, experimental: opts.experimental, contractEnforcementAuthorized }));
      writeOutputs({ introduced: shown.length, resolved: 0, existing: 0, "contract-violations": shown.filter((finding) => finding.rule === "contract/violation").length, "decision-changes": 0, "contract-digest": result.contractDigest || "" });
    } else console.log(renderScan(result, { root: dir, experimental: opts.experimental, contractEnforcementAuthorized }));
    return opts.failOn === "any" && failing(shown, { contractEnforcementAuthorized }).length ? 1 : 0;
  }

  if (!isGitRepo(dir)) throw usage(`--base needs a git repository (${dir} is not one)`);
  const top = repoRoot(dir);
  const baseCommit = readCommit(top, opts.base);
  let headFiles, headLabel, headSha;
  if (opts.head) { const commit = readCommit(top, opts.head); headFiles = commit.files; headSha = commit.sha; headLabel = commit.sha.slice(0, 12); }
  else { headFiles = readWorkingTree(top); headSha = "working-tree"; headLabel = "working tree"; }
  const analysis = diffRepositories(baseCommit.files, headFiles, { allowContractChange: opts.allowContractChange });
  const pick = (list) => selectTiers(list, opts).shown;
  const all = analysis.diff;
  const diff = {
    introduced: pick(all.introduced), existing: pick(all.existing), resolved: pick(all.resolved),
    hiddenExperimental: all.introduced.length - pick(all.introduced).length,
    contractChanges: analysis.contractChanges,
    contractChangeApproved: analysis.contractChangeApproved,
    initialContractAdoption: analysis.initialContractAdoption,
  };
  const head = analysis.head;
  const digest = head.authorityContractDigest || head.contractDigest || "";

  if (opts.format === "json") {
    console.log(JSON.stringify({ version: VERSION, mode: "diff", base: baseCommit.sha, head: headSha, contractEnforcement: contractEnforcementAuthorized ? "managed" : "preview", introduced: diff.introduced, resolved: diff.resolved, existing: diff.existing, hiddenExperimental: diff.hiddenExperimental, model: head.model, contract: head.authorityContract || head.contract || null, proposedContract: head.authorityContract && head.contract ? head.contract : undefined, contractDigest: digest || null, contractChanges: diff.contractChanges, contractChangeApproved: diff.contractChangeApproved }, null, 2));
  } else if (opts.format === "markdown") {
    process.stdout.write(renderMarkdown({ result: head, diff, head, repoName: basename(top), base: baseCommit.sha, headSha, experimental: opts.experimental, version: VERSION }));
  } else if (opts.format === "github") {
    const advisory = opts.failOn === "none";
    for (const line of githubAnnotations(diff, { level: advisory ? "warning" : "error", contractEnforcementAuthorized })) console.log(line);
    console.log(renderDiff(diff, head, { base: baseCommit.sha, headLabel, experimental: opts.experimental, contractEnforcementAuthorized }));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(diff, head, { base: baseCommit.sha, headSha, advisory, experimental: opts.experimental }) + "\n");
    writeOutputs({ introduced: diff.introduced.length, resolved: diff.resolved.length, existing: diff.existing.length, "contract-violations": diff.introduced.filter((finding) => finding.rule === "contract/violation").length, "decision-changes": diff.contractChanges.length, "contract-digest": digest });
  } else console.log(renderDiff(diff, head, { base: baseCommit.sha, headLabel, experimental: opts.experimental, contractEnforcementAuthorized }));
  return (opts.failOn === "new" || opts.failOn === "any") && failing(diff.introduced, { contractEnforcementAuthorized }).length ? 1 : 0;
}

try { process.exitCode = main(); }
catch (error) {
  console.error(`crosscheck: ${error.message}`);
  if (error.usage) console.error("Run `crosscheck --help` for usage.");
  process.exitCode = 2;
}
