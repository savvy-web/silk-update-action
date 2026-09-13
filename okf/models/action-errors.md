---
type: DataModel
title: Action error union
description: The four typed errors this action raises, where each is constructed, and the test that pins the exported set to exactly those four.
resource: ../../src/errors/errors.ts
status: draft
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 60e862747e2a208a9ba7221d5dc3c1df9f49e17cccd388c1efa1f78ee4c1dc8b
sources:
  - id: errors-ts
    resource: ../../src/errors/errors.ts
  - id: errors-test
    resource: ../../__test__/unit/errors/errors.test.ts
---

# Action error union

## The four live classes

`src/errors/errors.ts` declares `ActionError` as the union of exactly four
`Schema.TaggedError` classes.[^errors-ts]

| Class | Fields | Constructed in |
| --- | --- | --- |
| `InvalidInputError` | `field`, `value` (unknown), `reason` | `src/schema/inputs.ts` (input validation), `src/services/branch.ts` (branch-ref preflight), `src/services/package-manager.ts` (yarn / no-workspace rejection) |
| `ChangesetError` | `reason`, `packages?` | `src/services/changesets.ts` (the `DepsRegen` adapter's error mapping) |
| `FileSystemError` | `operation` (read\|write\|delete\|exists), `path`, `reason` | `src/services/peer-sync.ts`, `runtime-upgrade.ts`, `config-deps.ts`, `package-manager-upgrade.ts`, `workspace-yaml.ts`, `catalog-config-deps.ts`, `regular-deps.ts` — every manifest/YAML read-write path |
| `LockfileError` | `operation` (read\|parse\|compare), `reason` | `src/services/lockfile.ts` |

Each carries a `message` getter that renders its fields into one sentence
(e.g. `Invalid input for "field": reason`), and `getErrorMessage(error)` is
the single exported helper over the union.[^errors-ts]

## Every member is raised somewhere; nothing else is exported

`__test__/unit/errors/errors.test.ts` asserts the exported error-class
surface is exactly `["ChangesetError", "FileSystemError",
"InvalidInputError", "LockfileError"]`, sorted.[^errors-test] That test
exists because four other classes — `GitHubApiError`, `GitError`,
`PnpmError`, `DependencyUpdateFailures` — used to sit in this file with no
construction site anywhere in `src/`; the only code that ever built one was
the test suite asserting on their retry predicates, so those tests passed
precisely because they were the sole callers. `isRetryableError`, which
dispatched only on those three tags, went with them for the same
reason.[^errors-ts] See
[No export without a construction site](../conventions/no-export-without-construction-site.md).

## What arrives from elsewhere

Errors this action does not define itself arrive as kit types rather than
local wrappers: every GitHub API failure is `@effected/github`'s single
`GitHubError` (discriminated with `hasKind` rather than a per-service error
class), and every subprocess failure is `@effected/commands`'
`CommandFailedError` / `CommandOutputError`. A `ConfigError` from core
`effect` surfaces for a malformed or absent `ActionInput` read. None of
these three families is re-wrapped into `ActionError` — a step's declared
error channel names them directly alongside the local members it can
raise.[^errors-ts]

## What breaks if a class is re-added without a caller

Re-adding an error class to this file without also giving it a construction
site in `src/` reintroduces exactly the state the deletion fixed: a type the
compiler carries indefinitely and no test can falsify, because the class's
own test suite would again be its only caller. The pinned-exports test
fails immediately on the class name; it does not fail on the *absence* of a
construction site, so adding both the class and a self-referential test
together would still pass — the discipline is call-site hygiene, not
something this test alone can enforce.

[^errors-ts]: `../../src/errors/errors.ts`
[^errors-test]: `../../__test__/unit/errors/errors.test.ts`
