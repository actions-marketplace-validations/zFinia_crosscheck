# CrossCheck Repository Audit

- **Repository:** `<repo>`
- **Compared:** `730edcf8a5af` → `b45687ea8148`
- **CrossCheck:** 0.2.0

## Summary

| | |
|---|---|
| Scan mode | Change review (only findings this change introduced) |
| Packages evaluated | 1 |
| Established package manager | multiple configurations (npm and pnpm) |
| New default findings | 1 |
| Experimental observations | not requested |
| Pre-existing (not caused by this change) | 0 |
| Resolved by this change | 0 |

## Default findings

### 1. Multiple package-manager configurations detected: npm and pnpm

Multiple package-manager configuration signals exist in the same package. This may be accidental drift or deliberate compatibility and dependency-update coverage; CrossCheck cannot infer maintainer intent from coexistence alone.

- **Rule:** `package-manager/conflicting-config`
- **Evidence:**
  - `package-lock.json` → npm (lockfile present)
  - `package.json` → pnpm ("packageManager": "pnpm@10.0.0")
  - `pnpm-lock.yaml` → pnpm (lockfile present)
- **Introduced by:** `package-lock.json`
- **Recommended fix:** "packageManager" declares pnpm; other package-manager state exists in package-lock.json. Confirm maintainer intent before changing it. If pnpm is authoritative and the other state was introduced unintentionally, remove package-lock.json and reinstall with pnpm. If the extra state supports dependency-update or compatibility tooling, keep it and document that purpose.

## Repository model

What CrossCheck understood about this repository.

| | |
|---|---|
| Packages evaluated | 1 |
| Package manager | multiple configurations (npm and pnpm) |
| ORM | none detected |
| Database | not established |
| Authentication | none detected |
| Agent instructions | none found |

## What CrossCheck checked

CrossCheck compared the setup decisions recorded in this repository's configuration files: lockfiles, the `packageManager` field in each `package.json`, ORM and datasource configuration, install steps in GitHub Actions workflows, Dockerfiles and `vercel.json`, and AI-agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, …). Each package in a monorepo is checked on its own.

Default findings come from rules whose cited configuration evidence was verified on held-out public repositories. That verification does not establish maintainer intent or that every emitted state requires remediation. Only default findings can fail a check. CrossCheck is not a general code reviewer: it does not read application code, install packages or run anything.

## Privacy

This scan ran locally. CrossCheck made no network requests and uploaded no repository contents.

## Reproducibility

- CrossCheck version: 0.2.0
- Base: `730edcf8a5af2519679625f137d587c8661359e3`
- Head: `b45687ea814823df68466c2f587e7978f9fa5407`
- Command: `npx @zfinia/crosscheck@0.2.0 --base 730edcf8a5af --head b45687ea8148 --format markdown`
