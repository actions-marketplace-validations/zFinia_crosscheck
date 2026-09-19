# Repository Decision Contracts

A CrossCheck contract is the repository's explicit, reviewable memory of engineering decisions. Its canonical path is `.crosscheck/contract.json`. CrossCheck reads it locally and deterministically; it does not call an LLM, install repository dependencies, upload files, or make network requests while scanning.

## Create a contract

```sh
npx @zfinia/crosscheck contract init
```

Initialization writes only high-confidence established package-manager and Node-major decisions. ORM, database, and authentication observations remain suggestions until a human confirms them:

```sh
npx @zfinia/crosscheck contract suggest
```

The schema is [`crosscheck-contract-v1.schema.json`](crosscheck-contract-v1.schema.json). Version 1 supports exact scopes and these keys:

- `package.manager`
- `runtime.node`
- `database.orm`
- `database.engine`
- `auth.provider`

Each decision has a non-empty `allowed` list. `scope` defaults to `.`, `enforcement` defaults to `warn`, and supported enforcement levels are `block`, `warn`, and `off`. Invalid contracts fail closed. A `block` decision is block-capable only in an authorized managed Action; the community CLI presents contract enforcement as a local preview.

Strong conflicting evidence produces `contract/violation`. Weak conflicting evidence produces the always-advisory `contract/possible-violation`. If no strong evidence confirms or contradicts a decision, CrossCheck reports the always-advisory `contract/unverified` rather than treating missing evidence as failure.

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

Scopes are exact in v1. A decision for `apps/web` does not apply to `services/api` and a root decision does not implicitly inherit into nested packages.

## Agent context

```sh
npx @zfinia/crosscheck context
npx @zfinia/crosscheck context --format json
npx @zfinia/crosscheck context --write
```

`--write` creates `.crosscheck/AGENT_CONTEXT.md` without timestamps. The generated Markdown is useful to humans and coding agents, but it is never policy authority; the JSON contract remains authoritative.

## Pull-request authority and migrations

The base-branch contract is authoritative during a pull request. Editing the contract in the same pull request cannot authorize a violation. Changing an established allowed value, weakening enforcement, removing a decision, or deleting the contract requires explicit approval.

For a deliberate migration such as pnpm to npm:

1. update repository configuration and remove pnpm state;
2. update the contract from `pnpm` to `npm` in the same pull request;
3. have a maintainer apply the `crosscheck:decision-change` label, or set Action input `allow-contract-change: true`.

Approval permits only the proposed migration. If the resulting repository still contains both npm and pnpm state, the migration fails. Initial adoption of a valid contract does not need the label, but the new contract must match the repository state.

## Precision boundary

Generic proven rules keep their existing precision requirements. Generic ORM, database, auth, install-command, and agent-instruction rules remain experimental and cannot fail a build. An explicit contract may enforce those decisions because the repository owner—not CrossCheck's heuristic—declared the policy.
