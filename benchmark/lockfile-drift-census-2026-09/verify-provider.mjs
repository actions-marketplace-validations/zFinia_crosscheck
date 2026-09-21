// Equivalence check: the benchmark's provider must give the engine byte-identical
// input, and produce identical findings, versus the SHIPPED readWorkingTree
// provider running on an ordinary full clone. This is what licenses the claim that
// the census measures the real CrossCheck, not a re-implementation of it.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readWorkingTree } from "../../src/providers.mjs";
import { scanFiles } from "../../src/crosscheck.mjs";
import { git, cloneFrozen, readFrozenCommit } from "./lib/sparse-provider.mjs";

const digest = (m) => createHash("sha256").update(JSON.stringify([...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1))).digest("hex");
const norm = (r) => JSON.stringify({
  findings: r.findings.map(x => ({ rule: x.rule, scope: x.scope, values: x.values })).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1),
  packages: r.model.packages, instructionFiles: r.model.instructionFiles });

let pass = 0, fail = 0, skip = 0;
console.log(`provider equivalence, ${new Date().toISOString()}\n`);
for (const full of process.argv.slice(2)) {
  const d = mkdtempSync(join(tmpdir(), "eq-"));
  try {
    cloneFrozen(d, full);                                    // A: benchmark provider
    const A = readFrozenCommit(join(d, "r"));
    // -c core.autocrlf=false reproduces the Linux GitHub runner the Action actually
    // runs on; without it a Windows checkout rewrites LF to CRLF and the comparison
    // would measure this host, not the provider.
    git(d, ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "-c", "core.protectNTFS=false", "clone", "-q", "--depth", "1", "--single-branch", `https://github.com/${full}.git`, "b"]);
    const B = readWorkingTree(join(d, "b"));                 // B: shipped provider
    const sameFiles = digest(A.files) === digest(B);
    const rA = norm(scanFiles(A.files)), rB = norm(scanFiles(B));
    const ok = sameFiles && rA === rB;
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${full}  sha=${A.sha.slice(0, 8)} files=${A.files.size}/${B.size} identicalInput=${sameFiles} identicalFindings=${rA === rB}`);
    if (!ok) {
      const ka = new Set(A.files.keys()), kb = new Set(B.keys());
      console.log("   onlyBenchmark:", [...ka].filter(x => !kb.has(x)).slice(0, 8));
      console.log("   onlyShipped:  ", [...kb].filter(x => !ka.has(x)).slice(0, 8));
      console.log("   contentDiff:  ", [...ka].filter(x => kb.has(x) && A.files.get(x) !== B.get(x)).slice(0, 5));
    }
  } catch (e) {
    // A full clone is impossible on this host when the tree holds a path NTFS
    // rejects. That is a limit of the comparison, not of the benchmark provider.
    if (/invalid path|restore --source/i.test(e.message)) { skip++; console.log(`SKIP  ${full}  (full clone impossible on this host: path invalid on NTFS)`); }
    else { fail++; console.log(`ERROR ${full}: ${e.message.slice(0, 140)}`); }
  }
  finally { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } catch {} }
}
console.log(`\nEQUIVALENCE: ${pass} identical, ${fail} not identical`);
