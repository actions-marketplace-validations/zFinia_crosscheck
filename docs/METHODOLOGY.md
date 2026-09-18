# How CrossCheck's default rule was measured

CrossCheck shows a rule by default only if it held up on repositories it was never tuned on.

## Live precision

- **Sample:** public GitHub repositories that contain AI-agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, …).
- **Frozen before scanning:** each sample's repository list and commit hashes were fixed before the engine ran, and the engine's file hashes were recorded before each run.
- **Checked by hand:** every finding was verified against the repository itself. A finding that could not be confirmed counts as wrong.
- **Tuning vs. holdouts:** one sample was used to tune the rules. Three later samples (600 repositories in total) were never used for tuning.

| Rules | Correct findings on the three unseen samples |
|---|---|
| Default: conflicting package-manager configuration | **34 of 34** |
| All rules including experimental (latest two samples) | 23 of 27 (about 85%) |

The experimental rules fell short of the 95% bar we set, so they are opt-in and never fail a build.

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
