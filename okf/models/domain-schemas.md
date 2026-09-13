---
type: DataModel
title: Domain schemas
description: The Effect Schema structs the run's results are built from, and what depends on each one being right.
resource: ../../src/schema/domain.ts
status: draft
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 468d1a8bc02562baf660f6a0699abee877ca7b012ed1417284a64bdb534906bb
sources:
  - id: domain-ts
    resource: ../../src/schema/domain.ts
  - id: package-manager-upgrade-ts
    resource: ../../src/services/package-manager-upgrade.ts
  - id: catalogs-ts
    resource: ../../src/utils/catalogs.ts
---

# Domain schemas

`src/schema/domain.ts` defines the `Schema.Struct`s every domain service
produces. Each derives its TypeScript type via `typeof Schema.Type`, so the
type and the validator cannot drift apart, and `RunResultDocument` (the
`result` output — see [Action outputs](../interfaces/action-outputs.md))
composes these same structs rather than restating them in a parallel
reporting shape.[^domain-ts]

## `DependencyType` — the shared discriminator

A closed literal union: `config`, `dependency`, `devDependency`,
`peerDependency`, `optionalDependency`, `runtime`, `packageManager`.[^domain-ts]
`config` tags only pnpm's `configDependencies`; `packageManager` tags the
package-manager self-upgrade. The two used to be conflated — the
self-upgrade was tagged `config` and matched by the literal dependency name
`"pnpm"` — which mislabelled the row in a consumer's PR (claiming pnpm was a
config dependency) and silently missed both bun and npm, since the name
match could never fire for them.[^domain-ts] `DependencyType` must also be a
subset of `@savvy-web/silk-effects`' `DependencyTableType`, or a row this
action emits fails changeset validation downstream, in the consumer's
repository rather than here — that subset relation is asserted at compile
time rather than copied as a literal list, because a copy goes stale
silently while an assertion fails the build.[^domain-ts]

Every schema shared across more than one struct field (`DependencyType`,
`PeerIssue`, and every other struct listed below) carries an explicit
`identifier` annotation, for the reason given in
[Action outputs](../interfaces/action-outputs.md#the-generated-json-schema-is-closed-on-purpose).

## What each struct holds, and what reads it

| Struct | Holds | Consumed by |
| --- | --- | --- |
| `DependencyUpdateResult` | one `(dependency, from, to, type, package)` per (path, dependency, section) update | `RunResultDocument.updates`, the commit message, the PR body |
| `CatalogDelta` | one bun-catalog merge outcome: `(catalog, dependency, from, to, action)` where `action` is `added`\|`updated`\|`removed`\|`kept` | `RunResultDocument.catalogDeltas`, the PR's Catalog Changes table |
| `PeerIssue` | one unsatisfied peer: `(importer, dependency, wanted, found, optional, parents)` | `RunResultDocument.peerIssues`, the peer-check gate, the PR body |
| `LockfileChange` | one `(catalog change, importer, dep section)` triple from before/after lockfile comparison | `RunResultDocument.lockfileChanges` |
| `ChangesetFile` | one `(id, packages, type, summary)` changeset written by the changeset step | `RunResultDocument.changesets` |
| `PullRequestResult` | `(number, url, created, nodeId)` | `RunResultDocument.pullRequest` |
| `BranchResult` | `(branch, created, upToDate, baseRef)` | branch-management logging |

[^domain-ts]: `../../src/schema/domain.ts`

## What breaks if a field is wrong

- **`PeerIssue.found: null` IS the "missing" case** — there is deliberately
  no separate boolean discriminant, because a second field encoding the same
  fact could contradict the first, and a consumer would have no way to know
  which to trust. Rendering code must never print the raw `null` into
  someone else's pull request; that is pinned by a test asserting the PR
  body never contains a literal `null`.[^domain-ts]
- **`PeerIssue.parents` names a route, not the set of routes.** Where an
  importer reaches one declaring package by two different chains, the
  upstream peer-checker reports the peer once, carrying one chain — matched
  deliberately rather than accidentally. A reader must not infer the
  displayed chain is the only one; a second route existing is not a missing
  row.[^domain-ts]
- **`PullRequestResult.number` is `Schema.Int`, not `Schema.Number`.** The
  ajv strict gate forced this, and it was right: `Schema.Number` lowers to
  an `anyOf` that models `NaN`/`Infinity` as strings, so the `> 0`
  refinement landed in a typeless `allOf` branch — the schema was modelling
  a PR number as possibly `NaN`.[^domain-ts]
- **`packageManager: null` (on `RunResultDocument`) is absence, not a
  placeholder.** See [Action outputs](../interfaces/action-outputs.md).

## Package-manager upgrade outcome

Not an Effect Schema (it is a plain discriminated union in
`src/services/package-manager-upgrade.ts`), but the same "what depends on
this" logic applies: `upgrade()` never returns `null`, always an outcome, so
a caller can report *why* nothing happened rather than only *that* nothing
happened.[^package-manager-upgrade-ts]

- `PackageManagerUpgradeApplied` — `{ applied: true, pm, reference,
  referenceSource, targetRange, from, to, packageManagerUpdated,
  devEnginesUpdated, added }`.
- `PackageManagerUpgradeSkipped` — `{ applied: false, pm, reference,
  referenceSource, targetRange, kind, reason }`, where `kind` is
  `disabled` \| `no-reference` \| `unsatisfiable` \| `already-current` \|
  `error`.

`kind` is the machine-readable discriminant a caller dispatches on;
`reason` is prose for a human and must never be parsed. `unsatisfiable` is
the one skip kind logged at warning rather than info, because it almost
always means the configured range was typed for a *different* package
manager than the one this run detected (a pnpm `^11.0.0` range copy-pasted
into a bun repo correctly satisfies nothing against bun's release
list).[^package-manager-upgrade-ts]

## Catalog map (bun compat mode)

`CatalogMap` in `src/utils/catalogs.ts` is a plain
`Record<string, Record<string, string>>` — catalog name to (dependency to
specifier), with the default catalog keyed `""`. It is not an Effect Schema;
it is read from and written to `package.json`'s top-level `catalog` /
`catalogs` fields directly.[^catalogs-ts] `CatalogDelta` above is the
Schema-backed record of what a merge into this map did.

[^package-manager-upgrade-ts]: `../../src/services/package-manager-upgrade.ts`
[^catalogs-ts]: `../../src/utils/catalogs.ts`
