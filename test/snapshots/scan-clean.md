# CrossCheck Repository Audit

- **Repository:** `<repo>`
- **Scanned:** working tree at commit `65d16b0039fd`
- **CrossCheck:** 0.2.0

## Summary

| | |
|---|---|
| Scan mode | Full repository scan |
| Packages evaluated | 1 |
| Established package manager | pnpm |
| Default findings | 0 |
| Experimental observations | not requested |

## Default findings

None. CrossCheck found no default findings.

## Repository model

What CrossCheck understood about this repository.

| | |
|---|---|
| Packages evaluated | 1 |
| Package manager | pnpm |
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
- Commit: `65d16b0039fd0c1aa13abcb3347e4856f55521ff`
- Command: `npx @zfinia/crosscheck@0.2.0 --format markdown`
