---
type: Limitation
title: The peer gate covers less than "no peer problems" implies
description: Optional peers never gate, a workspace package's own peer declarations are undetectable, and the ignoreMissing/allowAny rule axes fail closed rather than being honored.
status: draft
tags:
  - deps
bounds: ../decisions/peer-gate-fails-closed.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: ee5d8eea4baa4ac070bd3752a2ccbff01089aaf9a7e25ee14da98b0be2f15850
sources:
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: peers-util
    resource: ../../src/utils/peers.ts
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
---

# The peer gate covers less than "no peer problems" implies

## Condition

`peerCheckStep` reports on `PeerCheck.run`'s output over the "after" lockfile
snapshot, gated by `decidePeerGate`. Three structural gaps exist in what that
report can ever see, independent of whether the run's dependency bumps were
otherwise clean:[^peer-check-step][^peers-util]

- **Optional peers never gate.** `PeerIssue.optional` is carried through on
  every reported issue, but `decidePeerGate`'s `requiredCount` term counts
  only the kit's own `report.required` — an unsatisfied optional peer never
  contributes to a withhold, by construction.
- **A workspace package's own peer declarations are undetectable.** They are
  absent from the lockfile entirely, and `pnpm peers check` does not surface
  them either — this is a property of what pnpm records, not something this
  action's own gate logic could recover by reading harder.
- **`ignoreMissing` / `allowAny`, the two axes `peerDependencyRules` can also
  carry, are not consumed by this gate at all**, and a non-empty value on
  either one is treated as reason to distrust the whole report rather than as
  an instruction to honor.

## Symptom

An unsatisfied optional peer never appears as a required row and never
withholds auto-merge, however genuinely broken the optional integration is.
A workspace package's own declared peer needs — as opposed to a peer needed
by one of its dependencies — simply never shows up in `issues`, satisfied or
not. And if a config-dependency plugin ever starts setting `ignoreMissing` or
`allowAny` in its `peerDependencyRules()` contribution (`pnpm-workspace.yaml`'s
`configDependencies` block names the two plugins this repository currently
runs[^pnpm-workspace]), the report becomes `unverified` and the gate withholds
auto-merge permanently for that repository — not because a peer is broken,
but because the report can no longer make the "proven clean" claim at all.

## Why acceptable

Each gap is a fail-closed choice about a case the gate cannot honestly
resolve, not a bug: an optional peer being unsatisfied is, definitionally,
something the declaring package already tolerates; a workspace package's own
peer declarations are invisible to the one artifact (`pnpm-lock.yaml`) this
gate is willing to trust; and `ignoreMissing`/`allowAny` describe rules this
gate does not implement the semantics of, so silently accepting them would
risk reporting `proven-clean` on a report that was actually only
partially examined. Turning the gate into a permanent abstain on the
`ignoreMissing`/`allowAny` case is the same fail-closed posture as every other
"not examined" term in `decidePeerGate` — see
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md).

## What a fix would take

Gating on optional peers would need a policy decision about which optional
peers matter (not "any", since optional peers are declared optional for a
reason) plus a new input to opt into it. Surfacing a workspace package's own
peer declarations would need a source other than the lockfile — the kit would
have to read `package.json` directly per workspace package, which is a
different kind of check than a lockfile-driven one. Consuming
`ignoreMissing`/`allowAny` would need this gate (or the upstream kit) to
implement their actual semantics rather than treating their presence as a
signal to abstain.

[^peer-check-step]: `src/steps/peer-check.ts`
[^peers-util]: `src/utils/peers.ts`
[^pnpm-workspace]: `pnpm-workspace.yaml` (`configDependencies` block)
