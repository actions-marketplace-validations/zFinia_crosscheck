# CrossCheck by zFinia

Remember the engineering decisions a repository has made, and stop humans and AI coding agents from silently undoing them.

When people and AI coding agents share a repository, one `npm install` in a pnpm project leaves a `package-lock.json` next to `pnpm-lock.yaml`, and from then on CI, teammates and agents may each install a different dependency tree. CrossCheck flags that on the pull request that adds it, names the file, and says how to fix it. Otherwise it stays silent.

Without a contract, CrossCheck keeps its existing focused behaviour: it checks **conflicting package-manager configuration** (lockfiles and `packageManager`) within the same package and invalid `package.json` files. Checks for ORM, database, auth provider, CI install steps and agent-instruction files remain opt-in and experimental.

With a committed `.crosscheck/contract.json`, CrossCheck also evaluates explicit repository decisions such as package manager, Node major, ORM, database engine and authentication provider. The community CLI previews contract findings locally. Block-level pull-request enforcement is provided by managed CrossCheck monitoring.

- **Private local scans.** The community CLI needs no account or OAuth, reads files on your machine, and makes no scan-time network calls. (`npx` downloads the package from npm once; it has no dependencies.)
- **Diff-aware.** On a pull request it reports only contradictions *that change introduced*. Existing repository debt never makes an unrelated PR noisy.
- **Deterministic.** Every finding cites files (and lines) you can check. No AI judgement.

## Run it

```sh
npx @zfinia/crosscheck                                  # scan this repository
npx @zfinia/crosscheck --base origin/main               # what did my branch introduce?
npx @zfinia/crosscheck --base main --head HEAD --format json
npx @zfinia/crosscheck --format markdown > crosscheck-audit.md   # audit report
npx @zfinia/crosscheck contract init                    # create a safe initial contract
npx @zfinia/crosscheck contract suggest                 # review optional policy candidates
npx @zfinia/crosscheck context                          # context for humans and coding agents
npx @zfinia/crosscheck context --write                  # write .crosscheck/AGENT_CONTEXT.md
```

On a healthy pnpm project:

```
CrossCheck repository model

Packages evaluated: 1
Package manager:    pnpm
ORM:                Drizzle
Database:           PostgreSQL (from driver)
Authentication:     Clerk
Agent instructions: CLAUDE.md

Contradictions: none
CrossCheck reads only lockfiles, manifests, ORM/datasource config, CI install steps and agent instruction files. Nothing left this machine.
```

After an `npm install` adds `package-lock.json` (`crosscheck --base HEAD~1 --head HEAD`):

```
CrossCheck: 5735ae00f80b → 6ec0b990bda4

Packages evaluated: 1
Package manager:    multiple configurations (npm and pnpm)
ORM:                Drizzle
Database:           PostgreSQL (from driver)
Authentication:     Clerk
Agent instructions: CLAUDE.md

NEW findings introduced by this change: 1

1. Multiple package-manager configurations detected: npm and pnpm
     - package-lock.json → npm (lockfile present)
     - package.json → pnpm ("packageManager": "pnpm@10.12.1")
     - pnpm-lock.yaml → pnpm (lockfile present)
     Fix: "packageManager" declares pnpm; other package-manager state exists in package-lock.json. Confirm maintainer intent before changing it. If pnpm is authoritative and the other state was introduced unintentionally, remove package-lock.json and reinstall with pnpm. If the extra state supports dependency-update or compatibility tooling, keep it and document that purpose.
   Introduced by: package-lock.json
```

Requires Node.js 18 or later; `--base` needs git.

## Repository Decision Contracts

Initialize explicit repository memory with:

```sh
npx @zfinia/crosscheck contract init
```

This writes `.crosscheck/contract.json` using only high-confidence established package-manager and unambiguous Node-major evidence. It does not automatically enforce inferred ORM, database, or auth choices. Review optional candidates with `contract suggest`, then add only decisions your team intends to own.

```json
{
  "$schema": "https://www.zfinia.com/schemas/crosscheck-contract-v1.json",
  "version": 1,
  "changePolicy": "approval-required",
  "decisions": [
    {
      "key": "package.manager",
      "scope": ".",
      "allowed": ["pnpm"],
      "enforcement": "block",
      "reason": "This repository is managed with pnpm."
    },
    {
      "key": "runtime.node",
      "scope": ".",
      "allowed": ["22"],
      "enforcement": "block"
    }
  ]
}
```

