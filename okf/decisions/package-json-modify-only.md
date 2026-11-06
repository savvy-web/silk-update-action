---
type: Decision
title: "Adopt @effected/package-json for surgical field edits only, never its decode path"
description: Every package.json writer (RuntimeUpgrade, PackageManagerUpgrade, RegularDeps, syncPeers, CatalogConfigDeps) applies changes through PackageJsonFile.modify, a JSONC span edit; each still reads with readFileSync + JSON.parse because the package's schema-decoding read path rejects a private workspace root.
status: draft
tags:
  - deps
  - compat
generated:
  by: okfit/claude-code
  at: 2026-11-06T01:10:41Z
sources:
  - id: package-manager-upgrade
    resource: ../../src/services/package-manager-upgrade.ts
  - id: runtime-upgrade
    resource: ../../src/services/runtime-upgrade.ts
  - id: regular-deps
    resource: ../../src/services/regular-deps.ts
  - id: peer-sync
    resource: ../../src/services/peer-sync.ts
  - id: catalog-config-deps
    resource: ../../src/services/catalog-config-deps.ts
  - id: catalog-utils
    resource: ../../src/utils/catalogs.ts
  - id: app-layer
    resource: ../../src/layers/app.ts
  - id: effected-pr-366
    resource: "https://github.com/spencerbeggs/effected/pull/366"
  - id: effected-issue-286
    resource: "https://github.com/spencerbeggs/effected/issues/286"
integrity:
  generated:
    body: 5e922a5ef82e6f31
---

# Adopt @effected/package-json for surgical field edits only, never its decode path

## Context

`RuntimeUpgrade` and `PackageManagerUpgrade` both rewrite fields in the root
`package.json` — `devEngines.runtime[*].version` and `packageManager` /
`devEngines.packageManager.version` respectively — and that manifest is
committed to a consumer's own repository. A whole-file `JSON.stringify` of a
parsed tree can only preserve key order, indentation and line endings by
accident of guessing the original formatting, which makes the resulting diff
unreviewable whenever the guess is wrong.

`@effected/package-json` ships two independent surfaces: a schema-decoding
read/write (`Package.decode`, requiring both `name` and a strict-semver
`version`) and, since its `0.9.0` release, a decode-free `PackageJsonFile.modify`
that edits a JSONC path in place.[^effected-pr-366] The decode path is a
correctness problem for this action specifically: the manifest it edits is
`{ "private": true, "packageManager": …, "devEngines": … }` with **no** `name`
or `version` field at all, which `Package.decode` rejects outright — turning
"edits your manifest" into "refuses your repo."[^effected-issue-286]

## Decision

Only `PackageJsonFile.modify` is adopted. Every writer still `readFileSync` +
`JSON.parse`s the manifest to **decide** what to write — parsing the
`packageManager` string, the `devEngines.packageManager` entry, locating a
`devEngines.runtime` entry, checking a dependency or peer specifier, or
reading the catalogs to merge — and only the **write** goes through `modify`, as
a list of JSONC field edits (`{ path: [...], value }`) applied in one
read/edit/write pass.[^package-manager-upgrade][^runtime-upgrade] `modify`
preserves every byte outside the edited span and skips the write entirely when
the result would be byte-identical, so a run that resolves to the same version
already on disk produces no diff at all.[^package-manager-upgrade]

The decode-free surface is not a partial adoption of convenience — it directly
answers the original objection. `Package.decode` requiring `name` +
strict-semver `version` is still true and still governs every other use of the
package in this codebase; only the one member that does not touch that
requirement was adopted. Three objections were evaluated against what shipped:

| objection | status |
| --- | --- |
| `Package.decode` rejects the private workspace root (no `name`/`version`) | stands, and is why the read stays on `readFileSync` + `JSON.parse` |
| a caret `packageManager` pin (`pnpm@^11.20.0`) is rejected | moot — the caret-pin parsing this repo needs moved onto `@effected/npm`'s `PackageManagerPin` instead, not onto this package's decode path[^package-manager-upgrade] |
| the write path sorts keys canonically | solved by `modify` being a span edit rather than a re-serialize — key order never moves |

The writers are:

| writer | edits |
| --- | --- |
| `RuntimeUpgrade` | `devEngines.runtime[*].version` |
| `PackageManagerUpgrade` | `packageManager`, `devEngines.packageManager.version` |
| `RegularDeps` | `[section, name]` per bumped specifier[^regular-deps] |
| `syncPeers` | `["peerDependencies", name]`[^peer-sync] |
| `CatalogConfigDeps` | `[section, name]` per bumped config dependency, plus `manifestCatalogEdits`' per-entry `catalog` / `catalogs` edits[^catalog-config-deps][^catalog-utils] |

`PackageManagerUpgrade`, `RuntimeUpgrade`, `RegularDeps` and
`CatalogConfigDeps` resolve `PackageJsonFile` in their **layer bodies**, not
inside a method — that placement is what keeps each method's requirement
channel `never`, and it is also exactly the placement that made a missing
provide invisible to `tsc` at any call site.[^package-manager-upgrade][^runtime-upgrade]
`syncPeers` is a free function, so its `PackageJsonFile` requirement lands on
`steps/peer-sync.ts` and then `innerProgram`; `makeAppLayer` therefore
**exposes** the service as well as providing it to the four layers.[^app-layer]
Providing the service to only one of two consumers shipped as a release that
failed every run before creating a check run — see
[the v4.6.0 incident](../incidents/v4-6-0-packagejsonfile-unprovided.md).

