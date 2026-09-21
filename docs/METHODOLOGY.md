# How CrossCheck's default rule was measured

CrossCheck shows a rule by default only after its cited configuration evidence has been checked on repositories it was never tuned on. Evidence verification is not proof of maintainer intent or required remediation.

## Held-out evidence verification

> **Correction — 21 September 2026:** The original methodology called the 47/47 result package-manager contradiction precision. That interpretation is retracted. The review verified the cited files and signals, not whether maintainers considered the state erroneous or actionable. Frozen sample manifests and raw CrossCheck 0.1.1 output are preserved unchanged.

- **Sample:** public GitHub repositories that contain AI-agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, …).
- **Frozen before scanning:** each sample's repository list and commit hashes were fixed before the engine ran, and the engine's file hashes were recorded before each run.
- **Checked by hand:** the cited configuration evidence for every emitted finding was checked against the repository itself. This review did not infer maintainer intent.
- **Tuning vs. holdouts:** one sample was used to tune the rules. Four later samples (947 repositories in total) were never used for tuning. The fourth (347 repositories, September 2026) was frozen before any 0.1.1 change was written.

| Rules | Evidence verification on the held-out samples |
|---|---|
| Default: multiple package-manager configuration state | **47 of 47 emitted findings had their cited evidence verified** (four samples) |
| All rules including experimental (samples 3 and 4 of 0.1.0) | 23 of 27 (about 85%) |

The 47/47 evidence result does not state how many findings required remediation. Two counterexamples are deliberate multi-manager repositories: `code-yeongyu/senpi@1690fdb284dacca7ddea901db02d97ea0771eecf` tests and releases through multiple package managers, while `MattFlower/tempest@a53ed0e94d3bb215aa2902c09d44662ddfc405b7` intentionally keeps an npm lock for Dependabot alongside Bun. The experimental rules remain opt-in and never fail a build.

For 0.x compatibility, the default rule remains block-capable when an operator explicitly selects `--fail-on new` or `--fail-on any`. This is a strict evidence-based policy and can block deliberate multi-manager state; it does not imply that CrossCheck inferred an error. Intent-aware enforcement requires an explicit CrossCheck contract. Deliberately supported multi-manager changes should leave generic `fail-on` disabled.

The complete frozen manifests, raw 0.1.1 outputs, per-finding evidence-review records, SHA-256 hashes, and dependency-free verifier are published in the [September 2026 public-repository benchmark](../benchmark/ai-agent-repositories-2026-09/README.md). The artifact records all 1,027 sampled repositories, including the 80-repository tuning set, the 947-repository holdout, and three skipped scans. Run `npm run benchmark:verify` to recompute the published totals from the raw files.

## Install-step evidence (0.1.1)

From 0.1.1, a package-manager conflict also cites the package's own unconditional install steps (GitHub Actions, Dockerfile, `vercel.json`) when they exist, and its suggested fix says which manager those steps use. This never adds, removes or changes a finding; it only adds evidence. Re-running the four earlier samples and the new one produced exactly the same findings as 0.1.0.

- **Cited install steps are real and belong to that package:** 23 of 23 enriched findings on the unseen samples. Each cited line was read in context, checking its working directory, conditionals and whether it installs this package's dependencies.
- **Which lockfile to delete** is not asserted. Install-command evidence does not prove an extra lockfile is stale: it may support dependency-update or compatibility tooling. Current fixes describe the observed state and require maintainers to confirm intent before changing it.
- `npm ci --dry-run` and `pnpm install --lockfile-only` are no longer treated as installs. This was found in the tuning sample.

## CI install-step rule (still experimental)

We tested whether "a CI or deploy install step uses a different manager from the one the package is set up for" (`package-manager/install-command`) could become a default rule. It fires rarely: once in 677 repositories across the earlier samples (an independently verified actionable finding: `npm ci` in a Bun repository, failing on every push) and never in the new 347. Almost every raw mismatch we found was correctly excluded: global tool installs, named packages, fallbacks, sub-packages with their own lockfile, and manual-only workflows. One independently verified actionable emission is too small a sample to establish a reliable rate, so the rule stays experimental.

## Historical fixes

- **Fix commits:** 35 real commits in which maintainers fixed a contradiction. CrossCheck was run on each fix commit and on the commit just before it.
- **Controls:** 36 commits from repositories without a known contradiction.

| | Default | With `--experimental` |
|---|---|---|
| Package-manager contradictions detected before the fix | 14 of 14 | 14 of 14 |
| All contradiction classes detected before the fix | 14 of 35 | 25 of 35 |
| Control commits flagged | 0 of 36 | 0 of 36 |
| Fix commits still flagged afterwards | 0 of 35 | 2 of 35 (both real, separate CI problems) |

## Pull-request behaviour on GitHub Actions

These scenarios ran on GitHub-hosted runners:

- A healthy change is silent.
- A PR that adds `package-lock.json` to a pnpm repository gets exactly one warning, on that file.
- With `fail-on: new`, that PR's check fails. Removing the file clears it.
- An unrelated PR on a branch that already has the conflict is not blamed.
- A PR that removes an existing conflict is reported as resolving it.
- A PR with only experimental-class conflicts never fails.

The CrossCheck step takes under a second on a small repository.

## Limits

- It reads configuration files only; it does not install or run anything.
- By default it covers one class of contradiction. It is not a general code-review or repository-consistency tool.