Contract v1 uses exact scopes: a decision for `apps/web` does not silently apply to `services/api`. Strong conflicting evidence produces `contract/violation`; weak conflicting evidence produces the always-advisory `contract/possible-violation`; missing strong evidence produces the always-advisory `contract/unverified`. Local `block` findings are previews, while managed monitoring can enforce them on pull requests. `off` decisions produce no finding. Invalid policy fails closed. Formatting and JSON key order do not affect the SHA-256 contract digest. See [the full contract guide](docs/CONTRACT.md) and [JSON schema](docs/crosscheck-contract-v1.schema.json).

### Context for coding agents

`crosscheck context` renders compact repository decisions. `crosscheck context --format json` provides deterministic machine-oriented JSON. `crosscheck context --write` creates `.crosscheck/AGENT_CONTEXT.md`, which explains the decisions and safe change rules without timestamps. The generated Markdown is not authority; `.crosscheck/contract.json` is.

### Deliberate migrations

The base-branch contract is authoritative during a pull request. A pull request cannot authorize its own violation merely by rewriting the contract.

To migrate from pnpm to npm, update the repository configuration and contract together, remove all remaining pnpm state, and obtain maintainer approval with either the `crosscheck:decision-change` pull-request label or Action input `allow-contract-change: true`. Approval permits exactly that proposed decision migration; it does not suppress generic findings or allow a mixed npm/pnpm final state. Initial contract adoption needs no special label, but the new policy must match the repository.

### Audit report

`--format markdown` writes a self-contained report you can save as `crosscheck-audit.md` or attach to an issue. It has a summary, each default finding with its evidence and conditional next step, what CrossCheck checked, a privacy statement and the exact command to reproduce it. It works for a full scan and with `--base`/`--head`. Experimental observations appear only with `--experimental`, in their own section labelled *not safe to block*. The report contains no timestamps and no absolute paths, so the same commit always produces the same report.

## Add it to pull requests

Copy this into `.github/workflows/crosscheck.yml`. There is nothing to sign up for, no token to create, and no permission to grant:

```yaml
name: CrossCheck
on: pull_request

jobs:
  crosscheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: zFinia/crosscheck@v0
```

That is the whole setup. On this path the Action makes **no network calls of its own**: it reads the repository already checked out on your runner and writes a warning to the pull request when a change introduces a package-manager contradiction. Nothing leaves the runner.

By default it only warns. `fail-on: new` and `fail-on: any` are strict opt-in policies: they block matching default findings based on configuration evidence, including deliberate multi-manager compatibility state. CrossCheck does not infer intent before applying this operator-selected policy. To fail the check when a change *introduces* a default finding:

```yaml
      - uses: zFinia/crosscheck@v0
        with:
          fail-on: new
```

