// Re-run CrossCheck 0.1.1 over snapshots created by fetch-snapshots.mjs.
// usage: node replay.mjs <sample.json> <snapshot-dir> <crosscheck-0.1.1-dir> <out.json>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [samplePath, snapshotDir, engineDir, outPath] = process.argv.slice(2);
if (!samplePath || !snapshotDir || !engineDir || !outPath) throw new Error("usage: replay.mjs <sample.json> <snapshot-dir> <crosscheck-0.1.1-dir> <out.json>");
const packageJson = JSON.parse(readFileSync(join(resolve(engineDir), "package.json"), "utf8"));
if (packageJson.version !== "0.1.1") throw new Error(`expected CrossCheck 0.1.1, received ${packageJson.version}`);
const { scanFiles } = await import(pathToFileURL(join(resolve(engineDir), "src", "crosscheck.mjs")));
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const results = [];
let emitted = 0;

for (const entry of sample.repos) {
  const path = join(snapshotDir, `${entry.repo.replace("/", "__")}.json`);
  if (!existsSync(path)) {
    results.push({ repo: entry.repo, skipped: "missing snapshot" });
    continue;
  }
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  if (snapshot.skipped) {
    results.push({ repo: entry.repo, skipped: snapshot.skipped });
    continue;
  }
  const scan = scanFiles(new Map(Object.entries(snapshot.files)));
  emitted += scan.findings.length;
  results.push({
    repo: entry.repo,
    commit: entry.commit,
    packages: scan.scopes.length,
    truncated: snapshot.truncated || undefined,
    findings: scan.findings.map((finding) => ({
      id: finding.id,
      rule: finding.rule,
      tier: finding.tier,
      values: finding.values,
      summary: finding.summary,
      evidence: finding.evidence.map((item) => `${item.value} <- ${item.source}${item.line ? `:${item.line}` : ""} [${item.kind}] ${item.detail}`),
    })),
    notes: (scan.model.notes || []).map((note) => `${note.scope || "."}: ${note.text}`),
  });
}

writeFileSync(outPath, `${JSON.stringify({ set: sample.name, engineVersion: packageJson.version, emitted, results }, null, 2)}\n`);
console.log(`${sample.name}: scanned ${results.filter((row) => !row.skipped).length}, skipped ${results.filter((row) => row.skipped).length}, findings ${emitted}`);
