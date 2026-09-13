---
type: Decision
title: Detect the package manager once, and dispatch every step on it
description: The workspace root and package manager are resolved a single time per run; every later dispatch point reads that one value instead of re-detecting.
status: draft
tags:
  - architecture
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: c719c94c4ee55bd64d9ea9dcc0f1be782eab424cf7e9eab6abd301faa6403616
sources:
  - id: package-manager-service
    resource: ../../src/services/package-manager.ts
  - id: detect-step
    resource: ../../src/steps/detect-package-manager.ts
  - id: config-deps-step
    resource: ../../src/steps/config-dependencies.ts
---

# Detect the package manager once, and dispatch every step on it

## Context

This action supports pnpm, bun and npm, and several steps behave differently
per manager: config dependencies (pnpm edits `pnpm-workspace.yaml`, bun merges
`catalogs` into `package.json`, npm has nothing to reproduce and is skipped),
install, the package-manager self-upgrade, and pnpm-only workspace-YAML
formatting. Detection itself is not free — it reads `devEngines.packageManager`
and falls back to lockfile and config-file presence — and re-running it at each
dispatch point risks two of those reads disagreeing mid-run.

## Decision

`detectPackageManager` (`src/services/package-manager.ts`) resolves the
workspace root and the package manager exactly once, inside the check run, and
returns a `DetectedPm` (`pm`, `version`, `root`, `evidence`).[^package-manager-service]
`detectPackageManagerStep` (`src/steps/detect-package-manager.ts`) wraps it and
adds a best-effort package count for the run-context log line, catching a
discovery failure to `null` rather than letting a cosmetic lookup fail the
run.[^detect-step] Every later dispatch point — config dependencies, install,
the package-manager upgrade, workspace-YAML formatting — reads this one
`DetectedPm` value, and every step reads and writes at `detected.root` rather
than `process.cwd()`, since the action can legitimately be invoked from a
subdirectory of the workspace.

Detection delegates to `@effected/workspaces`' `PackageManagerDetector`, which
is also what `LockfileReader` and the changesets machinery consult internally
— so the manager this action dispatches on is always the one those libraries
parse for.[^package-manager-service] `WorkspaceRoot.find` and `PackageManagerDetector.detect`
share the same marker checks (`pnpm-workspace.yaml`, `package.json`'s
`workspaces` field), so a `WorkspaceRootNotFoundError` and a
`PackageManagerDetectionError` are mapped to this action's own
`InvalidInputError` through one shared handler rather than two.[^package-manager-service]

Yarn is detected upstream and explicitly rejected here with
`InvalidInputError`: nothing in the config-dependency, install or upgrade
paths is wired or tested for it.[^package-manager-service] See
[yarn is rejected](../limitations/yarn-is-rejected.md) and
[npm has no config dependencies](../limitations/npm-has-no-config-dependencies.md).

`DetectedPm.evidence` is the detector's own marker for which signal decided
the result, forwarded verbatim rather than re-derived — the step used to guess
this for its log line with a local re-implementation of the priority order,
which could disagree with the detector whenever the real rule was a
conjunction (a stray lockfile plus a manifest field).[^package-manager-service][^detect-step]

Detection and every dispatch point run **inside** the check run
(`CheckRun.withCheckRun`), so an unsupported workspace fails with a visible
check run in the GitHub UI rather than an invisible early exit before any
check run exists.[^detect-step]

## Alternatives rejected

- **Re-detect at each dispatch point.** Rejected because two reads of
  `devEngines.packageManager` / the lockfile at different points in a run that
  itself edits those files could disagree, and because it duplicates the same
  filesystem walk for no benefit.
- **Re-derive `evidence` locally for logging** rather than forwarding the
  detector's own answer. Rejected once it was shown to disagree with the
  detector on a conjunction case — a log line describing detection incorrectly
  is worse than no log line.
- **Default the workspace root to `process.cwd()`** at dispatch points.
  Rejected: the action can be invoked from a subdirectory, and a default reads
  a different tree silently rather than failing loudly.

## Consequences

- Every step that behaves differently per manager has one place to look for
  the answer (`detected.pm`), rather than re-implementing detection logic.
- A yarn workspace or a workspace with no discoverable root fails once, early,
  inside the check run, rather than failing unpredictably at whichever step
  first assumed a different manager.
- `PackageManagerDetector`'s own rules (lockfile conjoined with manifest, not
  `devEngines.packageManager` alone) become this action's rules by
  construction — a change in the kit's detection heuristic changes this
  action's behavior without a local code change.

## What would change the answer

Support for a package manager not covered by `SupportedPm` (`pnpm` | `bun` |
`npm`) would need detection, config-dependency, install and upgrade support
added together — the whole point of centralizing detection is that all four
paths agree on one value, so adding a manager to only one of them would
reintroduce the disagreement this decision exists to prevent.

[^package-manager-service]: `../../src/services/package-manager.ts`
[^detect-step]: `../../src/steps/detect-package-manager.ts`
