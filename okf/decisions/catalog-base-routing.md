---
type: Decision
title: Route a bun catalog merge on WHY the base tarball could not be read, never collapse every failure to one outcome
description: CatalogConfigDeps' three-way merge picks one of four routes depending on the specific reason the base version's catalogs export could not be read; collapsing those reasons into a single null previously discarded a user's override on a run that reported success.
status: draft
tags:
  - deps
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 67e485d6c2311429df1af5f9a7b327d196c8a8af367c1b42aa6ab73e5d8b62fc
sources:
  - id: catalog-config-deps
    resource: ../../src/services/catalog-config-deps.ts
  - id: module-catalogs
    resource: ../../src/services/module-catalogs.ts
  - id: catalogs-utils
    resource: ../../src/utils/catalogs.ts
  - id: catalog-config-deps-int-test
    resource: ../../__test__/integration/catalog-config-deps.int.test.ts
  - id: effected-282
    resource: "https://github.com/spencerbeggs/effected/pull/282"
---

# Route a bun catalog merge on WHY the base tarball could not be read, never collapse every failure to one outcome

## Context

Under bun there is no `catalog:` protocol concept for pnpm's config
dependencies to hook into, so `CatalogConfigDeps` reproduces the workflow
itself: it reads the config dependency's `catalogs` export from its
published tarball and three-way merges it into the manifest's own top-level
`catalog` / `catalogs` fields.[^catalog-config-deps] The merge needs a
**base** — the catalogs the *previously installed* version of the
dependency shipped — to tell a deliberate user override apart from an entry
the action itself wrote on a prior run; `threeWayMergeCatalogs` diffs the
on-disk manifest against that base and against the *next* version's
catalogs to decide each key's fate (`added` / `updated` / `removed` /
`kept`).[^catalogs-utils] The base version's catalogs are read the same way
the next version's are: by fetching, integrity-verifying and extracting its
published tarball, then importing the resolved entry
(`fetchModuleCatalogs`).[^module-catalogs]

That read can fail for several structurally different reasons, and most of
`fetchModuleCatalogs`'s own logic — fetching, verifying, and extracting the
tarball — was harvested upstream into `@effected/npm`'s
`PackageTarball`[^effected-282][^module-catalogs] specifically so this
module could stop reimplementing it and instead discriminate on the
`TarballError["reason"]` union the kit now raises, plus the module's own
post-extraction stages (`unresolvedEntryPoint`, `notImportable`,
`noCatalogsExport`, `malformedCatalogs`).[^module-catalogs]

**The discrimination is load-bearing because collapsing it was a shipped
bug.** Every failure used to arrive at the caller as a single `null`, and
`CatalogConfigDeps` read every `null` on the *base* version identically —
as "there is no merge base" — which took the lossy plugin-wins path
regardless of why the base was unreadable. An integrity mismatch (bytes on
the registry that do not match what was vouched for) is a completely
different situation from a base that was cleanly unpublished, but both
produced the same `null` and therefore the same behavior: silently
discarding a user's catalog override, on a run that reported
success.[^module-catalogs]

## Decision

`fetchModuleCatalogs` returns a discriminated `ModuleCatalogs` outcome —
either `{ _tag: "Catalogs", catalogs }` or
`{ _tag: "Unavailable", reason }`, where `reason` is `TarballError`'s own
reason union carried through verbatim, extended with the module's own
post-extraction stages.[^module-catalogs] `CatalogConfigDeps` then routes the
base outcome on that specific reason, not on presence/absence alone:

| base outcome | route | why |
| --- | --- | --- |
| `Catalogs` (read) | `threeWayMergeCatalogs` against the real base | the ordinary case |
| `Unavailable`, reason `notFound` | plugin-wins merge | the artifact is genuinely gone (yanked or unpublished) — there is no base to diff against, so the next version's entries overwrite the manifest's, disk-only additions survive, and nothing is removed |
| `Unavailable`, reason `noCatalogsExport` | `threeWayMergeCatalogs` against an **empty** base `{}` | the base loaded and extracted fine and simply ships no catalogs — this is a first adoption of the plugin, so every existing manifest entry predates it and is correctly the user's |
| `Unavailable`, any other reason | **skip the dependency entirely** | something that exists could not be read faithfully (an integrity mismatch, an unimportable module, a malformed export); merging without a trustworthy base could silently discard a real override, so this dependency's manifest entry and its catalogs are both left untouched this run |

