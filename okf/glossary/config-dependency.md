---
type: Glossary
title: config dependency
description: pnpm's configDependencies mechanism, and this action's own reproduction of the workflow for bun; not the same thing this repository consumes to get its own @effected ranges.
status: draft
tags:
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-27T05:00:59Z
  body_sha256: 6726b8103e8066b3c7ca8e9ab699eda0672c92b77b7aaccaa5a82df85b89f175
sources:
  - id: config-deps-service
    resource: ../../src/services/config-deps.ts
  - id: catalog-config-deps-service
    resource: ../../src/services/catalog-config-deps.ts
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
---

# config dependency

**pnpm's own sense:** an entry in `pnpm-workspace.yaml`'s `configDependencies`
block — a package pinned to an exact version (its integrity recorded in the
lockfile; the inline `<version>+<integrity>` form is deprecated, and this
action writes the bare form) and loaded *before* the workspace resolves at
all, ahead of every ordinary dependency, able to inject catalogs, hooks
(`updateConfig`, `updateLock`, ...) and `peerDependencyRules` into the
resolution this action then reads back.[^pnpm-workspace]

**This action's use of the term** covers two distinct things, and the naming
overlap is worth keeping visible:

1. **The `config-dependencies` action input and its target.** Under pnpm,
   `ConfigDeps` edits `pnpm-workspace.yaml`'s `configDependencies` block
   directly, using pnpm's own mechanism.[^config-deps-service] Under bun,
   which has no such mechanism, `CatalogConfigDeps` *reproduces the workflow*:
   the named package is an ordinary root dependency, and its `catalogs` export
   is merged into `package.json`'s top-level `catalog`/`catalogs` fields via a
   three-way merge.[^catalog-config-deps-service] Under npm, there is nothing
   to reproduce — see
   [npm has nothing to reproduce config dependencies with](../limitations/npm-has-no-config-dependencies.md).
2. **This repository's own `@effected/*` ranges**, which arrive through
   exactly the pnpm mechanism in sense (1) — `@effected/pnpm-plugin-effect`
   is itself a config dependency pinned in this repository's own
   `pnpm-workspace.yaml`. See
   [kit ranges come from a config dependency](../gotchas/kit-ranges-come-from-a-config-dependency.md)
   for the consequence: bumping a kit package here is a `configDependencies`
   pin edit, not a `package.json` edit.

Reading "config dependency" as only sense (1) — a thing this action *acts
on* — misses that this action is itself a consumer of the same mechanism for
its own dependencies.

[^pnpm-workspace]: `pnpm-workspace.yaml`
[^config-deps-service]: `src/services/config-deps.ts`
[^catalog-config-deps-service]: `src/services/catalog-config-deps.ts`
