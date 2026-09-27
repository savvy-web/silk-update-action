---
type: Decision
title: Write package-manager and config-dependency pins bare; the lockfile holds integrity
description: The action writes packageManager, devEngines.packageManager.version and configDependencies entries with no +<integrity> suffix, strips an existing suffix whenever it touches one, and keeps the registry integrity in memory only to verify the package-manager download at activation.
status: draft
tags:
  - deps
  - compat
sources:
  - id: issue-494
    resource: "https://github.com/savvy-web/silk-update-action/issues/494"
  - id: package-manager-upgrade
    resource: ../../src/services/package-manager-upgrade.ts
  - id: config-deps
    resource: ../../src/services/config-deps.ts
  - id: activate-step
    resource: ../../src/steps/activate-package-manager.ts
  - id: upgrade-step
    resource: ../../src/steps/upgrade-package-manager.ts
generated:
  by: okfit/claude-code
  at: 2026-09-27T05:00:59Z
  body_sha256: 5aa0607f58add6b02a65e510ff9ca6448fde59940cc6e4d5969d41edd20e51ed
---

# Write package-manager and config-dependency pins bare; the lockfile holds integrity

## Context

The action used to write an inline integrity suffix in two places: pnpm and
npm upgrades went into `packageManager` and `devEngines.packageManager.version`
as `<version>+sha512.<hex>`, and config-dependency bumps went into
`pnpm-workspace.yaml` as `<version>+sha512-<base64>`.[^issue-494] Issue #494
records that, against pnpm 12.5.0 and 12.6.0, pnpm does not verify the
`devEngines` hash, drops both suffixes on its own next write (`pnpm
self-update`, `pnpm add --config`), and keeps integrity in the lockfile
instead — `packageManagerDependencies` for the manager, a dedicated section for
config dependencies. Corepack, the one tool that verified the `packageManager`
hash, is no longer on the runners. The suffix was churn against every local
`pnpm self-update` and suggested a verification that did not happen.

## Decision

- `packageManager` is written `<pm>@<version>` for every supported manager,
  npm included.[^package-manager-upgrade]
- `devEngines.packageManager.version` is written as the bare version with the
  repo's own leading `^` or `~` kept (`^12.6.0` becomes `^12.7.0`), matching
  `pnpm self-update`. A range that is not a lone operator over a version
  (`>=11 <12`) is not a reference and is not rewritten.
- `configDependencies` entries are written bare, parsed through
  `@effected/workspaces`' `ConfigDependencySpec`; an entry that does not parse
  is warned about and skipped.[^config-deps]
- An existing suffix is stripped whenever the action touches the field,
  including when no version moves. That is a normalization: the package-manager
  outcome reports it as `normalized` on an `already-current` skip, and neither
  path adds an entry to `updates`, so the `result` output schema is
  unchanged.[^upgrade-step]
- The registry `dist.integrity` for a new pnpm or npm version is still read,
  converted with `CorepackIntegrityHash.fromSri`, carried on the applied
  outcome as `integrity`, and handed to `PackageManagerInstaller.install` as
  its `integrity` option. It is never written to disk. When it cannot be
  derived, activation installs without it and the installer
  warns.[^activate-step] bun gets none, because its installer verifies a
  platform zip rather than the npm tarball.

## Consequences

- The lockfile refresh is the only place checksums are recorded, which is
  pnpm's model.
- A repository that still carries a suffix gets one normalization pull request
  with no dependency updates in it, titled with the generic
  `chore(deps): update dependencies` subject, the first time the action runs
  with the field enabled.
- The runtime action is the one consumer that read the inline hash; it has to
  read integrity from the lockfile (savvy-web/silk-runtime-action#436) or it
  warns that the artifact was not verified.

[^issue-494]: <https://github.com/savvy-web/silk-update-action/issues/494>
[^package-manager-upgrade]: `src/services/package-manager-upgrade.ts`
[^config-deps]: `src/services/config-deps.ts`
[^upgrade-step]: `src/steps/upgrade-package-manager.ts`
[^activate-step]: `src/steps/activate-package-manager.ts`