The routing `switch` deliberately ends in a catch-all skip rather than an
exhaustive match over every named reason.[^catalog-config-deps] `reason` is
consumed as `TarballError["reason"]`, and that union widens on its own —
`@effected/npm@0.12.0` already split `integrityUnverifiable` (the digest
could not be computed) out of `integrityMismatch` (two digests existed and
disagreed), because a *failure to verify* is not the same claim as a
*measured mismatch*. Nothing here needed to change when that split shipped:
an unrecognized reason takes the conservative skip route by construction. An
exhaustive match would instead turn every future upstream addition into a
compile error, forcing whoever hits it to guess a route under time pressure;
only `notFound` is routed to plugin-wins today, and any future "the artifact
is genuinely absent" reason would need to be added there by hand.

## Alternatives rejected

- **Collapse every base-read failure to one outcome (`null` / not-found).**
  This is what shipped before, and it is rejected because it is
  demonstrably wrong: it treats "the base never existed" and "the base
  exists but could not be verified" as the same fact, when only the first
  one licenses overwriting the manifest's existing entries.
- **Route `notFound` and `noCatalogsExport` identically, since both mean "no
  base outcome was produced".** Rejected — this is the subtle asymmetry the
  table above exists to keep visible. Merging against an empty base makes
  every existing manifest entry read as `kept` (a user override), which is
  correct exactly once, on a first adoption. Applying that same empty-base
  merge to a base that was *yanked* would instead freeze every existing
  entry forever and the plugin could never move the manifest again — the two
  "no catalogs came back" cases need different treatment because they mean
  different things about the manifest's history.
- **An exhaustive match over `TarballError["reason"]`.** Rejected because
  the union is owned upstream and already widens without this module
  changing — an exhaustive match would make every such addition a compile
  break here, and the answer under those conditions is a rushed guess rather
  than a considered routing decision.

## Consequences

- The `kept` delta is the observable proof that the routing discriminates,
  and is deliberately reported rather than silently applied — see
  [the `kept` delta](../glossary/kept-delta.md). An empty-base merge reports
  a surviving user override as `kept`; a plugin-wins merge reports the same
  entry as `updated`, having overwritten it. A test asserting only that the
  entry is *absent* from the reported deltas does not discriminate between
  the two routes — this was caught once, during review, when the first
  version of the empty-base test made exactly that mistake.[^catalog-config-deps-int-test]
- A dependency routed to "skip entirely" also leaves its declared
  package.json range unbumped this run, for the same reason the *next*-side
  skip does: writing a version whose catalogs were never actually merged
  would leave the manifest describing a release it never saw.
- `fetchModuleCatalogs`'s loader — the `import()` of the resolved entry —
  deliberately did **not** move upstream with the rest of the tarball
  handling; a kit-level loader over a computed path would hand every
  bundling consumer the same context-module problem this action's own build
  has a specific fix for, with no seam to apply it. See
  [the dynamic import stays local](dynamic-import-stays-local.md).
- The kit's own `resolveEntryPoint` is stricter than the resolver this action
  used to hand-roll: it does not fall back to `main`/`index.js` when
  `exports` is present and nothing matches. That is a real, if currently
  unreached, exposure — see
  [no `main` fallback under `exports`](../limitations/exports-encapsulation-no-main-fallback.md).

## What would change the answer

If `@effected/npm` ever added a `TarballError` reason meaning "the artifact
is provably and permanently absent" distinct from `notFound`, that reason
would belong on the plugin-wins route alongside it. Conversely, if a future
reason meant "the artifact exists but is empty by design" rather than
"could not be read", it would belong on the empty-base route alongside
`noCatalogsExport`. Absent a specific claim like either of those, a new
reason stays on the conservative skip route.

[^catalog-config-deps]: `src/services/catalog-config-deps.ts`
[^module-catalogs]: `src/services/module-catalogs.ts`
[^catalogs-utils]: `src/utils/catalogs.ts`
[^catalog-config-deps-int-test]: `__test__/integration/catalog-config-deps.int.test.ts`
[^effected-282]: <https://github.com/spencerbeggs/effected/pull/282>
