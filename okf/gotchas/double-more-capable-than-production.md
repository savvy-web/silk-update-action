---
type: Gotcha
title: A test double stricter or richer than production hides the bug it should catch
description: A double that fails harder or knows more than the real service it replaces produces a green suite for the wrong reason — too strict invents a bug in correct code, too capable hides a wiring bug in the code under test.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - testing
resource: ../../__test__/utils/action-doubles.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 52f02a74dbe0f7a9ad5f52e4085dcd0c300556de4f328866ce5b5cf558ffa283
sources:
  - id: action-doubles
    resource: ../../__test__/utils/action-doubles.ts
  - id: doubles-test
    resource: ../../__test__/unit/doubles.test.ts
  - id: program-inner-test
    resource: ../../__test__/unit/program.inner.test.ts
  - id: peer-check-test
    resource: ../../__test__/unit/steps/peer-check.test.ts
---

# A test double stricter or richer than production hides the bug it should catch

## What you see

A suite goes red on code that is actually correct, or a suite stays green on
code that ships broken — in both cases nothing about the failure or the
pass points at the double itself as the cause.

## What you will wrongly conclude

That a red test means the production code under test is wrong and needs
changing to satisfy the double, or that a green test means the wiring it
exercises is complete.

## What is actually true

Both directions of this trap trace to the same root: a double's behavior
must model the real service's contract exactly, not a stricter or richer
version of it, or the test stops discriminating on the property it claims to
verify.

**Too strict, invents a bug.** `ActionState.get` fails **typed** with
`reason: "missing"` when no earlier phase persisted a key — that is the
real store's contract, and `getOptional` exists specifically to let a caller
degrade gracefully on it.[^action-doubles] The in-memory double used to
`Effect.die` on a missing key instead, treating it as an unexpected defect.
Under that double, `resolveSignoff()` — whose entire contract is "read the
persisted token, and degrade to a default identity when nothing was
persisted" — read as broken, because a defect is uncatchable and no
`Effect.catch` can recover from it. The production code was correct against
the real store the whole time; only the double disagreed. Fixed by making
the double fail typed the same way the real store does, pinned by
`__test__/unit/doubles.test.ts` with an `Effect.flip` assertion — `flip`
moves a typed failure into the success channel, so the test distinguishes
"failed typed" from "died" rather than accepting either as
sufficient.[^doubles-test]

**Too capable, hides a bug.** `program.inner.test.ts` supplied its own
`WorkspaceCatalogs.layerTest` double when exercising `innerProgram`, and that
double answered every method regardless of how the layer graph was actually
wired.[^program-inner-test] Production code had built a `WorkspaceCatalogs`
layer and provided it inward to `ReleaseAge` without also merging it into the
layer this action's runtime returns — a missing merge, not a missing
provide — so `steps/peer-check.ts`'s own resolution of `WorkspaceCatalogs`
had nothing behind it. The suite could not catch this: its double was more
complete than the real wiring it stood in for, so a `.layerTest()` call
succeeded regardless of whether `makeAppLayer` actually exposed the service.
The gap was found only when it shipped and failed on the runner.

The fix in the same test suite that avoided repeating the second trap is the
instructive contrast: `__test__/unit/steps/peer-check.test.ts`'s
refresh-ordering test gives its `WorkspaceCatalogs` double a
`peerDependencyRules` that fails typed **until `refresh()` has been
called**.[^peer-check-test] That double does not simply always succeed — it
models the exact staleness the production code exists to fix, so the test
goes red on a step that skips the refresh call or orders it after the rules
read, and stays green only when the ordering is actually correct.

## How to check

- Before trusting a double, write down the real service's contract in one
  sentence (which inputs fail, which fail typed vs. as a defect, what an
  absent value means) and check the double against that sentence — not
  against what would make the current test pass.
- A double that *always* succeeds, or that succeeds unconditionally on a
  method the real wiring might not actually reach, cannot discriminate a
  missing-wiring bug from correct wiring — see
  [WorkspaceCatalogs not merged into the returned layer](../incidents/workspacecatalogs-not-merged.md).
- When a double's behavior changes to fix one of these traps, prefer making
  it fail under the exact condition the bug depended on (as the
  refresh-ordering double does) over making it merely stricter or merely more
  permissive — either extreme reintroduces one of the two failure modes here.
- See
  [state what would falsify a load-bearing claim](../conventions/write-falsifiable-claims.md):
  a double whose failure/success shape was never checked against the real
  service's contract is exactly the kind of unverified claim that
  convention exists to flag.

[^action-doubles]: `../../__test__/utils/action-doubles.ts`
[^doubles-test]: `../../__test__/unit/doubles.test.ts`
[^program-inner-test]: `../../__test__/unit/program.inner.test.ts`
[^peer-check-test]: `../../__test__/unit/steps/peer-check.test.ts`
