---
type: Interface
title: Action inputs
description: The workflow-facing input contract — names, grammars, defaults, and what readInputs validates before any step runs.
kind: config
resource: ../../action.yml
status: draft
tags:
  - ci
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: fd513cf7ad0e383e06056a9fff03cced8a567781123316eb0db16d9dccc07d99
sources:
  - id: action-yml
    resource: ../../action.yml
  - id: inputs-ts
    resource: ../../src/schema/inputs.ts
---

# Action inputs

## Contract

`action.yml` is the single source of input names and defaults.[^action-yml]
`src/schema/inputs.ts` mirrors the declared names as the `INPUT_NAMES` tuple
and a test compares the mirror against the manifest, so the two cannot
silently disagree.[^inputs-ts] Every input is read through `ActionInput`
(`ActionInput.string` / `.boolean` / `.integer` / `.list`), never bare
`Config` — `Config.string("dependencies")` resolves nothing under the
runner's `INPUT_*` environment and silently takes its default, which is the
regression this contract exists to prevent.[^inputs-ts]

All validation happens once, in `readInputs`, before any step runs — a
malformed input fails the check run rather than surfacing mid-way through a
partially-applied update.[^inputs-ts]

## Inputs

| Input | Grammar | Default | Validation |
| --- | --- | --- | --- |
| `app-client-id`, `app-private-key` | opaque | required, no default | consumed only by `pre` for token provisioning, not by `readInputs` |
| `branch` | string | `pnpm/config-deps` | — |
| `source-branch` | string (ref) | `main` | the ref the update branch is cut from and reset to |
| `target-branch` | string (ref) or empty | `""` | empty means "follow `source-branch`", resolved by `resolveTargetBranch`; the PR's merge base |
| `config-dependencies`, `dependencies`, `peer-lock`, `peer-minor`, `run` | multi-value list (newline `-`/`*` bullets, `#` comments dropped, JSON array, or comma-separated) | `""` → `[]` | `ActionInput.list` fails on an absent **or** empty input, so `Config.withDefault([])` on each read is load-bearing |
| `upgrade-package-manager` | `false` \| `true` \| `auto` \| a semver range | `"false"` | opt-in, matching the `upgrade-runtime-*` inputs; a non-keyword value must parse as a `Range` |
| `upgrade-runtime-node`, `upgrade-runtime-deno`, `upgrade-runtime-bun` | `false` \| `auto` \| a semver range | `"false"` | same keyword-or-range check as above |
| `runtime-data` | `offline` \| `live` | `offline` | **fails**, rather than warning and falling back, on any other value — silently resolving from the bundled snapshot when a workflow asked for live data is the same class of quiet wrong answer as an input that never arrived |
| `dry-run` | boolean | `"false"` | — |
| `changesets` | boolean | `"true"` | — |
| `timeout` | integer (seconds) | `"180"` | bounds how long `main` may run before `Effect.timeoutOrElse` fails it |
| `auto-merge` | `""` \| `merge` \| `squash` \| `rebase` | `""` | validated against this exact union and typed, not cast, so a typo fails here rather than reaching the GraphQL mutation as an invalid enum |
| `check-peers` | `false` \| `warn` \| `no-auto-merge` | **derived**, not static (see below) | `fail` is deliberately not a value — it would need a second, concurrent check run |

[^action-yml]: `../../action.yml`
[^inputs-ts]: `../../src/schema/inputs.ts:1-45`, `:90-104`

## `check-peers`'s derived default

Left unset, `check-peers` resolves to `no-auto-merge` when `auto-merge` is
enabled and to `false` when it is not — so a repository that never enables
auto-merge pays nothing (no config-dependency hook replay), and one that does
is protected without an explicit opt-in. An explicit value always wins,
including an explicit `false` on a repo that does auto-merge.[^inputs-ts]
Setting `check-peers: no-auto-merge` on a repo where `auto-merge` is `""` is
accepted but logs a warning, because it is a gate that can never fire, not a
misconfiguration — `auto-merge` is legitimately dynamic in a workflow
expression, so failing here would break a valid workflow that simply
resolved it to empty this run.[^inputs-ts]

## Cross-input validation

- **At least one update type must be active.** `config-dependencies` and
  `dependencies` empty, `upgrade-package-manager: false`, and every
  `upgrade-runtime-*: false` together fail input validation — since
  `upgrade-package-manager` defaults to `"false"`, a workflow that configures
  nothing now fails this check rather than silently performing a
  package-manager-only run.[^inputs-ts]
- **`peer-lock` and `peer-minor` reject glob characters** (`*?[]`) before the
  overlap check runs, and each is validated against its own field name — a
  glob typed into one used to be reported against the other, sending the
  reader to an input that was fine.[^inputs-ts]
- **`peer-lock` and `peer-minor` must not overlap** (the same package name in
  both).[^inputs-ts]
- **A `peer-lock`/`peer-minor` entry matching no `dependencies` pattern
  warns**, since `peer-lock`/`peer-minor` are exact-name matches while
  `dependencies` entries are globs, and the sync is a no-op for an unmatched
  name.[^inputs-ts]
