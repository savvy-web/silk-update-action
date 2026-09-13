---
type: Gotcha
title: An abstained peer report reads exactly like a repo with real peer problems
description: check-peers withholding auto-merge with zero required rows is indistinguishable, from the consumer side, from a repo with unsatisfied peers — both simply withhold auto-merge, and two real pnpm lockfile shapes triggered the abstention on genuinely clean repos.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - deps
  - ci
resource: ../../src/steps/peer-check.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 66df656d0cbe27b516491bbeda6115a4d468d09cbc3dea85ab1a8d58dfd58d5b
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: peer-check-test
    resource: ../../__test__/unit/steps/peer-check.test.ts
  - id: fixture-alias
    resource: ../../__test__/unit/steps/fixtures/pnpm-lock.alias.yaml
  - id: fixture-publish-dir
    resource: ../../__test__/unit/steps/fixtures/pnpm-lock.publish-dir-link.yaml
  - id: lockfiles-package
    resource: npm:@effected/lockfiles
  - id: type-registry-issue
    resource: "https://github.com/spencerbeggs/type-registry-effect/issues/122"
---

# An abstained peer report reads exactly like a repo with real peer problems

## What you see

A `check-peers: no-auto-merge` (or `warn`) run opens a PR and auto-merge is not
enabled on it, or a warning is logged naming unresolved peer problems. Either
way the consumer sees the same outward signal: **auto-merge did not
happen.**[^peer-check-step]

## What you will wrongly conclude

That withheld auto-merge always means the run found an unsatisfied peer
dependency somewhere in the graph, and that the fix is to go looking for one.

## What is actually true

`PeerCheckStepResult` distinguishes a report that is `unverified` from one
that is `proven-clean`, but both can produce **zero** required rows, and only
the reason field says which happened.[^peer-check-step] An `unverified`
report means the gate could not prove the graph clean — an unsupported
lockfile format, an unresolved importer, or peer-suppression rules that could
not be looked up — and it withholds auto-merge on principle, not because it
found anything wrong. That is deliberate (see
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md)), but it
means "withheld" carries no information about whether a real peer problem
exists until you read `unverifiedReasons`, which exists specifically because a
real run withheld auto-merge with `0` issues and a log line reading only
`(unverified)` — indistinguishable, on its face, from a repo with peer
problems.[^peer-check-step]

This has fired on genuinely clean repositories, not merely as a theoretical
gap. Two real pnpm lockfile shapes — an npm-alias dependency
(`semver-classic: npm:semver@7.6.3`) and a `publishDirectory` workspace whose
satisfied peer is recorded as a `link:` specifier — both landed in
`ResolvedPackage.unresolvedEdges` under `@effected/lockfiles` at or below
`0.6.1`, which flipped the peer-check step to `unverified` with reason
`unresolvedEdge` and withheld auto-merge from a repository with zero real peer
issues (observed in spencerbeggs/type-registry-effect#122[^type-registry-issue]).
The fix shipped upstream at `@effected/lockfiles@0.6.2`; this repository
currently installs `0.9.0`.[^lockfiles-package] See
[peer check abstained on a clean repo](../incidents/peer-check-abstained-on-clean-repo.md)
for the incident record.

## How to check

- Read `unverifiedReasons` on the step's result, not just the withheld/passed
  verdict — `decision.reason === "unverified"` on its own tells you nothing
  about whether a peer problem exists.[^peer-check-step]
- Two drift canaries pin both fixture shapes as `proven-clean`
  (`__test__/unit/steps/peer-check.test.ts`, over
  `fixtures/pnpm-lock.alias.yaml` and
  `fixtures/pnpm-lock.publish-dir-link.yaml`), so a future
  `@effected/lockfiles` regression that reintroduces either
  `unresolvedEdges` shape fails this suite rather than silently withholding
  auto-merge in a consumer's repository again.[^peer-check-test]
- Before assuming a real peer problem, check `node -p
  "require('./node_modules/@effected/lockfiles/package.json').version"`
  against the fixed release — an `unverified` report on a lockfile shape this
  parser has not seen before is a candidate for the same class of bug, not
  necessarily a real peer conflict.

[^peer-check-step]: `../../src/steps/peer-check.ts`
[^peer-check-test]: `../../__test__/unit/steps/peer-check.test.ts`
[^lockfiles-package]: `npm:@effected/lockfiles`
[^type-registry-issue]: `https://github.com/spencerbeggs/type-registry-effect/issues/122`
