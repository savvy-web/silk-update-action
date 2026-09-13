---
type: Gotcha
title: A green coverage run is not evidence a module is exercised
description: The coverage gate enforces aggregate, whole-run minimums, not a per-file floor, so an entire module can have zero test execution while the suite stays green.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - testing
resource: ../../vitest.config.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 5e26bbecadfda594a4b854093799429719ad251815c20b20b53bda200450048f
sources:
  - id: vitest-config
    resource: ../../vitest.config.ts
  - id: app-layer
    resource: ../../src/layers/app.ts
  - id: layer-guard-test
    resource: ../../__test__/unit/layers/app.test.ts
---

# A green coverage run is not evidence a module is exercised

## What you see

`pnpm test:coverage` passes and every threshold reports green.
`vitest.config.ts` wires its coverage config from
`AgentPlugin.COVERAGE_LEVELS.strict` — `coverageTargets` passed into the
plugin and `.thresholds` passed onto `test.coverage`, with
`exclude: []`.[^vitest-config]

## What you will wrongly conclude

That a passing coverage gate means every module in `src/` received test
execution, or at minimum that no module is completely untested.

## What is actually true

The thresholds are **aggregate** — whole-run minimums, not a per-file gate,
and nowhere near 100%. Because the average is computed across the whole
codebase, one module can sit at **zero** executed lines while the rest of
the suite carries the mean over the line. This is not hypothetical: it is
exactly how the ~250-line `innerProgram` orchestration function once sat
completely unexercised behind a passing gate and a `v8 ignore` block, and
how a regression that read every action input through bare `Config` instead
of `ActionInput` shipped — the input-reading code executed, decoded nothing
because the runner's `INPUT_*` names never matched, and every step just
logged "not configured," which the coverage instrumentation records as
lines run, not as lines run *correctly*.

`src/layers/app.ts` is the sharper case, because coverage cannot help at
all there even in principle. `makeAppLayer` is `v8 ignore`-d as pure
wiring, and the class of defect it shipped once (a domain service resolved
in a layer body that `makeAppLayer` never merged into the returned layer)
is a fact about a **type** — the shape of the requirement channel — not
about which lines executed.[^app-layer] Running every line in that file
would not surface a missing `Layer.provide`; only a type-level assertion
over the composed layer's requirement channel does that.[^layer-guard-test]
The general point: some invariants are not statements about executed
lines, and reaching for coverage on those is looking under the wrong
lamppost.

## How to check

- Do not read a coverage percentage as a claim about correctness or even
  about execution of a specific module — check the per-file report
  (`vitest.config.ts`'s `coverage.exclude: []` at least guarantees nothing
  is hidden from the report itself) rather than trusting the aggregate
  number.[^vitest-config]
- To verify a module is actually exercised, use fault injection: throw
  inside the code path under test and confirm a test goes red. If the
  suite still passes, that path has no real test execution regardless of
  what the coverage number says.
- For an invariant about a *type* rather than a *value* (a requirement
  channel, a layer graph), reach for a compile-time assertion instead of a
  runtime coverage number — see
  [an unprovided service in makeAppLayer is not a type error](unprovided-service-is-not-a-type-error.md)
  and [the compile-time layer guard](../decisions/compile-time-layer-guard.md).

[^vitest-config]: `vitest.config.ts`
[^app-layer]: `src/layers/app.ts`
[^layer-guard-test]: `__test__/unit/layers/app.test.ts`
