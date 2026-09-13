---
type: Consumer
title: spencerbeggs/type-registry-effect
description: The repository where a real, clean pnpm lockfile was withheld auto-merge by check-peers, because two legitimate pnpm lockfile shapes were misclassified by an upstream lockfile parser.
repository: spencerbeggs/type-registry-effect
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 27d17f93c72787201de0a8b8886b84ad5963059e695f06013ba5404fbea00f8f
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: package-json
    resource: ../../package.json
---

# spencerbeggs/type-registry-effect

## Surfaces exercised

The `check-peers` gate, run against this consumer's real `pnpm-lock.yaml`
during a dependency-update run. The lockfile contained an **npm-alias**
dependency (a package installed under a local name pointing at a different
published package) at both the importer level and inside a snapshot body.

## Where the edge sits

The edge is `@effected/lockfiles`' lockfile model, specifically
`ResolvedPackage.unresolvedEdges` — the field `steps/peer-check.ts` consults to
decide whether it can trust the lockfile enough to report a proven-clean peer
result. Under `@effected/lockfiles` `<=0.6.1`, the npm-alias shape landed in
`unresolvedEdges`, which this action's own gate logic reads as "the lockfile
could not be fully resolved" rather than "there are no peer problems."

## Why this consumer matters

The result (issue #122) was a report of `unverified ("unresolvedEdge")` on a
repository with zero real peer problems, which — under this action's
fail-closed posture — withholds auto-merge exactly as it would for a genuine
unresolved peer conflict. From the consumer's side, a clean repository and a
repository with real peer issues produced the identical observable symptom:
auto-merge silently did not happen. This is the incident class this action's
own design explicitly names as its sharpest risk — a report that abstains is
indistinguishable, to the consumer, from a report that found something wrong.
The fix landed upstream in `@effected/lockfiles@0.6.2`, and this repository now
pins two real-fixture drift canaries over the npm-alias and the sibling
`publishDirectory` `link:` shape specifically so a future lockfile-parser
regression fails this repository's own suite rather than resurfacing here.

## Open questions

- Whether other lockfile shapes this consumer's dependency graph might
  eventually produce could land in `unresolvedEdges` for a different, as yet
  unseen reason is not something the two drift canaries can rule out — they
  pin the two shapes that have actually been observed, not the space of all
  possible shapes.

See [the peer-check-abstained-on-clean-repo incident](../incidents/peer-check-abstained-on-clean-repo.md)
and [the peer-gate abstention gotcha](../gotchas/peer-check-abstain-looks-like-peer-problems.md).
