# CrossCheck Repository Audit

- **Repository:** `<repo>`
- **Scanned:** working tree at commit `f90ad0f3334e`
- **CrossCheck:** 0.2.0

## Summary

| | |
|---|---|
| Scan mode | Full repository scan |
| Packages evaluated | 1 |
| Established package manager | multiple configurations (npm and pnpm) |
| Default findings | 1 |
| Experimental observations | not requested |

## Default findings

### 1. Multiple package-manager configurations detected: npm and pnpm

Multiple package-manager configuration signals exist in the same package. This may be accidental drift or deliberate compatibility and dependency-update coverage; CrossCheck cannot infer maintainer intent from coexistence alone.

- **Rule:** `package-manager/conflicting-config`
- **Evidence:**
  - `package-lock.json` → npm (lockfile present)
  - `pnpm-lock.yaml` → pnpm (lockfile present)
  - `.github/workflows/ci.yml:6` → pnpm (`pnpm i`)
  - `.github/workflows/publish.yml:6` → npm (`npm ci`)
- **Recommended fix:** Install steps use multiple package managers: npm in .github/workflows/publish.yml:6; pnpm in .github/workflows/ci.yml:6. This may be deliberate compatibility coverage. Confirm maintainer intent before changing lockfiles or install steps; if the coverage is unintended, align them with the manager the repository chooses.

## Repository model

What CrossCheck understood about this repository.

| | |
|---|---|
| Packages evaluated | 1 |
| Package manager | multiple configurations (npm and pnpm) |
| ORM | none detected |
| Database | not established |
| Authentication | none detected |
| Agent instructions | AGENTS.md |

## What CrossCheck checked

CrossCheck compared the setup decisions recorded in this repository's configuration files: lockfiles, the `packageManager` field in each `package.json`, ORM and datasource configuration, install steps in GitHub Actions workflows, Dockerfiles and `vercel.json`, and AI-agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, …). Each package in a monorepo is checked on its own.

Default findings come from rules whose cited configuration evidence was verified on held-out public repositories. That verification does not establish maintainer intent or that every emitted state requires remediation. Only default findings can fail a check. CrossCheck is not a general code reviewer: it does not read application code, install packages or run anything.

## Privacy

This scan ran locally. CrossCheck made no network requests and uploaded no repository contents.

## Reproducibility

- CrossCheck version: 0.2.0
- Commit: `f90ad0f3334ed6257bd2df53bdc170f7e02fdf58`
- Command: `npx @zfinia/crosscheck@0.2.0 --format markdown`
