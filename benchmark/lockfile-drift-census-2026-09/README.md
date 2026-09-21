# The lockfile drift census

**How many active public JavaScript and TypeScript repositories carry
package-manager configuration that contradicts itself?**

Across a stratified random sample of **5,371** active public
repositories that contain a `package.json`, each frozen at a named commit:

> ## 3.65% contradict themselves
>
> 196 of 5,371 repositories (95% CI 3.18–4.18%)

A *contradiction* means one package declares or implies two different package
managers at once — for example a `package-lock.json` sitting next to a
`pnpm-lock.yaml`, or a lockfile that disagrees with the `"packageManager"`
field. From then on CI, a teammate and an AI coding agent can each install a
different dependency tree.

Every finding cites a file and a line at a frozen commit SHA, so you can check
any one of them without running anything: see [`data/findings.jsonl`](data/findings.jsonl).

---

## Headline numbers

| Measure | Rate | Repositories | 95% CI |
|---|---|---|---|
| Contradictory package-manager configuration | 3.65% | 196 / 5,371 | 3.18–4.18% |
| Two or more lockfile managers anywhere in the repo | 5.42% | 291 / 5,371 | 4.84–6.06% |
| Declares `"packageManager"` in `package.json` | 22.79% | 1,224 / 5,371 | 21.69–23.93% |
| Has a package manager established at all (lockfile or declaration) | 89.33% | 4,798 / 5,371 | 88.48–90.13% |
| Ships an AI-agent instruction file | 23.55% | 1,265 / 5,371 | 22.44–24.71% |
| Has an unparseable `package.json` | 0.00% | 0 / 5,371 | 0.00–0.07% |

The first two rows are not nested, and neither contains the other. Two lockfiles
in *different* packages of a monorepo are a deliberate choice, not a
contradiction. And a contradiction does not need two lockfiles at all: a single
lockfile that disagrees with the `"packageManager"` field is one.

Of the 196 contradictions, 182 have two lockfile managers inside one
package and 14 come from one lockfile disagreeing with the declared manager.

## Which managers collide

| Pair | Findings |
|---|---|
| npm + pnpm | 78 |
| npm + yarn | 71 |
| bun + npm | 46 |
| bun + yarn | 8 |
| pnpm + yarn | 7 |
| bun + pnpm | 7 |
| npm + pnpm + yarn | 2 |
| bun + npm + pnpm | 2 |
| bun + npm + pnpm + yarn | 1 |
| bun + npm + yarn | 1 |

## By popularity

| Stars | Rate | Repositories | 95% CI |
|---|---|---|---|
| 20-49 | 3.58% | 69 / 1,928 | 2.84–4.50% |
| 50-149 | 3.53% | 54 / 1,529 | 2.72–4.58% |
| 150-499 | 4.09% | 41 / 1,002 | 3.03–5.50% |
| 500-1499 | 2.29% | 11 / 481 | 1.28–4.05% |
| 1500-4999 | 4.55% | 12 / 264 | 2.62–7.78% |
| 5000+ | 5.39% | 9 / 167 | 2.86–9.92% |

## By language

| GitHub language | Rate | Repositories | 95% CI |
|---|---|---|---|
| JavaScript | 2.76% | 54 / 1,956 | 2.12–3.58% |
| TypeScript | 4.16% | 142 / 3,415 | 3.54–4.88% |

TypeScript repositories contradict themselves 1.4 percentage points more often than
JavaScript ones. That difference **is** significant (z = 2.628, p = 0.0086), though the
census cannot say why; TypeScript repositories skew newer and larger.

## By repository age

| Created | Rate | Repositories | 95% CI |
|---|---|---|---|
| before 2015 | 1.52% | 4 / 263 | 0.59–3.84% |
| 2015 | 0.65% | 1 / 155 | 0.11–3.56% |
| 2016 | 2.08% | 4 / 192 | 0.81–5.23% |
| 2017 | 3.37% | 9 / 267 | 1.78–6.28% |
| 2018 | 1.72% | 5 / 291 | 0.74–3.96% |
| 2019 | 3.31% | 10 / 302 | 1.81–5.99% |
| 2020 | 3.22% | 13 / 404 | 1.89–5.43% |
| 2021 | 3.16% | 12 / 380 | 1.82–5.44% |
| 2022 | 3.88% | 16 / 412 | 2.40–6.21% |
| 2023 | 4.05% | 18 / 444 | 2.58–6.32% |
| 2024 | 4.58% | 22 / 480 | 3.05–6.84% |
| 2025 | 6.84% | 45 / 658 | 5.15–9.03% |
| 2026 | 3.29% | 37 / 1,123 | 2.40–4.51% |

## Does declaring `"packageManager"` help?

