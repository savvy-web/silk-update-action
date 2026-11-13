---
type: Limitation
title: Yarn is refused at detection, not supported
description: The kit's PackageManagerDetector refuses a yarn root with UnsupportedPackageManagerError, which detectPackageManager maps to InvalidInputError inside the check run.
status: draft
tags:
  - compat
bounds: ../modules/silk-update-action.md
generated:
  by: okfit/claude-code
  at: 2026-11-13T19:00:36Z
sources:
  - id: package-manager-service
    resource: ../../src/services/package-manager.ts
integrity:
  generated:
    body: 9e1a83d79362cd51
---

# Yarn is refused at detection, not supported

## Condition

`detectPackageManager` delegates detection to `@effected/workspaces`'
`PackageManagerDetector`. From `@effected/workspaces` 0.48.0 the kit no longer
models yarn: `PackageManagerName` is `"npm" | "pnpm" | "bun"`, and a root whose
`yarn.lock`, `packageManager` or `devEngines.packageManager` names yarn fails
detection with `UnsupportedPackageManagerError` (carrying `root`, `manager` and
`evidence`) instead of returning a result. `detectPackageManager` catches that
tag and fails rather than returning a `DetectedPm`.[^package-manager-service]
A root whose only yarn signal is an undeclared `yarn.lock` is refused too; it
used to fall back to npm.

## Symptom

The run fails with `InvalidInputError` (`field: "workspace"`, reason
`"Detected yarn (from <evidence>), which this action does not support.
Supported: pnpm, bun, npm."`, where `<evidence>` is the marker the kit
reported), raised **inside** the check run rather than as an invisible early
exit — so a yarn workspace gets a visible, named failure in the GitHub UI
rather than a silent no-op.[^package-manager-service]

## Why acceptable

The kit this action is built on dropped yarn across `@effected/workspaces`,
`@effected/lockfiles`, `@effected/commands`, `@effected/npm` and
`@effected/github-actions` (lockfile parsing, launchers and provisioning), so
there is no layer underneath to dispatch a yarn workspace onto. Independently, config dependencies, install, and
the package-manager self-upgrade dispatch on `SupportedPm` (`"pnpm" | "bun" |
"npm"`), and none of those three paths has ever been wired or tested against
yarn's lockfile format, its `resolutions` field, or its own config-dependency
equivalent (if any). Accepting a yarn workspace and dispatching it through any
of those paths would silently do the wrong thing rather than fail loudly, and
a loud, early, named failure is the safer default for an action that commits
and opens a PR on a consumer's behalf.

## What a fix would take

The kit would have to model yarn again first: detection, lockfile parsing,
launchers and provisioning all refuse it upstream. Only then would adding yarn
as a fourth `SupportedPm` member be possible here, and it would require wiring
and testing the same three dispatch points every other manager gets: a config-dependency
workflow (yarn has no pnpm-style `configDependencies`, so this would likely
mean reproducing the bun catalog-merge shape against whatever yarn mechanism
is closest), an install/lockfile-regeneration path, and a self-upgrade write
format.

[^package-manager-service]: `src/services/package-manager.ts`
