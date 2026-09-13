---
type: Incident
title: Two real pnpm lockfile shapes made peer-check abstain on a clean repo
description: "Under @effected/lockfiles at or below 0.6.1, npm-alias dependencies and publishDirectory link: edges both landed in ResolvedPackage.unresolvedEdges, flipping the peer report to unverified and withholding auto-merge from a repository with zero real peer problems."
status: draft
occurred: "2026-08-21"
guard: ../../__test__/unit/steps/peer-check.test.ts
tags:
  - ci
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 64e9da28d98cfdaea4913a16f3141f8aacb3030fec7970f687e38c5e4bc2030d
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: peer-check-test
    resource: ../../__test__/unit/steps/peer-check.test.ts
  - id: fixture-alias
    resource: ../../__test__/unit/steps/fixtures/pnpm-lock.alias.yaml
  - id: fixture-publish-dir
    resource: ../../__test__/unit/steps/fixtures/pnpm-lock.publish-dir-link.yaml
  - id: type-registry-issue
    resource: "https://github.com/spencerbeggs/type-registry-effect/issues/122"
  - id: lockfiles-package
    resource: "npm:@effected/lockfiles"
---

# Two real pnpm lockfile shapes made peer-check abstain on a clean repo

## Occurred

2026-08-21, reported live in
[the type-registry-effect consumer](../consumers/type-registry-effect.md) as
issue #122.

## Where it surfaced

A dependency-update run against `spencerbeggs/type-registry-effect`. The
resulting PR opened normally but `check-peers` withheld auto-merge, logging
an `unverified` report with zero required rows and no other explanation —
indistinguishable, on its face, from a repository with an unresolved peer
somewhere in the graph.

## What it looked like

`PeerCheckStepResult` reported `unverified` with reason `unresolvedEdge` and
`required: []`, on a lockfile that in fact had no unsatisfied peer
dependencies anywhere.

## Root cause (as a mechanism)

The peer check reads `ResolvedPackage.unresolvedEdges` from the lockfile
model `@effected/lockfiles` produces, and treats any non-empty
`unresolvedEdges` set as proof the graph could not be fully resolved — which
correctly triggers the fail-closed `unverified` path (see
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md)). At
`@effected/lockfiles@0.6.1` and below, two legitimate pnpm lockfile shapes
landed in that set even though both were fully resolved:

- An **npm-alias dependency**, e.g. `semver-classic: npm:semver@7.6.3`. pnpm
  records the referenced instance's key as the "version" for this kind of
  entry, both at the importer level and inside a snapshot body, and the
  parser's edge-resolution logic did not compose that shape correctly.
- A **`publishDirectory` `link:` edge** in a snapshot body — a workspace
  package whose satisfied peer is recorded as e.g.
  `react: link:packages/react/dist/pkg` rather than a `workspace:`
  specifier, because no `workspace:` specifier exists in a snapshot body at
  all. The parser had no path to confirm this was satisfied without reading
  the importer's own `publishDirectory` declaration as evidence.

Both shapes are real, valid pnpm output, not malformed input — so the
`unverified` classification was itself a false negative in the lockfile
parser, one layer beneath this action's own gate logic. Because
`unverified` and a genuine unresolved peer both withhold auto-merge and both
can report zero required rows, the two situations were indistinguishable
from the consumer's side: nothing in the run's output said which one had
happened. See
[the abstained-report gotcha](../gotchas/peer-check-abstain-looks-like-peer-problems.md)
for that indistinguishability as a standing hazard, independent of this
specific root cause.

## Guard

The parser fix shipped upstream at `@effected/lockfiles@0.6.2`, developed as
a dogfood loop originating from this repository; this repository currently
installs `0.9.0`.[^lockfiles-package] Locally, `__test__/unit/steps/peer-check.test.ts`
gained two drift canaries over real pnpm `11.22.0` lockfile fixtures —
`fixtures/pnpm-lock.alias.yaml` and `fixtures/pnpm-lock.publish-dir-link.yaml` —
asserting `proven-clean` gating on both shapes.[^peer-check-test] Both
fixtures are demonstrated to fail against the pre-fix parser, which is what
makes them evidence rather than decoration: a future
`@effected/lockfiles` regression that reintroduces either misclassification
fails this suite directly, rather than resurfacing as a silently withheld
auto-merge in a consumer's repository. `PeerCheckStepResult.unverifiedReasons`
also now surfaces on the step's result, so a real abstention names its
reason instead of reporting only a bare "unverified".[^peer-check-step]

## What it taught

A fail-closed gate's abstention is only as trustworthy as the parser feeding
it — a lockfile-parsing false negative one layer below this action's own
logic produces the exact same observable symptom (withheld auto-merge, zero
rows) as a genuine unresolved peer, and the fail-closed posture that is
otherwise correct (see
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md)) has no
way to distinguish the two on its own. The fix is a combination of an
upstream correctness fix and a local drift canary pinned to a real fixture,
because a lockfile shape that is legal today is exactly the kind of thing a
future kit release could reintroduce without any local code change flagging
it.

[^peer-check-step]: `src/steps/peer-check.ts`
[^peer-check-test]: `__test__/unit/steps/peer-check.test.ts`
[^lockfiles-package]: `npm:@effected/lockfiles`
</content>
