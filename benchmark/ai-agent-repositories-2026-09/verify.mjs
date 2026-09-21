import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const sets = [
  ["tuning-v1", "tuning"],
  ["holdout-v2", "holdout"],
  ["holdout-v3", "holdout"],
  ["holdout-v4", "holdout"],
  ["holdout-v5", "holdout"],
];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (path) => createHash("sha256")
  .update(readFileSync(path, "utf8").replace(/\r\n/gu, "\n"))
  .digest("hex");
const totals = {
  repositories: 0,
  holdoutRepositories: 0,
  scannedRepositories: 0,
  skippedRepositories: 0,
  packagesEvaluated: 0,
  repositoriesWithFindings: 0,
  provenFindings: 0,
  holdoutProvenFindings: 0,
  experimentalFindings: 0,
};
const repositoryKeys = new Set();
const holdoutProvenKeys = new Set();
const files = {};

for (const [name, role] of sets) {
  const samplePath = join(root, "samples", `${name}.json`);
  const resultPath = join(root, "results", `${name}.json`);
  const sample = readJson(samplePath);
  const result = readJson(resultPath);
  const expected = new Map(sample.repos.map((entry) => [entry.repo, entry]));

  assert.equal(expected.size, sample.repos.length, `${name}: duplicate repository in sample`);
  assert.equal(result.results.length, sample.repos.length, `${name}: result count differs from sample`);

  for (const entry of sample.repos) {
    assert.match(entry.repo, /^[^/\s]+\/[^/\s]+$/, `${name}: invalid repository name`);
    assert.match(entry.commit, /^[0-9a-f]{40}$/, `${name}: invalid frozen commit`);
    assert(!repositoryKeys.has(entry.repo), `${name}: repository appears in an earlier set: ${entry.repo}`);
    repositoryKeys.add(entry.repo);
  }

  for (const row of result.results) {
    const frozen = expected.get(row.repo);
    assert(frozen, `${name}: result is not in frozen sample: ${row.repo}`);
    if (row.skipped) {
      totals.skippedRepositories += 1;
      continue;
    }
    assert.equal(row.commit, frozen.commit, `${name}: result commit differs from frozen sample for ${row.repo}`);
    totals.scannedRepositories += 1;
    totals.packagesEvaluated += row.packages;
    if (row.findings.length) totals.repositoriesWithFindings += 1;
    for (const finding of row.findings) {
      if (finding.tier === "proven") {
        totals.provenFindings += 1;
        if (role === "holdout") {
          totals.holdoutProvenFindings += 1;
          holdoutProvenKeys.add(`${name}\0${row.repo}\0${row.commit}\0${finding.id}`);
        }
      } else if (finding.tier === "experimental") {
        totals.experimentalFindings += 1;
      } else {
        assert.fail(`${name}: unexpected finding tier ${finding.tier}`);
      }
    }
  }

  totals.repositories += sample.repos.length;
  if (role === "holdout") totals.holdoutRepositories += sample.repos.length;
  files[`samples/${name}.json`] = sha256(samplePath);
  files[`results/${name}.json`] = sha256(resultPath);
}

const reviewPath = join(root, "reviews", "holdout-proven.json");
const review = readJson(reviewPath);
const reviewedKeys = new Set();
let deliberateCounterexamples = 0;
for (const finding of review.findings) {
  assert.equal(finding.evidenceConfirmed, true, `cited evidence was not confirmed for ${finding.repository}`);
  assert.match(finding.evidenceReview, /evidence presence only/iu, `review scope is ambiguous for ${finding.repository}`);
  assert(!Object.hasOwn(finding, "verdict"), `legacy verdict field remains for ${finding.repository}`);
  assert(!Object.hasOwn(finding, "standard"), `legacy standard field remains for ${finding.repository}`);
  assert(["not-established", "deliberate-multi-manager"].includes(finding.intentReview?.status), `invalid intent review for ${finding.repository}`);
  if (finding.intentReview.status === "deliberate-multi-manager") {
    deliberateCounterexamples += 1;
    assert.equal(finding.intentReview.actionability, "generic-remediation-not-supported");
    assert(finding.intentReview.basis.length >= 2, `counterexample basis is incomplete for ${finding.repository}`);
  } else {
    assert.equal(finding.intentReview.actionability, "not-established");
  }
  const key = `${finding.set}\0${finding.repository}\0${finding.commit}\0${finding.findingId}`;
  assert(holdoutProvenKeys.has(key), `review does not match a raw holdout finding: ${finding.repository}`);
  assert(!reviewedKeys.has(key), `duplicate review: ${finding.repository}`);
  reviewedKeys.add(key);
}
assert.deepEqual(reviewedKeys, holdoutProvenKeys, "review file does not cover every proven holdout finding");
assert.equal(deliberateCounterexamples, 2, "expected the two documented deliberate multi-manager counterexamples");
files["reviews/holdout-proven.json"] = sha256(reviewPath);

const expectedSummary = readJson(join(root, "summary.json"));
assert.deepEqual(totals, expectedSummary.totals, "summary totals do not match raw evidence");
assert.equal(expectedSummary.schemaVersion, 2);
assert.equal(expectedSummary.review.holdoutFindingsEvidenceReviewed, totals.holdoutProvenFindings);
assert.equal(expectedSummary.review.evidenceConfirmed, 47);
assert.equal(expectedSummary.review.evidenceMissing, 0);
assert.equal(expectedSummary.review.intentReviewed, 2);
assert.equal(expectedSummary.review.deliberateMultiManagerCounterexamples, deliberateCounterexamples);
assert.equal(expectedSummary.review.actionabilityEstablishedForRemainingFindings, false);
assert.equal(expectedSummary.correction.date, "2026-09-21");
assert.match(expectedSummary.correction.retracted, /47\/47.*precision/iu);
assert.deepEqual(files, expectedSummary.sha256, "raw evidence hashes do not match summary");

console.log(JSON.stringify({ ok: true, ...expectedSummary }, null, 2));
