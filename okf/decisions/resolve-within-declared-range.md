---
type: Decision
title: Resolve dependency updates within the declared range, never to npm's absolute latest
description: ConfigDeps and RegularDeps synthesize or reuse a conservative range and pick the highest version satisfying it, rather than jumping to whatever npm reports as latest.
status: draft
tags:
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: b9edf22e8c37b09bae637268795043f4b24cd5d65ab7653f914bbebe95f429fd
sources:
  - id: config-deps
    resource: ../../src/services/config-deps.ts
  - id: regular-deps
    resource: ../../src/services/regular-deps.ts
  - id: semver-utils
    resource: ../../src/utils/semver.ts
---

# Resolve dependency updates within the declared range, never to npm's absolute latest

## Context

Two services resolve dependency versions from the npm registry:
`ConfigDeps.updateConfigDeps` for pnpm config dependencies declared in
`pnpm-workspace.yaml`, and `RegularDeps.updateRegularDeps` for ordinary
`dependencies` / `devDependencies` / `optionalDependencies` entries in
workspace `package.json` files.[^config-deps][^regular-deps] Neither uses
`pnpm add --config` or `pnpm up --latest`, because both promote every
workspace dependency to the default catalog once `catalogMode: strict` is
set — an unrelated side effect this action must not trigger just by
resolving a version.

The two callers face different inputs. A config dependency in
`pnpm-workspace.yaml` is a hash-pinned exact version with **no declared
range at all** (`parseConfigEntry` extracts only a version and an optional
integrity hash), so there is nothing to resolve within — a range has to be
synthesized. A regular dependency already carries an operator (`^4.0.0`,
`~3.0.0`, `>=4.0.0`, or an exact pin), and that operator already expresses
the maintainer's own intent about how far this package should move.

## Decision

**For config dependencies**, `configDepUpgradeRange(version)`
(`src/utils/semver.ts`) synthesizes a range from the current version's
major: `>=1.0.0` stays within the current major
(`>=current <(major+1).0.0`); `<1.0.0` may advance across `0.x` releases
and adopt the first stable major, but never crosses two majors in one
step (`>=current <2.0.0`).[^semver-utils] So a pinned `1.14.5` tracks
`1.x` only, while a pinned `0.14.5` may resolve to the latest `1.x` when
one exists, or the latest `0.x` otherwise.

**For regular dependencies**, the declared specifier IS the range: a
caret stays within its major, a tilde within its minor, `>=` may cross a
major, and an exact pin never moves, because `resolveLatestSatisfying`
is given the specifier as-is via `resolutionRangeForSpecifier`, which
re-attaches the original operator verbatim once a target is
resolved.[^semver-utils][^regular-deps] The one deliberate exception is
caret-on-zero (`^0.y.z`): plain caret semantics would trap it in `0.y.x`
forever, so `resolutionRangeForSpecifier` detects that shape and widens
it to the same `configDepUpgradeRange` used for config dependencies
(`>=version <2.0.0`), letting a pre-stable dependency roll forward across
`0.x` and adopt the first stable major exactly as a config dependency
would.

Both paths then call the same `resolveLatestSatisfying(versions, range)`
— filter to stable (non-prerelease) versions, parse the range, and take
the highest version satisfying it, returned in the registry's own
spelling rather than semver's canonical form because these strings are
written back into manifests verbatim.[^semver-utils] Neither path ever
asks the registry for "latest" and takes it uncritically; the resolution
is always bounded by a range, synthesized or declared.

Under bun, `RegularDeps.updateRegularDeps` accepts an `exclude` set that
is populated **only** for that package manager: bun's `CatalogConfigDeps`
already owns and bumps the package.json range for any name that is also
a config dependency, so a `dependencies` glob matching the same name
must not bump it a second time and race the same manifest write. Under
pnpm the config-dependency path writes only `pnpm-workspace.yaml` and
never touches `package.json`, so nothing needs excluding there; under
npm, config dependencies are skipped entirely by the config-dependency
step (no `catalog:` protocol), so excluding them here would freeze the
package.json range of a dependency that happens to also be a
devDependency, forever.[^regular-deps]

`RegularDeps` iterates `dependencies`, `devDependencies` and
`optionalDependencies` (`DEP_SECTIONS`) and deliberately excludes
`peerDependencies` — those ranges are managed separately by `syncPeers`,
not by direct version resolution. Matching is deduplicated per
`(path, field)`, so a dependency declared in two sections of the same
package.json yields two independent update records, each carrying the
precise section as its `type` rather than one record that loses which
section moved.[^regular-deps]

## Alternatives rejected

- **`pnpm add --config` / `pnpm up --latest`.** Both promote workspace
  dependencies into the default catalog under `catalogMode: strict`,
  a manifest-shape change this action has no business making as a side
  effect of a version bump.
- **Resolving to npm's absolute latest.** Rejected for both paths: for a
  config dependency it would routinely propose a major jump the
  maintainer never asked for; for a regular dependency it would silently
  discard the specifier's own operator, turning a `^4.0.0` pin into an
  uncontrolled major bump.
- **Leaving caret-on-zero to plain caret semantics.** A `^0.5.0`
  dependency would never advance past `0.x` under strict caret rules,
  which is exactly the situation `resolutionRangeForSpecifier`'s widening
  exists to escape.

## Consequences

- A dependency's resolved version can still lag behind npm's newest
  release indefinitely if the range excludes it — that is the intended
  behavior, not a bug to chase.
- Two different mechanisms produce "the range to resolve within":
  synthesis from a bare version (config deps, and caret-on-zero regular
  deps) and reuse of the declared specifier (every other regular dep).
  A reviewer changing one must check whether the other should change too,
  since `configDepUpgradeRange` backs both.
- Candidates are filtered through the release-age gate before resolution
  in both services, so this range logic and the release-age hold-back
  compose rather than conflict — resolution never proposes a version
  that is both in-range and too young.

## What would change the answer

A pnpm-side change that stopped promoting workspace dependencies on
`pnpm add --config` / `pnpm up --latest` would remove the reason these
services exist at all, at which point resolving through pnpm directly
would be worth revisiting. A maintainer request to cross majors on
config dependencies in one step would require loosening
`configDepUpgradeRange`'s ceiling, which is deliberately one major at a
time today.

[^config-deps]: `src/services/config-deps.ts`
[^regular-deps]: `src/services/regular-deps.ts`
[^semver-utils]: `src/utils/semver.ts`
</content>