With `fail-on: new`, existing findings never fail an unrelated pull request—only what the change introduces. `fail-on: any` can also block pre-existing findings. If enforcement must reflect repository intent instead of treating all multi-manager configuration state strictly, record that intent in an explicit CrossCheck contract and use contract enforcement; leave generic `fail-on` disabled for deliberately supported multi-manager changes. See [exit codes](#exit-codes).

### Repository decision contracts (preview)

If you commit a `.crosscheck/contract.json`, the Action also previews contract findings. They are reported as notices and never fail the build.

### Managed monitoring (optional, paid)

Block-level contract enforcement for protected repositories is provided through CrossCheck monitoring plans. See [plans](https://www.zfinia.com/crosscheck#plans). It is opt-in and needs GitHub OIDC:

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  crosscheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: zFinia/crosscheck@v0
        with:
          managed-monitoring: true
          fail-on: new
```

Authorization sends only GitHub-signed repository identity to zFinia, never repository source or configuration contents. No long-lived CrossCheck secret is stored in the repository. If the repository is not on a plan, the Action says so in a notice and keeps running in preview mode — it never fails your build for that reason.

For an intentional repository decision migration under managed monitoring, a maintainer can apply the `crosscheck:decision-change` label. The label approves the migration but does not create a paid entitlement. The Action only observes existing labels; it never writes labels. An explicit workflow-controlled alternative is:

```yaml
      - uses: zFinia/crosscheck@v0
        with:
          managed-monitoring: true
          fail-on: new
          allow-contract-change: true
```

## How common is this, actually?

We scanned a stratified random sample of **5,371** active public JavaScript and
TypeScript repositories, each frozen at a named commit. **3.65%** carry
package-manager configuration that contradicts itself (95% CI 3.18-4.18%).

The frozen frame, the exact search queries, the seeded sample, the scanner, every
finding with a permalink to each cited line, and an integrity checker that
recomputes the headline from the raw scan are all in
[`benchmark/lockfile-drift-census-2026-09`](benchmark/lockfile-drift-census-2026-09).

```sh
npm run census:verify
```

It also reports a null result: repositories shipping an `AGENTS.md` or `CLAUDE.md`
did **not** contradict themselves significantly more often (p = 0.13).

## Why it is quiet by default

A check people learn to ignore is worse than no check. CrossCheck only shows a finding by default when the rule's cited configuration evidence was verified on held-out repositories. Evidence verification does not establish maintainer intent or prove that every emitted state needs remediation. CrossCheck reports only what a pull request *introduced*, never debt that was already there, and it does not fail the build unless you ask it to.

The [public September 2026 benchmark](benchmark/ai-agent-repositories-2026-09/README.md) includes every frozen repository and commit, raw machine-readable results, evidence-review records, file hashes, and an integrity checker. It separates the 80-repository tuning set from 947 untouched holdouts; all 47 emitted default-rule findings had their cited configuration evidence verified. That result does not establish maintainer intent or actionability, and the original 47/47 precision interpretation has been retracted.

## Proven and experimental rules

By default CrossCheck reports only **proven** rules, which are the only rules that can fail a check ([how this was measured](docs/METHODOLOGY.md)):

- `package-manager/conflicting-config`: lockfiles or `packageManager` state for different managers in one package. On four held-out public-repository sets, all 47 emitted findings cited configuration evidence that was present at the frozen commit. CrossCheck does not infer whether coexistence is accidental or deliberate. When CI, Docker or `vercel.json` uses one or several managers, the finding cites those steps and makes any remediation conditional on maintainer intent.
- `manifest/unparseable`: a `package.json` that is not valid JSON.

Every other rule is **experimental**. On the same unseen repositories these rules were right less often than the ≥95% bar we require. Pass `--experimental` (Action: `experimental: true`) to see them. They are labelled `[experimental]`, appear as notices on PRs, and never fail a check.

In the default output, if a class has only experimental evidence of a conflict, the repository model says *not established* rather than CONFLICT.

## What it checks

| Class | Contradiction (within one package) | Evidence it trusts |
|---|---|---|
| Package manager | lockfiles or `packageManager` for different managers (**proven**); a CI/Docker/Vercel install step using another manager, or agent instructions naming another manager (experimental) | lockfiles, `packageManager`, unconditional install steps for this project |
| Node runtime | an explicit contract disagrees with an unambiguous established Node major | `.nvmrc`, `.node-version`, `.tool-versions`, `package.json#engines.node`, static `actions/setup-node` configuration |
| ORM (experimental) | two ORMs configured; agent instructions naming an ORM that is not configured | dependencies, `prisma/schema.prisma`, `drizzle.config.*` |
| Database (experimental) | Prisma provider, hard-coded Drizzle dialect and example `DATABASE_URL` disagree; a document database and a SQL database both as runtime dependencies | datasource config, runtime dependencies |
| Auth provider (experimental) | two sign-in providers installed (Auth.js/NextAuth, Clerk, Better Auth, Auth0, Lucia) | dependencies |
| Manifest (**proven**) | `package.json` that is not valid JSON (usually unresolved merge markers) | the manifest |

Every directory with a `package.json` is checked separately, so packages in a monorepo may legitimately choose differently.

An explicit contract is a third enforcement category—not “proven” or “experimental.” It is enforceable because the repository owner declared the policy. Generic experimental findings still never fail a build, even with `--experimental`.

What it deliberately does **not** treat as evidence: README prose, lists of alternatives, publishing notes, global/`npx`/`dlx` installs, installs with `--prefix` or a named package, conditional/fallback install scripts, and Drizzle configs that pick a dialect at runtime. Two SQL drivers side by side (for example SQLite for tests next to PostgreSQL) are not flagged.

Ambiguous Node expressions such as `>=18`, `lts/*`, dynamic matrices and ranges spanning several majors are deliberately ignored. What CrossCheck does not do: runtime coordination between agents, merge conflicts, shared ports or databases, or general code review.

## Exit codes

`0` ok/advisory · `1` a default finding matched locally, or an authorized managed Action matched a block-level contract finding, with `--fail-on new|any` · `2` usage, invalid policy or runtime error. `--fail-on new|any` is strict and evidence-based: it can block deliberate multi-manager state. Intent-aware enforcement requires an explicit CrossCheck contract; do not opt into generic `fail-on` for deliberate multi-manager changes that should remain advisory.

## Versions

`zFinia/crosscheck@v0` always points at the latest reviewed `0.x` release, and is moved only after that release has passed the test suite and a pull-request smoke test on GitHub-hosted runners. For a fixed version, pin `zFinia/crosscheck@v0.2.0` or a full commit SHA. The npm package uses the same version numbers.

The Action runs with the runner's own Node.js (18 or later), which GitHub-hosted runners provide.

## License

MIT © zFinia
