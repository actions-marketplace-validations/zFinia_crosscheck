# CrossCheck Repository Audit

- **Repository:** `<repo>`
- **Scanned:** working tree at commit `f90ad0f3334e`
- **CrossCheck:** 0.2.0

## Summary

| | |
|---|---|
| Scan mode | Full repository scan |
| Packages evaluated | 1 |
| Established package manager | CONFLICT (npm vs pnpm) |
| Proven contradictions | 1 |
| Experimental observations | not requested |

## Proven findings

### 1. Package manager conflict: npm vs pnpm

Two package managers are configured for the same package. Developers, CI and AI coding tools can each install a different dependency tree depending on which one they pick.

- **Rule:** `package-manager/conflicting-config`
- **Evidence:**
  - `package-lock.json` → npm (lockfile present)
  - `pnpm-lock.yaml` → pnpm (lockfile present)
  - `.github/workflows/ci.yml:6` → pnpm (`pnpm i`)
  - `.github/workflows/publish.yml:6` → npm (`npm ci`)
- **Recommended fix:** Install steps for this package disagree: npm in .github/workflows/publish.yml:6; pnpm in .github/workflows/ci.yml:6. What you test can differ from what you build or ship. Pick one manager, delete the other lockfile, and make every install step use it.

## Repository model

What CrossCheck understood about this repository.

| | |
|---|---|
| Packages evaluated | 1 |
| Package manager | CONFLICT (npm vs pnpm) |
| ORM | none detected |
| Database | not established |
| Authentication | none detected |
| Agent instructions | AGENTS.md |

## What CrossCheck checked

CrossCheck compared the setup decisions recorded in this repository's configuration files: lockfiles, the `packageManager` field in each `package.json`, ORM and datasource configuration, install steps in GitHub Actions workflows, Dockerfiles and `vercel.json`, and AI-agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, …). Each package in a monorepo is checked on its own.

Proven findings come from rules that were right every time on public repositories they were never tuned on. Only proven findings can fail a check. CrossCheck is not a general code reviewer: it does not read application code, install packages or run anything.

## Privacy

This scan ran locally. CrossCheck made no network requests and uploaded no repository contents.

## Reproducibility

- CrossCheck version: 0.2.0
- Commit: `f90ad0f3334ed6257bd2df53bdc170f7e02fdf58`
- Command: `npx @zfinia/crosscheck@0.2.0 --format markdown`
