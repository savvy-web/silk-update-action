---
type: Glossary
title: kept (catalog delta)
description: A CatalogDelta action of "kept" means exactly one thing — a user override or addition survived the three-way catalog merge. An entry that is ours and did not move produces no delta at all.
status: draft
tags:
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 46f4e7d70967ce521e45b711b0e10a07b9484fd90ca42febcf0f467680e0ba79
sources:
  - id: catalogs-utils
    resource: ../../src/utils/catalogs.ts
---

# kept (catalog delta)

Under bun, `CatalogConfigDeps`' three-way merge (`threeWayMergeCatalogs`)
classifies every catalog entry it touches into one `CatalogDelta` action:
`added`, `updated`, `removed`, or `kept`.[^catalogs-utils] `kept` is the
narrowest of the four and carries exactly one meaning: the on-disk entry
**diverged from what the previously-installed version's catalogs shipped**,
which is this merge's signal that the entry is a deliberate user override or
addition rather than something the action itself wrote on a prior
run.[^catalogs-utils]

The term earns a glossary entry, rather than reading as ordinary English, on
one specific trap: an entry that *is* the action's own and simply did not
move this run produces **no delta at all** — not a `kept` one. If `kept`
meant "unchanged," a truly-ours, unmoved entry and a user's untouched
override would be indistinguishable in the reported deltas, which would make
`kept` useless as the discriminator it exists to be. See
[the kept delta as decision evidence](../decisions/catalog-base-routing.md)
for how this distinction was nearly lost in review: an early version of the
empty-base merge test asserted only that a surviving override was *absent*
from the deltas, which does not discriminate `kept` from a plugin-wins route
overwriting the same entry as `updated`.

[^catalogs-utils]: `src/utils/catalogs.ts`
