---
type: Incident
title: A memoized WorkspaceCatalogs assembly judged the after-install lockfile under pre-install rules
description: Release-age discovery triggered WorkspaceCatalogs' memoized assembly before the install; the same run bumped the config-dependency plugin whose allowedVersions suppress the reported row, so peer-check judged the after-install lockfile under the pre-install plugins' rules and withheld auto-merge on a suppressed row.
status: draft
occurred: "2026-08-21"
guard: ../../__test__/unit/steps/peer-check.test.ts
tags:
  - ci
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 871736781a7e61a249d3cb47afee56fb285dd708ef2a1740df6c623c05e425fe
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: peer-check-test
    resource: ../../__test__/unit/steps/peer-check.test.ts
  - id: pnpm-module-template-84
    resource: "https://github.com/spencerbeggs/pnpm-module-template/issues/84"
  - id: pnpm-module-template-85
    resource: "https://github.com/spencerbeggs/pnpm-module-template/issues/85"
---

# A memoized WorkspaceCatalogs assembly judged the after-install lockfile under pre-install rules

## Occurred

2026-08-21, reported live in
[the pnpm-module-template consumer](../consumers/pnpm-module-template.md) as
issues #84 (the false withhold) and #85 (the confirmed fix).

## Where it surfaced

A dependency-update run against `spencerbeggs/pnpm-module-template` that
bumped `@effected/pnpm-plugin-effect` to `0.5.0` as part of its own regular
work. The run opened its PR normally but reported a `required` unsatisfied
peer dependency and withheld auto-merge, on a repository whose freshly
installed configuration explicitly suppressed that exact row.

## What it looked like

The PR body's peer-dependency table listed a `required` row keyed against
`@effected/pnpm-plugin-effect`'s `rc.109`-era `allowedVersions` entry, even
though the lockfile this run produced was resolved with the plugin's newly
bumped `0.5.0`, whose `allowedVersions` suppress that same row.

## Root cause (as a mechanism)

`WorkspaceCatalogs` (from `@effected/workspaces`) memoizes its assembly — one
workspace read plus one config-dependency pnpmfile hook replay — for the
layer's lifetime. Release-age discovery triggers that assembly first,
**before** anything installs, and deliberately wants the pre-install state:
the release-age gate governs what versions this run may even propose.
`steps/peer-check.ts` reads `peerDependencyRules()` from the same
`WorkspaceCatalogs` instance **after** the install, to judge the lockfile the
run is about to commit — but without an explicit refresh, that read
returned the same pre-install assembly release-age discovery had already
memoized.[^peer-check-step]

This run bumped `@effected/pnpm-plugin-effect` from an `rc.109`-keyed release
to `0.5.0` as part of its own regular-dependency update — the same run that
needed the peer check to reflect it. The plugin's `0.5.0` `allowedVersions`
suppress the row the pre-install assembly still enforced, so the peer check
evaluated the after-install lockfile against rules that predated the very
plugin version the run had just installed, and reported a `required` row
that the run's own output made moot. A measured detail sharpens why this is
not a version-string mismatch: pnpm's `allowedVersions` suppression keys
ignore the parent's version component (`parent@1.0.0>peer` suppresses the
mismatch under any parent version), which `@effected/workspaces` replicates
deliberately — so the miss here was specifically about which **set** of
rules was in effect, not about a version string failing to match a version
string.

## Guard

`steps/peer-check.ts` now calls `catalogs.refresh()` immediately before
reading `peerDependencyRules()`, forcing a fresh config-dependency hook
replay against the after-install state rather than reusing release-age
discovery's memo.[^peer-check-step] The ordering is pinned by a test whose
double is built to discriminate: its `peerDependencyRules` implementation
fails typed until `refresh()` has been called at least once, so the test
fails on a step that skips the refresh call, or that calls it after the
rules read rather than before.[^peer-check-test] An always-succeeding
double would pass under either ordering and prove nothing; this double
models the exact staleness the incident produced.

## What it taught

One memoized assembly cannot correctly serve two readers that need different
moments in the same run — release-age discovery needs the before-install
state and peer-check needs the after-install state, and reusing one memo for
both is a time-skew bug that presents as a suppression rule silently not
applying. See
[the decision to refresh WorkspaceCatalogs before reading peer rules](../decisions/refresh-catalogs-before-peer-check.md)
for the accepted cost (a second hook-replay subprocess per enabled run) and
why moving release-age discovery to after the install was rejected instead.

[^peer-check-step]: `src/steps/peer-check.ts`
[^peer-check-test]: `__test__/unit/steps/peer-check.test.ts`
</content>