A second, independent decode-free member — `resolveEntryPoint`, a pure
function over a plain `{ exports?, main? }` object with no filesystem access —
is used by the config-dependency module loader for a different reason
entirely (resolving which file a config dependency's `catalogs` export lives
at); it never touches `Package.decode` either, so it does not change the
verdict above.

## Alternatives rejected

- **Adopt the schema-decoding read/write wholesale.** Rejected: it rejects the
  exact manifest shape this action must edit.
- **Keep hand-rolling the write** (parse, mutate the tree, `JSON.stringify`
  with a guessed indent via `detectIndent`). This is what every writer did
  before adopting `modify`; superseded because it re-serialized the whole
  file — expanding one-line arrays and objects, and re-indenting anything the
  guess got wrong — in a manifest committed to someone else's repository.
  `RuntimeUpgrade` and `PackageManagerUpgrade` moved first; `RegularDeps`,
  `syncPeers` and `CatalogConfigDeps` followed, and `detectIndent` and its
  module `src/utils/pnpm.ts` were deleted with their last caller. Each of the
  three carries a test comparing the full file text after an update against
  the original with only the targeted values changed.
- **Keep the local `corepackHashFromIntegrity` and version-parsing helpers**
  once the kit shipped equivalents. Rejected on a different argument than the
  decode question: `corepackHashFromIntegrity` had a real caller and worked,
  but the SRI→corepack conversion capability moved upstream to
  `@effected/npm`'s `CorepackIntegrityHash.fromSri` — and the kit's version is
  *stricter*, rejecting a wrong-length digest or non-canonical base64 that the
  local converter would silently accept and turn into a pin corepack rejects
  at install time, after this action reported success. `parsePnpmVersion` /
  `formatPnpmVersion` / `ParsedPnpmVersion` were deleted for the opposite
  reason — they had **zero callers** in `src/` or `__test__/`, and their
  recorded justification (the kit rejecting a caret pin) had independently
  stopped being true.
- **Replace `findRuntimeEntry`'s live-object mutation with a second, separate
  path lookup.** Not needed: `locateRuntimeEntry` returns the entry *and* the
  JSONC path to its `version` from one walk, which is what `modify` consumes
  directly — the earlier helper existed to hand back a live object precisely
  so a caller could assign to it, which is exactly what a surgical edit must
  not do.[^runtime-upgrade]

## Consequences

- A version bump that resolves to the same value produces no file write and
  no diff, because `modify` compares before writing.
- A **brand-new** top-level key lands at the end of the manifest unless its
  edit names a sibling through `insertAfter`. `CatalogConfigDeps` does, so a
  first-time `catalog` block goes straight after `workspaces` and a first-time
  `catalogs` block straight after `catalog` when the manifest keeps one,
  otherwise after `workspaces`. `modify` lays an inserted multi-line value out
  at its real depth and a delete takes its whole line, so
  `manifestCatalogEdits` sets a new object as one value and deletes entries
  directly.[^catalog-utils]
- Every writer still carries a dependency on `readFileSync` + `JSON.parse` for
  the read half — adopting the decode path would remove that, but only if the
  package ever ships a presence-lenient decode that accepts a nameless,
  versionless manifest. `PackageManifest` (also shipped at `0.9.0`) is exactly
  that, and is deliberately unadopted here: the parse only feeds a decision,
  and a typed field buys nothing a plain object does not already provide.
- Adopting the same package into a second consumer is a **layer-wiring
  change**, not merely a call-site change — see
  [adopting a service is a wiring change](../conventions/adopting-a-service-is-a-wiring-change.md).
- `PackageManagerUpgrade`'s own caret-pin parsing later moved a second time,
  from a module-private parser onto `@effected/npm`'s `PackageManagerPin`,
  independent of this package-json decision — the two migrations addressed
  different grammars (manifest-field editing vs. corepack-pin parsing) that
  happened to share a deleted-helper shape.

## What would change the answer

Adopting the schema-decoding read (`PackageManifest` / `Package.decode`) would
be worth revisiting the moment a **decision**, not merely a read, needs a
typed field this repo cannot already get from the raw parsed object —
`packageManager.isExact` is the obvious candidate. Until then, decoding buys
nothing the raw parse does not already provide, so it stays unadopted rather
than adopted for tidiness.

[^package-manager-upgrade]: `../../src/services/package-manager-upgrade.ts`
[^runtime-upgrade]: `../../src/services/runtime-upgrade.ts`
[^regular-deps]: `../../src/services/regular-deps.ts`
[^peer-sync]: `../../src/services/peer-sync.ts`
[^catalog-config-deps]: `../../src/services/catalog-config-deps.ts`
[^catalog-utils]: `../../src/utils/catalogs.ts`
[^app-layer]: `../../src/layers/app.ts`
[^effected-pr-366]: `https://github.com/spencerbeggs/effected/pull/366`
[^effected-issue-286]: `https://github.com/spencerbeggs/effected/issues/286`
