# CrossCheck Repository Audit

- **Repository:** `<repo>`
- **Compared:** `730edcf8a5af` → `b45687ea8148`
- **CrossCheck:** 0.1.1

## Summary

| | |
|---|---|
| Scan mode | Change review (only contradictions this change introduced) |
| Packages evaluated | 1 |
| Established package manager | CONFLICT (npm vs pnpm) |
| New proven contradictions | 1 |
| Experimental observations | not requested |
| Pre-existing (not caused by this change) | 0 |
| Resolved by this change | 0 |

## Proven findings

### 1. Package manager conflict: npm vs pnpm

Two package managers are configured for the same package. Developers, CI and AI coding tools can each install a different dependency tree depending on which one they pick.

- **Rule:** `package-manager/conflicting-config`
- **Evidence:**
  - `package-lock.json` → npm (lockfile present)
  - `package.json` → pnpm ("packageManager": "pnpm@10.0.0")
  - `pnpm-lock.yaml` → pnpm (lockfile present)
- **Introduced by:** `package-lock.json`
- **Recommended fix:** "packageManager" declares pnpm. Remove package-lock.json and reinstall with pnpm, or change "packageManager" if you are deliberately migrating.

## Repository model

What CrossCheck understood about this repository.

| | |
|---|---|
| Packages evaluated | 1 |
| Package manager | CONFLICT (npm vs pnpm) |
| ORM | none detected |
| Database | not established |
| Authentication | none detected |
| Agent instructions | none found |

## What CrossCheck checked

CrossCheck compared the setup decisions recorded in this repository's configuration files: lockfiles, the `packageManager` field in each `package.json`, ORM and datasource configuration, install steps in GitHub Actions workflows, Dockerfiles and `vercel.json`, and AI-agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, …). Each package in a monorepo is checked on its own.

Proven findings come from rules that were right every time on public repositories they were never tuned on. Only proven findings can fail a check. CrossCheck is not a general code reviewer: it does not read application code, install packages or run anything.

## Privacy

This scan ran locally. CrossCheck made no network requests and uploaded no repository contents.

## Reproducibility

- CrossCheck version: 0.1.1
- Base: `730edcf8a5af2519679625f137d587c8661359e3`
- Head: `b45687ea814823df68466c2f587e7978f9fa5407`
- Command: `npx @zfinia/crosscheck@0.1.1 --base 730edcf8a5af --head b45687ea8148 --format markdown`
