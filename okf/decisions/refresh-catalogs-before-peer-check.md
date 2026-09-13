---
type: Decision
title: Refresh WorkspaceCatalogs before reading peer-suppression rules
description: The peer-check step forces a fresh config-dependency hook replay so it judges the after-install lockfile under the after-install rules.
status: draft
tags:
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: ed52773d3d639f7b13630adbca856aaf455161fa00a47f0a3a8ce6a52b935f8a
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: peer-check-test
    resource: ../../__test__/unit/steps/peer-check.test.ts
  - id: layers-app
    resource: ../../src/layers/app.ts
  - id: package-json
    resource: ../../package.json
---

# Refresh WorkspaceCatalogs before reading peer-suppression rules

## Context

`@effected/workspaces`' `WorkspaceCatalogs` memoizes its assembly — one
workspace read plus one config-dependency hook replay — for the layer's
lifetime, and this action mutates the workspace *between* two readers of that
one assembly. Release-age discovery is the first reader: it triggers the
assembly before anything installs, and it deliberately wants the
*before*-state, because the release-age gate governs what this run may
propose. The peer-check step is the second reader, and it needs the
*after*-state: the run may have just bumped the very config-dependency plugin
whose pnpmfile hooks supply the peer-suppression rules, and judging the
after-install lockfile under the pre-install plugins' rules answers the wrong
question.

One infinite memo cannot serve both moments, so `peerCheckStep` calls
`catalogs.refresh()` before reading `peerDependencyRules()`.[^peer-check-step]
The cost is explicit and accepted: an enabled `check-peers` run replays the
config-dependency hook subprocess twice — once for release-age discovery,
once for the peer-check refresh.

A measured detail this ordering leans on: pnpm ignores the parent *version*
in an `allowedVersions` suppression key, so `parent@1.0.0>peer` suppresses a
mismatch under any parent version, not just `1.0.0`. `@effected/workspaces`
replicates that behavior deliberately. Without the refresh, a lockfile
carrying a freshly bumped parent version would still be evaluated against
suppression keys assembled before the bump — and because the key ignores the
parent version anyway, the two failure modes this ordering could produce are
subtler than a version mismatch: a rule the new plugin version added is
missing from the pre-install assembly, and a rule the new version removed is
still applied from it.

## Decision

`src/layers/app.ts` builds `workspaceCatalogs` once and exposes it into the
domain-layer merge rather than only providing it inward to `releaseAge`, so
the same instance both release-age discovery and `steps/peer-check.ts` reach
for `refresh()` and `peerDependencyRules()` on is genuinely shared.[^layers-app]
`peerCheckStep` calls `catalogs.refresh()` unconditionally on the enabled
path, immediately before the `peerDependencyRules()` read, so the refresh and
the read can never be reordered by a later edit without touching the line
between them.[^peer-check-step]

The ordering is pinned by a test whose double is built to discriminate: its
`peerDependencyRules` implementation fails typed until `refresh()` has been
called at least once, so the test goes red on a step that skips the refresh
*or* that calls `peerDependencyRules()` before it.[^peer-check-test] An
always-succeeding double would pass against either ordering and prove
nothing — the double has to model the staleness being fixed, not just supply
a plausible value.

`@effected/workspaces` is pinned at `^0.18.0` in this repository's
`package.json`, which is required for `refresh()` to exist as a
method.[^package-json]

## Alternatives rejected

- **One shared assembly, read once.** This was the shape before the finding:
  `WorkspaceCatalogs`' memoized assembly served both release-age discovery
  and the peer-check rules read from the same before-install snapshot. It
  produced a real false positive live — a peer row the freshly installed
  plugin version suppressed was still reported as required, because the
  rules read judged the after-install lockfile under the before-install
  plugins' rules.
- **Move release-age discovery to after the install.** Would make the
  refresh a no-op, since both readers would then see the same after-state —
  but release-age discovery exists specifically to gate what this run *may
  propose*, which has to happen before resolution, not after installation.
  The two readers need different moments by design; moving one to match the
  other would break the one that moved.
- **A second, independently-built `WorkspaceCatalogs` layer for peer-check.**
  Would avoid touching the shared instance's memo entirely, but doubles the
  in-memory assembly and the config-dependency hook replay unconditionally on
  every run rather than only on an enabled `check-peers` run, and duplicates
  the workspace-root wiring `src/layers/app.ts` already does once.

## Consequences

- An enabled `check-peers` run always replays the config-dependency hook
  subprocess twice: once memoized at release-age discovery, once forced at
  the refresh. This is the accepted cost of the fix, not an oversight.
- A disabled `check-peers` run short-circuits before resolving
  `WorkspaceCatalogs` at all, so this cost is confined to runs that opted in.
- The refresh is a hard dependency on `@effected/workspaces@^0.18.0` for the
  method to exist; a downgrade below the version that introduced `refresh()`
  would need this ordering rewritten or dropped.

## What would change the answer

If release-age discovery is ever moved to run after the install, the refresh
call becomes a harmless no-op and the before/after split this decision
describes no longer exists — at which point the call could be removed rather
than merely tolerated. See
[the peer-rules time-skew incident](../incidents/peer-rules-time-skew.md)
for the concrete failure and the recovery that followed it.

[^peer-check-step]: `src/steps/peer-check.ts`
[^peer-check-test]: `__test__/unit/steps/peer-check.test.ts`
[^layers-app]: `src/layers/app.ts`
[^package-json]: `package.json`
