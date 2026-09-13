---
type: Gotcha
title: An unprovided service in makeAppLayer is not a type error
description: Action.run's optional options parameter lets a leftover requirement in makeAppLayer's channel typecheck cleanly and die on the runner as a defect.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - architecture
  - ci
resource: ../../src/layers/app.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 983b45249df0026bc255ad4947f042620db1723028b4bedf1a993ff52323b1b9
sources:
  - id: main-ts
    resource: ../../src/main.ts
  - id: layers-app
    resource: ../../src/layers/app.ts
  - id: github-actions-dts
    resource: ../../node_modules/@effected/github-actions/index.d.ts
  - id: layer-guard-test
    resource: ../../__test__/unit/layers/app.test.ts
---

# An unprovided service in makeAppLayer is not a type error

## What you see

`pnpm typecheck` is clean and the full suite is green. `src/main.ts` calls
`Action.run(program)` with no second argument, and nothing about that call
site — a red squiggle, a compiler error, a failing test — points at a domain
service that `makeAppLayer` never actually wires up.[^main-ts]

## What you will wrongly conclude

That a missing `Layer.provide` for a service one of the domain layers resolves
is the kind of mistake TypeScript catches by construction — "if it typechecks,
every requirement is satisfied" — so a clean build is evidence the layer graph
is complete.

## What is actually true

`Action.run` is declared `<E, R = never>(program: Effect.Effect<void, E,
ActionServices | R>, options?: ActionRunOptions<R>) => Promise<void>`, and
`options` is optional.[^github-actions-dts] Because it is optional, `R` infers
to whatever `program` still requires, and nothing forces a caller to supply a
layer for it. `Action.run(program)` typechecks at *any* leftover `R`
whatsoever — there is no "you forgot a layer" error at this call site, ever.

So the failure mode is specific and silent: a domain service resolved inside
one of `makeAppLayer`'s layer bodies rises into the composed layer's
requirement channel; if `makeAppLayer` never provides that service, the
leftover requirement is absorbed by `R` and the bare `Action.run(program)`
call accepts it without complaint. The run then dies as a **defect** on the
actual GitHub Actions runner — not a typed failure, not a test failure —
roughly 30ms into `main`, **before the check run is even created**, so there
is nothing to see in the GitHub UI beyond a red job with a `Service not
found: <tag>` stack trace.

The only thing standing between this class of bug and a release is a
type-level assertion built specifically because the call site cannot express
it: `__test__/unit/layers/app.test.ts` asserts that
`Exclude<AppLayerRequirements, ActionServices>` is `never`, where
`AppLayerRequirements` is read off `ReturnType<typeof makeAppLayer>`. That
assertion fails `pnpm typecheck` and names the missing service in the
compiler error — but only because the test file exists and is inside the tsc
project; nothing about `Action.run`'s own signature enforces it.[^layer-guard-test]

## How to check

- Read `node_modules/@effected/github-actions/index.d.ts` for the `run`
  signature directly rather than trusting a paraphrase — confirm `options` is
  still typed optional and `R` still defaults to `never`.[^github-actions-dts]
- If a new domain layer is added or an existing one gains a new dependency
  resolved in its layer body, confirm it also appears in a `Layer.mergeAll`
  (or equivalent provide) inside `makeAppLayer`, not merely somewhere a layer
  is `provide`d for a narrower purpose — providing it to one consumer but not
  merging it into the layer `makeAppLayer` returns reproduces the same defect
  under a different shape.[^layers-app]
- Re-run `pnpm typecheck` after touching either file: the guard test is the
  actual signal, and a green typecheck with the guard present is the only
  green worth trusting here.

See [the compile-time layer guard](../decisions/compile-time-layer-guard.md)
for why the assertion lives in a test file rather than at the call site, and
[adopting a service is a wiring change](../conventions/adopting-a-service-is-a-wiring-change.md)
for the convention that keeps a service's dependencies inside its own layer
body so this guard stays total. [The v4.6.0 incident](../incidents/v4-6-0-packagejsonfile-unprovided.md)
is the production failure this gotcha describes, and the guard's own
compiler-error message is reproduced there verbatim.

[^main-ts]: `src/main.ts`
[^layers-app]: `src/layers/app.ts`
[^github-actions-dts]: `node_modules/@effected/github-actions/index.d.ts`
[^layer-guard-test]: `__test__/unit/layers/app.test.ts`
