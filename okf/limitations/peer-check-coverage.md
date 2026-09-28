---
type: Limitation
title: The peer gate covers less than "no peer problems" implies
description: "Optional peers never gate, a workspace package's own peer declarations are undetectable, a file:, git or tarball peer provider always withholds, and a publishDirectory link: is judged against the source manifest rather than the built one pnpm reads."
status: draft
tags:
  - deps
bounds: ../decisions/peer-gate-fails-closed.md
generated:
  by: okfit/claude-code
  at: 2026-09-28T21:24:50Z
  body_sha256: 20733ee216fef99cdd215f0eee9ca34e6566f5f9ce9501c4ac0b5cc3339d4dbc
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: peers-util
    resource: ../../src/utils/peers.ts
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
  - id: peer-check-test
    resource: ../../__test__/unit/steps/peer-check.test.ts
  - id: workspaces-types
    resource: npm:@effected/workspaces
    title: PeerCheck.run, PeerCheckOptions and UnverifiedReason declarations (index.d.ts)
  - id: effected-peer-wave
    resource: "https://github.com/spencerbeggs/effected/pull/811"
    title: effected peer-wave round-2 handoff, "Intentionally not done"
    author: effected/claude-code
    last_modified: 2026-09-27T00:00:00Z
---

# The peer gate covers less than "no peer problems" implies

## Condition

`peerCheckStep` reports on `PeerCheck.run`'s output over the "after" lockfile
snapshot, gated by `decidePeerGate`, with `peerDependencyRules`, `catalogs`
and `workspacePackages` supplied whenever their lookups
succeed.[^peer-check-step][^peers-util] These gaps exist in what that report
can see, independent of whether the run's dependency bumps were otherwise
clean:

- **Optional peers never gate.** `PeerIssue.optional` is carried through on
  every reported issue, but `decidePeerGate`'s `requiredCount` term counts
  only the kit's own `report.required` — an unsatisfied optional peer never
  contributes to a withhold, by construction.
- **A workspace package's own peer declarations are undetectable.** pnpm
  records no peer declarations for workspace projects, and
  `pnpm peers check` does not report a member's own unsatisfied peers
  either. The `workspacePackages` join closes only the other side of that
  blind spot: a member's declared peers are judged for the importer that
  links it directly, against that importer's
  dependencies.[^workspaces-types]
- **A `publishDirectory` `link:` is judged against the source manifest.**
  pnpm links such a member into its `publishConfig.directory` and reads the
  peers from the built manifest at the link target; `PeerCheck` reads the
  source manifest discovery returns and resolves its `catalog:` ranges
  through `catalogs`.[^workspaces-types] The two agree when the build emits
  the resolved ranges. In the one observed divergence — a negative control
  with no built manifest present — pnpm reported nothing while `PeerCheck`
  reported the rows, so the disagreement seen so far runs in the strict
  direction. A build that emits different peer ranges than its source
  resolves to would not be caught; that case is unmeasured.
- **A peer provided by `file:`, git, or a remote tarball always withholds.**
  Such a provider's version is a protocol specifier, so the kit reports
  `peerVersionUnresolved` rather than judging it.[^workspaces-types] pnpm 11
  and pnpm 12 write byte-identical lockfiles for a `file:` provider and
  disagree on its verdict, which is why the kit marks rather than
  judges.[^effected-peer-wave] Three narrower kit limits ride on this
  (listed upstream as intentionally not done): an `allowAny` rule naming a
  `file:`-provided peer is not consulted, so that peer stays unverified
  where pnpm clears it; a tarball's recorded `version:` is not carried, so
  pnpm 12.7's tarball behaviour cannot be matched; and git providers were
  not measured.[^effected-peer-wave]
- **The `link:` join is measured against pnpm only.** The kit's
  workspace-join behaviour has pnpm oracles; there is no npm or bun oracle
  for it, and the npm/bun root importer already lands in
  `unresolvedImporters`.[^workspaces-types]

The regression the `publishDirectory` `link:` drift canary in
`__test__/unit/steps/peer-check.test.ts` guards is now two-sided: the
fixture's `link:packages/react/dist/pkg` edge must reach `proven-clean` only
when discovery supplies the member, and must withhold with `unresolvedEdge`
when discovery fails.[^peer-check-test] Either assertion going red means the
kit's join or this step's wiring changed.

## Symptom

An unsatisfied optional peer never appears as a required row and never
withholds auto-merge, however genuinely broken the optional integration is.
A workspace package's own declared peer needs — as opposed to a peer needed
by one of its dependencies or by a member it links — never show up in
`issues`, satisfied or not. A repository that provides any peer through a
`file:` override, a git dependency, or a remote tarball has auto-merge
withheld on every run, with `peerVersionUnresolved` in the log and zero
rows, even when that provider satisfies the range; this is the dogfooding
case, where `file:` overrides are live. This repository's own
`pnpm-workspace.yaml` `configDependencies` block names the two plugins whose
`peerDependencyRules()` the rules come from.[^pnpm-workspace]

## Why acceptable

Each gap is a fail-closed choice about a case the gate cannot honestly
resolve, not a bug: an optional peer being unsatisfied is, definitionally,
something the declaring package already tolerates; a workspace package's own
peer declarations are invisible to the lockfile and to pnpm's own check; and
a protocol-specifier provider has no version two supported pnpm majors agree
on, so any verdict would be wrong for one of them. Every case above either
withholds or is outside what pnpm itself reports — none produces a
`proven-clean` on an unexamined report, which is the property
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md) exists
to hold. The `publishDirectory` source-vs-built split is the one gap that
could in principle pass something pnpm rejects; it is accepted because the
build contract is to emit the resolved ranges, and it is listed here so a
divergence report has somewhere to land.

## What a fix would take

Gating on optional peers would need a policy decision about which optional
peers matter (not "any", since optional peers are declared optional for a
reason) plus a new input to opt into it. Surfacing a workspace package's own
peer declarations would mean judging each member's manifest peers against
its own dependencies — a check pnpm itself does not make, so there is no
oracle to match. The `file:`/git/tarball limits are upstream follow-ups in
`@effected/workspaces` (consuming `allowAny` on the marked path, carrying a
tarball's recorded version, measuring git); this step would pick them up by
a kit bump with no wiring change, because it forwards `report.unverified`
verbatim. Reading the built manifest for a `publishDirectory` link would
need the kit to read the link target on disk instead of the discovered
source manifest, which only exists after a build.

[^peer-check-step]: `src/steps/peer-check.ts`
[^peers-util]: `src/utils/peers.ts`
[^pnpm-workspace]: `pnpm-workspace.yaml` (`configDependencies` block)
[^peer-check-test]: `__test__/unit/steps/peer-check.test.ts`
[^workspaces-types]: `npm:@effected/workspaces` (`PeerCheck.run`, `PeerCheckOptions`, `UnverifiedReason` in `index.d.ts`; installed `0.30.1`)
[^effected-peer-wave]: <https://github.com/spencerbeggs/effected/pull/811>