| Manifest | Rate | Repositories | 95% CI |
|---|---|---|---|
| declares "packageManager" | 4.66% | 57 / 1,224 | 3.61–5.99% |
| does not declare it | 3.35% | 139 / 4,147 | 2.85–3.94% |

Declaring the field goes with a **higher** contradiction rate, not a lower one
(1.31 percentage points, z = 2.14, p = 0.0324).

Do not read that as "declaring it makes things worse". Declaring the field also
makes a contradiction **detectable**: a lockfile can disagree with a declaration
that exists, and cannot disagree with one that does not. Of the 196 contradictions,
14 are visible only because the repository declared a manager. The two groups
are not measuring the same thing, so this is evidence about detectability, not
about hygiene.

## Repositories that ship AI-agent instructions

| Cohort | Rate | Repositories | 95% CI |
|---|---|---|---|
| has agent instruction file | 4.35% | 55 / 1,265 | 3.36–5.62% |
| no agent instruction file | 3.43% | 141 / 4,106 | 2.92–4.04% |

**This difference is not statistically significant.** A two-proportion z-test
gives z = 1.516, p = 0.1296 — the gap of 0.91 percentage points is
within what sampling noise produces at this sample size. On this evidence,
repositories that ship an `AGENTS.md` or `CLAUDE.md` **do not** contradict
themselves measurably more often than repositories that do not.

That is worth stating plainly, because it is the opposite of what a vendor of a
tool for this problem would prefer to find. The comparison is also observational:
the two groups differ in age, size and activity, none of which is controlled for.

## Where the contradictions sit

| Location | Findings |
|---|---|
| Repository root package | 147 |
| A sub-package inside the repository | 76 |

## Does the repository's own CI disagree with its lockfiles?

Of the 196 contradicting repositories, **87 (44.39%)** have an unconditional install step in their own GitHub Actions workflow,
Dockerfile or `vercel.json` that names one of the colliding managers. For those,
a fix can cite the repository's own CI instead of guessing.

The census deliberately does **not** claim these builds are broken today. Two
lockfiles can coexist for a long time without failing anything. What it shows is
how often a repository's configuration no longer has a single answer to the
question “which package manager is this?”.

---

## How this differs from the precision benchmark

`benchmark/ai-agent-repositories-2026-09` answers a different question, and the
two should not be confused:

| | Precision benchmark | This census |
|---|---|---|
| Question | When CrossCheck reports something, is it right? | How common is the problem? |
| Sample | Targeted: repositories with AI-agent instruction files | Stratified random sample of active public JS/TS repositories |
| Verification | Every finding manually confirmed | Automated; every finding published with a permalink for checking |
| Claim | 47 of 47 correct on unseen holdouts | A prevalence rate with a confidence interval |

A precision result cannot tell you how often the problem occurs, and a
prevalence rate cannot tell you whether the tool is right. They are
complementary.

---

## Coverage

| | |
|---|---|
| Frame | 71,425 repositories |
| Frame coverage of the queried population | 71,425 of 79,715 (89.60%) |
| Strata | 145 (129 enumerated completely, 16 over the Search API's 1000-result cap) |
| Sampled | 6,014 |
| Scanned | 6,014 |
| Scanned successfully | 6,004 |
| Failed to clone or read | 10 |
| Contained a `package.json` (the denominator) | 5,371 |
| CrossCheck engine | 0.2.0 |
| Provider equivalence | 19 identical, 0 not identical, 1 not comparable on this host |

Why some repositories could not be scanned:

- `git cat-file failed: fatal: could not fe…` — 9
- `git clone failed: fatal: unable to acces…` — 1

## Experimental rules (not in the headline)

CrossCheck's experimental tier did not meet its own precision bar, so it never
fails a build and is excluded from every number above. For completeness, what it
fired on across the same sample:

- `package-manager/install-command` — 16
- `database/conflicting-datasource` — 4
- `auth/conflicting-providers` — 3
- `package-manager/agent-instructions` — 1
- `database/agent-instructions` — 1

---

## Reproduce it

Everything needed is here: the frozen frame, the exact search queries, the
seeded sample, the scanner and the analysis.

```sh
SEED=20260921 TARGET=6000 node sample.mjs
node collect.mjs
node analyze.mjs
```

[`METHODOLOGY.md`](METHODOLOGY.md) explains the sampling design, the provider
equivalence test, and the limits of what this measures.

## Check a single finding

[`data/findings.jsonl`](data/findings.jsonl) has one line per finding with the
repository, the frozen commit SHA and a permalink to every cited line. No
tooling required.

## Run it on your own repository

```sh
npx @zfinia/crosscheck
```

Or on pull requests, with nothing to sign up for and no permissions to grant:

```yaml
- uses: actions/checkout@v5
- uses: zFinia/crosscheck@v0
```

---

Generated 2026-09-21T05:04:07.081Z by `render.mjs` from `data/report.json`.
Data and text CC BY 4.0; code MIT.
