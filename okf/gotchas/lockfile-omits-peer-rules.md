---
type: Gotcha
title: A clean pnpm-lock.yaml is not evidence of the peer-suppression rules in effect
description: pnpm-lock.yaml records what config-dependency pnpmfile hooks did to resolution (overrides) but not their reporting-only effect (peerDependencyRules), so reading the lockfile or pnpm-workspace.yaml alone will not find rules that are genuinely in force.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - deps
resource: ../../pnpm-lock.yaml
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 112ba5daa3c48554ffcb0e26566c2d6c665e7bd07eb230e8ba1cee0e2cd925d2
sources:
  - id: pnpm-lock
    resource: ../../pnpm-lock.yaml
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
---

# A clean pnpm-lock.yaml is not evidence of the peer-suppression rules in effect

## What you see

`grep -c peerDependencyRules pnpm-lock.yaml` returns `0` in this repository's
own lockfile, and `pnpm-workspace.yaml` declares no `peerDependencyRules` key
either.[^pnpm-lock][^pnpm-workspace]

## What you will wrongly conclude

Either that no peer-suppression rules are in effect for this workspace at
all, or — the other plausible reading — that the lockfile carries stale
pre-hook peer data and simply needs re-generating to pick the rules up.

## What is actually true

Both readings are wrong, and both were seriously considered before being
ruled out by measurement. pnpm persists **resolution-affecting** configuration
contributed by a config-dependency pnpmfile hook into the lockfile — an
`overrides` entry, for example — and discards **reporting-affecting**
configuration, because it changes nothing about what gets installed.
`peerDependencyRules` is exactly the second kind: it changes what pnpm
*reports*, not what it resolves, so it appears in the lockfile precisely
never. This repository declares **36 effective peer-suppression rules**
today, and every one of them is injected by config-dependency plugins at
install time rather than declared in `pnpm-workspace.yaml` — so a
workspace-file-only read finds nothing here and would still be wrong for a
repository that used the declarative key, because the two sources compose
rather than substitute for each other.

The lockfile header carries the tell: `pnpmfileChecksum` (one occurrence in
this repository's `pnpm-lock.yaml`) exists precisely *because* the lockfile
is not a complete record of what the pnpmfile hooks did — if it were, pnpm
would have nothing to invalidate the checksum against.

This is why `src/steps/peer-check.ts` does not read `pnpm-lock.yaml` or
`pnpm-workspace.yaml` for suppression rules at all. It resolves
`WorkspaceCatalogs.peerDependencyRules()`, which independently replays the
same config-dependency hooks the install just ran, and treats a failed
replay as "rules could not be verified" rather than as "there are
none".[^peer-check-step] See
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md) for why
a failed lookup degrades to omission rather than to an empty-rules
assertion.

## How to check

- `grep -c peerDependencyRules pnpm-lock.yaml` — expect `0`, always, on any
  pnpm lockfile, regardless of how many rules are genuinely in effect.
- `grep -n peerDependencyRules pnpm-workspace.yaml` — expect no match unless
  this workspace starts declaring rules directly; the config-dependency
  plugins' rules are additional to, not instead of, that key.
- `grep -c pnpmfileChecksum pnpm-lock.yaml` — expect `1`; its presence is the
  signal that hook-contributed configuration exists and is being tracked for
  invalidation, even though its *content* (the rules) is not recorded.
- To see the rules actually in effect, read them the same way the step does —
  through a `WorkspaceCatalogs` replay — rather than by grepping either
  static file.

[^pnpm-lock]: `../../pnpm-lock.yaml`
[^pnpm-workspace]: `../../pnpm-workspace.yaml`
[^peer-check-step]: `../../src/steps/peer-check.ts`
