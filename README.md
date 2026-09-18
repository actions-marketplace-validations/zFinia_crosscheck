# CrossCheck by zFinia

Catch a package-manager contradiction in the pull request that introduces it.

When people and AI coding agents share a repository, one `npm install` in a pnpm project leaves a `package-lock.json` next to `pnpm-lock.yaml`, and from then on CI, teammates and agents may each install a different dependency tree. CrossCheck flags that on the pull request that adds it, names the file, and says how to fix it. Otherwise it stays silent.

By default it checks one thing: **conflicting package-manager configuration** (lockfiles and `packageManager`) within the same package. It also flags a `package.json` that is not valid JSON. Checks for ORM, database, auth provider, CI install steps and agent-instruction files exist, but they are opt-in and experimental (see below).

- **No account, no OAuth.** It reads files on your machine or in your CI job and makes no network calls; nothing is uploaded. (`npx` downloads the package from npm once; it has no dependencies.)
- **Diff-aware.** On a pull request it reports only contradictions *that change introduced*. Existing repository debt never makes an unrelated PR noisy.
- **Deterministic.** Every finding cites files (and lines) you can check. No AI judgement.

## Run it

```sh
npx @zfinia/crosscheck                                  # scan this repository
npx @zfinia/crosscheck --base origin/main               # what did my branch introduce?
npx @zfinia/crosscheck --base main --head HEAD --format json
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
Package manager:    CONFLICT (npm vs pnpm)
ORM:                Drizzle
Database:           PostgreSQL (from driver)
Authentication:     Clerk
Agent instructions: CLAUDE.md

NEW contradictions introduced by this change: 1

1. Package manager conflict: npm vs pnpm
     - package-lock.json → npm (lockfile present)
     - package.json → pnpm ("packageManager": "pnpm@10.12.1")
     - pnpm-lock.yaml → pnpm (lockfile present)
     Fix: "packageManager" declares pnpm. Remove package-lock.json and reinstall with pnpm, or change "packageManager" if you are deliberately migrating.
   Introduced by: package-lock.json
```

Requires Node.js 18 or later; `--base` needs git.

## Add it to pull requests

```yaml
# .github/workflows/crosscheck.yml
name: CrossCheck
on: pull_request

jobs:
  crosscheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: zFinia/crosscheck@v0
```

Advisory by default: a new contradiction appears as a warning on the file that introduced it and in the job log, and the check stays green. Contradictions that already exist on the base branch are never reported as new. To fail the check on new contradictions:

```yaml
      - uses: zFinia/crosscheck@v0
        with:
          fail-on: new
```

## Why it is quiet by default

A check people learn to ignore is worse than no check. CrossCheck only shows a finding by default if that rule was right every time on repositories it was never tuned on. It reports only what a pull request *introduced*, never debt that was already there, and it does not fail the build unless you ask it to.

## Proven and experimental rules

By default CrossCheck reports only **proven** rules, which are the only rules that can fail a check ([how this was measured](docs/METHODOLOGY.md)):

- `package-manager/conflicting-config`: lockfiles or `packageManager` for different managers in one package. On three sets of public repositories the rules were never tuned on, 34 of 34 findings were confirmed by hand.
- `manifest/unparseable`: a `package.json` that is not valid JSON.

Every other rule is **experimental**. On the same unseen repositories these rules were right less often than the ≥95% bar we require. Pass `--experimental` (Action: `experimental: true`) to see them. They are labelled `[experimental]`, appear as notices on PRs, and never fail a check.

In the default output, if a class has only experimental evidence of a conflict, the repository model says *not established* rather than CONFLICT.

## What it checks

| Class | Contradiction (within one package) | Evidence it trusts |
|---|---|---|
| Package manager | lockfiles or `packageManager` for different managers (**proven**); a CI/Docker/Vercel install step using another manager, or agent instructions naming another manager (experimental) | lockfiles, `packageManager`, unconditional install steps for this project |
| ORM (experimental) | two ORMs configured; agent instructions naming an ORM that is not configured | dependencies, `prisma/schema.prisma`, `drizzle.config.*` |
| Database (experimental) | Prisma provider, hard-coded Drizzle dialect and example `DATABASE_URL` disagree; a document database and a SQL database both as runtime dependencies | datasource config, runtime dependencies |
| Auth provider (experimental) | two sign-in providers installed (Auth.js/NextAuth, Clerk, Better Auth, Auth0, Lucia) | dependencies |
| Manifest (**proven**) | `package.json` that is not valid JSON (usually unresolved merge markers) | the manifest |

Every directory with a `package.json` is checked separately, so packages in a monorepo may legitimately choose differently.

What it deliberately does **not** treat as evidence: README prose, lists of alternatives, publishing notes, global/`npx`/`dlx` installs, installs with `--prefix` or a named package, conditional/fallback install scripts, and Drizzle configs that pick a dialect at runtime. Two SQL drivers side by side (for example SQLite for tests next to PostgreSQL) are not flagged.

What it does not do: runtime coordination between agents, merge conflicts, shared ports or databases, or general code review.

## Exit codes

`0` ok (default, advisory) · `1` a proven contradiction was found and `--fail-on new|any` matched · `2` usage or runtime error.

## Versions

`zFinia/crosscheck@v0` always points at the latest reviewed `0.x` release, and is moved only after that release has passed the test suite and a pull-request smoke test on GitHub-hosted runners. For a fixed version, pin `zFinia/crosscheck@v0.1.0` or a full commit SHA. The npm package uses the same version numbers.

The Action runs with the runner's own Node.js (18 or later), which GitHub-hosted runners provide.

## License

MIT © zFinia
