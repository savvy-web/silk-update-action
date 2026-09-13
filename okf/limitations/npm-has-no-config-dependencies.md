---
type: Limitation
title: npm has nothing to reproduce pnpm's config dependencies with
description: Under npm, config-dependencies is skipped with a warning rather than applied — npm implements no catalog protocol for the action to hook into or reproduce.
status: draft
tags:
  - compat
bounds: ../decisions/detect-package-manager-once.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: a8b0ad003a6651b16d7589ec02f752d384ea5bc365fa52890ce2a6d747b47ed9
sources:
  - id: config-dependencies-step
    resource: ../../src/steps/config-dependencies.ts
  - id: regular-dependencies-step
    resource: ../../src/steps/regular-dependencies.ts
---

# npm has nothing to reproduce pnpm's config dependencies with

## Condition

`configDependenciesStep` dispatches on the detected package manager. pnpm
edits `pnpm-workspace.yaml` in place; bun reproduces the workflow by merging
the config dependency's `catalogs` export into `package.json`. The `npm`
branch does neither — it is a dead end by design, because npm implements no
`catalog:` protocol at all, so there is nothing for this action to hook into
or reproduce.[^config-dependencies-step]

## Symptom

When `config-dependencies` names one or more packages under npm, the step
logs a warning naming how many were requested and skips every one of them,
rather than silently ignoring the input: `"Skipping N config dependencies:
npm does not implement the catalog: protocol. Config dependencies are
supported for pnpm (pnpm-workspace.yaml) and bun (package.json
catalogs)."`[^config-dependencies-step] No manifest or lockfile write happens
for those names on the config-dependency path.

A related asymmetry sits in `regularDependenciesStep`: under bun, a name
matching `configDependencies` is excluded from the regular-dependencies pass
because the bun path already owns and bumps that manifest range. Under npm
that exclusion is **not** applied, deliberately — since nothing on the
config-dependency path ever touches npm's `package.json`, excluding those
names from the regular pass would instead freeze the range of any package
that is both a declared config dependency and an ordinary
devDependency, forever.[^regular-dependencies-step]

## Why acceptable

There is no npm equivalent of a pnpm config dependency or a bun catalog to
merge into — the mechanism itself does not exist on this package manager, so
"support" is not a smaller version of the same feature, it is a feature with
no target. A named non-goal, not an oversight: reproducing config
dependencies for npm would mean inventing a mechanism npm has no concept of,
rather than adapting an existing one the way the bun path adapts catalogs.

## What a fix would take

There is nothing to build against today. A fix would require npm itself
shipping some pre-resolution, centrally-pinned dependency mechanism this
action could target — at which point the bun path (an ordinary dependency
whose exported table is merged via `CatalogConfigDeps`) is the closer
precedent to follow than the pnpm path (native `pnpm-workspace.yaml`
editing).

[^config-dependencies-step]: `src/steps/config-dependencies.ts`
[^regular-dependencies-step]: `src/steps/regular-dependencies.ts`
