# CrossCheck public-repository benchmark — September 2026

This directory is the public evidence behind CrossCheck's default package-manager contradiction rule. It contains the frozen public-repository sample, exact commit for every repository, raw CrossCheck 0.1.1 output, file hashes, and a deterministic integrity checker.

## Result

- 1,027 public repositories were frozen before evaluation; 80 were used for tuning and 947 were untouched holdouts.
- 1,024 repositories were scanned successfully, covering 5,904 package scopes. Three frozen entries could not be scanned and remain recorded as skipped rather than silently removed.
- The default `package-manager/conflicting-config` rule produced 47 findings on the four holdout sets. All 47 were manually checked against the named repository and frozen commit and classified as confirmed. An unconfirmed or ambiguous finding would count as wrong.
- Six experimental findings were also emitted across all five sets. They are present in the raw files but excluded from the default-rule result.

This is a precision result for findings CrossCheck emitted, not a claim that CrossCheck detects every repository problem. The sample is also not a census of GitHub: it intentionally targets active, non-fork JavaScript/TypeScript repositories with AI-agent instruction files and size limits described in each frozen sample.

## Verify the published evidence

From the repository root:

```sh
npm run benchmark:verify
```

The verifier rejects duplicate repositories, invalid commit hashes, missing result rows, sample/result commit mismatches, unexpected finding tiers, changed raw-file hashes, or totals that no longer match `summary.json`.

For an independent content review, open any finding in `results/holdout-v*.json`, then inspect the named public repository at the recorded 40-character commit. Each result includes the rule, package scope, values, summary, and evidence paths/lines used by CrossCheck.

To replay a frozen set with the measured engine, create a detached 0.1.1 worktree and rebuild the relevant configuration snapshots:

```sh
git worktree add ../crosscheck-0.1.1 v0.1.1
node benchmark/ai-agent-repositories-2026-09/fetch-snapshots.mjs \
  benchmark/ai-agent-repositories-2026-09/samples/holdout-v5.json \
  ../crosscheck-benchmark-snapshots ../crosscheck-0.1.1
node benchmark/ai-agent-repositories-2026-09/replay.mjs \
  benchmark/ai-agent-repositories-2026-09/samples/holdout-v5.json \
  ../crosscheck-benchmark-snapshots ../crosscheck-0.1.1 /tmp/holdout-v5-replay.json
```

Snapshot fetching uses the GitHub CLI for immutable tree objects and `raw.githubusercontent.com` for the small configuration files the engine reads. It does not install or execute code from sampled repositories. A repository deleted or made private after the freeze may become unavailable; that must be reported as skipped, not replaced.

## Files

- `samples/`: selection method, freeze time, repository name, and exact commit for every sampled repository.
- `results/`: raw CrossCheck 0.1.1 output for every frozen entry. Runtime milliseconds are observational and are not used in any claim.
- `reviews/holdout-proven.json`: one conservative manual verdict for each proven holdout finding, keyed to the raw result and frozen commit.
- `install-evidence-verification.json`: raw evidence used to evaluate whether cited CI, Docker, and Vercel install steps belonged to the affected package.
- `summary.json`: claim-sized totals and SHA-256 hashes for every sample/result file.
- `verify.mjs`: dependency-free integrity and aggregation check.
- `fetch-snapshots.mjs` and `replay.mjs`: dependency-free replay tools pinned to the public `v0.1.1` engine.

Repository names, commit hashes, configuration paths, and configuration text in this dataset came from public GitHub repositories. No repository source archive, author email, token, credential, or private repository evidence is included.
