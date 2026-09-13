---
type: Consumer
title: spencerbeggs/pnpm-module-template
description: The workspace where the peer-suppression time-skew bug and its fix were found live, across two consecutive runs (#84, #85) that behaved differently for a reason internal to this action.
repository: spencerbeggs/pnpm-module-template
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: c6a2ada05726fe3dc41e7c8d7168473394a3e621a5714739cbbb623e1d8a834f
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
---

# spencerbeggs/pnpm-module-template

## Surfaces exercised

This consumer runs the `check-peers` gate against its own real
`pnpm-workspace.yaml`, real config-dependency plugins, and the lockfile this
action's own install step regenerates. Its two relevant runs bumped
`@effected/pnpm-plugin-effect` from an older version to `0.5.0`.

## Where the edge sits

The edge is `WorkspaceCatalogs.peerDependencyRules()` — the config-dependency
hook replay this action's `steps/peer-check.ts` reads to decide which peer
mismatches are suppressed rather than reported. That replay reflects whatever
config-dependency plugin version is installed *at the moment it runs*, which
is exactly what made this consumer diagnostic: the run in question bumped the
very plugin supplying the suppression rules, so the rules read had to happen
after the bump, not before it.

## Why this consumer matters

Run #84 reported a `required` unsatisfied peer on a row that the freshly
bumped `@effected/pnpm-plugin-effect@0.5.0`'s `allowedVersions` should have
suppressed — because the peer-check step was judging the after-install
lockfile against the *before-install* plugin's rules, memoized earlier in the
same run by release-age discovery. Run #85, after
[refreshing `WorkspaceCatalogs` before the peer-check rules read](../decisions/refresh-catalogs-before-peer-check.md)
was added, auto-merged cleanly on the same shape of change. Neither run's
outcome depended on anything specific to this consumer's code — the bug and
its fix were both properties of this action's own read ordering, made visible
only by a real config-dependency version bump landing in a real run.

## Open questions

- Whether other consumers running `check-peers` against a config-dependency
  bump between the release-age read and the install could still hit an
  analogous but distinct time-skew case is not fully ruled out — the fix
  addresses the one memo this action itself holds
  (`WorkspaceCatalogs`), not every possible staleness in the wider
  config-dependency hook chain.
- This consumer is not permanently pinned to `@dev` the way
  [savvy-web/systems](savvy-web-systems.md) is, so it is a point-in-time
  witness to the incident rather than an ongoing proving ground.

See [the peer-rules time-skew incident](../incidents/peer-rules-time-skew.md)
for the dated write-up of #84 and #85, and
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md) for the
gate this consumer's runs were exercising.
