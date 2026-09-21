# Methodology

This is a **prevalence census**, not a precision study. It asks one question:

> Across active public JavaScript and TypeScript repositories, how many carry
> package-manager configuration that contradicts itself?

Every number in `README.md` is generated from `raw/scan.jsonl` by `analyze.mjs`.
Nothing is typed in by hand.

## 1. The frame

The population is public GitHub repositories that are:

- classified by GitHub as **JavaScript** or **TypeScript**,
- **pushed since 2026-03-21** (active within six months),
- **not archived** and **not forks**,
- at least **20 stars**.

The GitHub Search API returns at most 1000 results per query, so a naive
"top N by stars" query would be a convenience sample of the most popular
repositories. Instead the frame is the **union of strata that are each
enumerated completely**: every stratum is a (language × star band × creation
date range) query whose `total_count` is at most 1000, so all of its members
are retrieved. Star bands that exceed the cap are split by creation year, and
years that still exceed it are split again.

`data/frame-strata.json` records every query, its `total_count`, how many
repositories were retrieved, and whether the stratum is `complete`.

**Known incompleteness.** A small number of strata exceed the 1000-result cap
even after splitting. They are flagged `complete: false` and are reported
separately; they are not silently treated as complete. One stratum transiently
returned zero results on the first pass and was re-enumerated by
`recover-strata.mjs`; `data/frame-recovery.log` records that.

## 2. The sample

A **proportionally allocated stratified random sample** is drawn from the frame
by `sample.mjs`. Proportional allocation makes the design *self-weighting*: the
sample proportion is an unbiased estimate of the frame proportion, with no
post-hoc weights to argue about.

The draw is deterministic and reproducible: a `mulberry32` PRNG seeded with
**20260921** drives a Fisher-Yates shuffle inside each stratum. Re-running
`SEED=20260921 node sample.mjs` reproduces the identical sample.

## 3. The scan

For each sampled repository:

1. It is cloned at its default branch with a **blobless partial clone**
   (`--depth 1 --filter=blob:none --no-checkout`). The resulting commit SHA is
   recorded and is what every finding cites.
2. `git ls-tree` lists the tree. The **engine's own `isRelevantPath`** selects
   the files CrossCheck reads — nothing else is ever fetched.
3. Lockfiles are **presence-only**: their contents are never downloaded or read,
   by CrossCheck's design and therefore by ours.
4. The selected blobs are fetched in one batched round trip and read from the
   git object store.
5. The **shipped engine** — `scanFiles()` from CrossCheck itself — produces the
   findings. No rule logic is reimplemented in this repository.

### Why you can trust the file provider

Reading blobs instead of a working tree is the one place this benchmark departs
from an ordinary `npx @zfinia/crosscheck` run, so it is tested rather than
asserted. `verify-provider.mjs` scans a repository **both ways** — once with the
benchmark's provider, once with CrossCheck's shipped `readWorkingTree` on a full
ordinary clone — and compares the engine's input byte-for-byte as well as its
findings.

`raw/provider-equivalence.txt` is that run: **19 repositories identical, 0 not
identical**, across single-package repositories, large monorepos (`vercel/next.js`,
329 relevant files), and repositories that do contain contradictions. One
repository could not be compared on this host because its tree contains a path
NTFS rejects; it is reported as `SKIP`, not as a pass.

The full clone is made with `core.autocrlf=false` and `core.eol=lf` so the
comparison reproduces the **Linux GitHub runner the Action actually runs on**.
Without that, a Windows checkout rewrites line endings and the comparison would
measure the host rather than the provider.

## 4. Conservative choices

- **Default rules only.** The headline counts only CrossCheck's proven tier.
  Experimental rules are recorded in the raw data and reported separately; they
  never enter the headline.
- **The denominator is repositories containing a `package.json`.** A repository
  GitHub labels "JavaScript" that has no manifest is excluded from rate
  calculations rather than counted as healthy.
- **Findings are scoped to one package.** A monorepo where two packages
  legitimately chose different managers is not a finding. Only a contradiction
  *inside a single package* counts.
- **Failures are reported, not dropped.** Repositories that could not be cloned
  or read appear in `raw/scan.jsonl` with `ok: false` and are counted in
  coverage.
- **Intervals are Wilson score intervals** at 95%, which behave sensibly for the
  small proportions reported here.

## 4a. Integrity

`verify.mjs` exists because an earlier attempt at this run was silently corrupted:
three copies of the driver script were left alive, each re-ran the stratum
recovery, and the frame briefly carried 1,120 duplicate rows. Nothing in the
pipeline noticed until two stages reported inconsistent counts.

The checker therefore does not trust `report.json`. It recomputes the headline
straight from `raw/scan.jsonl` and fails on any disagreement, and it asserts the
invariants that make the published claims mean what they say:

- the sample is a subset of the frame, contains no duplicates, and **re-drawing it
  with the recorded seed reproduces the identical set**;
- `raw/scan.jsonl` holds no duplicate repository;
- every finding cites a commit that matches its scan record, and every cited
  permalink is pinned to that commit;
- the two contradiction shapes partition the headline exactly;
- coverage is monotonic (denominator ≤ read ≤ scanned ≤ sampled);
- no experimental-tier finding leaked into the default set;
- a stratum is only marked incomplete when it genuinely exceeded the 1000-result
  cap, rather than because a request quietly returned nothing.

Run it with `npm run census:verify` from the repository root, or `node verify.mjs`
from this directory.

## 5. What this does not measure

- It is a **snapshot**, not a diff. On a pull request CrossCheck reports only
  what a change *introduces*; a census cannot distinguish new from long-standing
  contradictions.
- A contradiction is **not automatically a broken build**. Two lockfiles can sit
  in a repository for a long time without failing CI. The census reports
  configuration state, and reports install-step evidence separately where the
  repository's own CI cites a manager.
- The frame is **active, ≥20-star public repositories**. It says nothing about
  private repositories, abandoned ones, or the long tail below 20 stars.
- Association is **not causation**. The agent-instruction-file comparison is
  observational and confounded by repository age, size and activity.

## 6. Reproducing it

```sh
node frame.mjs            # rebuild the frame (slow; hits the Search API)
node recover-strata.mjs   # re-enumerate any incomplete stratum
SEED=20260921 TARGET=6000 node sample.mjs
node collect.mjs          # or run shards: SHARD=i SHARDS=n
node analyze.mjs          # regenerates data/report.json and data/findings.jsonl
node verify-provider.mjs <owner/repo>...   # the equivalence check
```

To check a single published finding you do not need to run anything:
`data/findings.jsonl` gives the repository, the frozen commit SHA, and a
permalink to every cited line.
