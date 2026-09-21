# CrossCheck Repository Audit

- **Repository:** `<repo>`
- **Scanned:** working tree at commit `11a509655ef3`
- **CrossCheck:** 0.2.0

## Summary

| | |
|---|---|
| Scan mode | Full repository scan |
| Packages evaluated | 1 |
| Established package manager | Bun |
| Default findings | 0 |
| Experimental observations | 1 |

## Default findings

None. CrossCheck found no default findings.

## Experimental observations

> **EXPERIMENTAL — NOT SAFE TO BLOCK.** These rules have not yet met CrossCheck's validation bar on unseen repositories. Review each one by hand; they can never fail a check.

### 1. Agent instructions say npm, but the repository uses Bun

Agent instruction files tell AI coding tools to use a different package manager from the one the package is set up for.

- **Rule:** `package-manager/agent-instructions`
- **Evidence:**
  - `bun.lock` → Bun (lockfile present)
  - `package.json` → Bun ("packageManager": "bun@1.2.0")
  - `AGENTS.md:1` → npm (- Package manager: npm)
- **Recommended fix:** Update AGENTS.md:1 to Bun so agents stop running npm.

## Repository model

What CrossCheck understood about this repository.

| | |
|---|---|
| Packages evaluated | 1 |
| Package manager | Bun |
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
- Commit: `11a509655ef3bf515d8589d53bddeb0eff2f8f7f`
- Command: `npx @zfinia/crosscheck@0.2.0 --format markdown --experimental`
