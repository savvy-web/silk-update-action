---
type: Limitation
title: Yarn is detected and then rejected, not supported
description: detectPackageManager fails InvalidInputError inside the check run when the workspace is yarn — nothing downstream is wired or tested for it.
status: draft
tags:
  - compat
bounds: ../modules/silk-update-action.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 9abd1da0ecfaf391b13e6eac9905d1755cbe40cfe10e8c6e364544d1a6c45c2b
sources:
  - id: package-manager-service
    resource: ../../src/services/package-manager.ts
---

# Yarn is detected and then rejected, not supported

## Condition

`detectPackageManager` delegates detection to `@effected/workspaces`'
`PackageManagerDetector`, which recognizes yarn like any other manager. The
moment `detected.name === "yarn"`, the function fails rather than returning a
`DetectedPm`.[^package-manager-service]

## Symptom

The run fails with `InvalidInputError` (`field: "workspace"`, reason
`"Detected yarn, which this action does not support. Supported: pnpm, bun,
npm."`), raised **inside** the check run rather than as an invisible early
exit — so a yarn workspace gets a visible, named failure in the GitHub UI
rather than a silent no-op.[^package-manager-service]

## Why acceptable

Detection is not the same work as support: config dependencies, install, and
the package-manager self-upgrade dispatch on `SupportedPm` (`"pnpm" | "bun" |
"npm"`), and none of those three paths has ever been wired or tested against
yarn's lockfile format, its `resolutions` field, or its own config-dependency
equivalent (if any). Accepting a yarn workspace and dispatching it through any
of those paths would silently do the wrong thing rather than fail loudly, and
a loud, early, named failure is the safer default for an action that commits
and opens a PR on a consumer's behalf.

## What a fix would take

Adding yarn as a fourth `SupportedPm` member would require wiring and testing
the same three dispatch points every other manager gets: a config-dependency
workflow (yarn has no pnpm-style `configDependencies`, so this would likely
mean reproducing the bun catalog-merge shape against whatever yarn mechanism
is closest), an install/lockfile-regeneration path, and a self-upgrade write
format. Detection already recognizes yarn; the gap is entirely downstream.

[^package-manager-service]: `src/services/package-manager.ts`
