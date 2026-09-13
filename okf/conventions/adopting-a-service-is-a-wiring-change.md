---
type: Convention
title: Adopting a service into a second consumer is a layer-wiring change
description: When a second domain layer starts resolving a service in its layer body, provide that service to it in `makeAppLayer` in the same change — Action.run accepts an unprovided requirement silently, so nothing else will catch the omission.
stale_after: 2027-03-12T00:00:00Z
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: fc765fc7f87f4f85419ae5c8346a9dc9d02021870d85aa3c3673c9295a48edea
sources:
  - id: app-layer
    resource: ../../src/layers/app.ts
  - id: app-layer-test
    resource: ../../__test__/unit/layers/app.test.ts
---

# Adopting a service into a second consumer is a layer-wiring change

## Rule

When a service resolves a dependency in its own `Layer.effect`/`Layer.scoped`
body (rather than inside a method), and a *second* domain layer starts doing
the same, add that dependency to the second layer's `Layer.provide` /
`Layer.merge` call in `makeAppLayer` in the same commit that adds the
resolution. Then check it actually landed in `domainLayers`' or
`libraryLayers`' `Layer.mergeAll(...)` call — not merely that it appears
somewhere in a `Layer.provide` chain that is itself never merged into the
value `makeAppLayer` returns.[^app-layer]

A service resolved inside a *method* rather than a layer body is a different,
narrower case: the requirement lands on whatever effect calls that method
(often `innerProgram`, not `makeAppLayer`), and it must be checked against
`ActionServices` at that level instead — see the second assertion below.

## Why

`Action.run` declares its `options` parameter as optional
(`<E, R = never>(program, options?: ActionRunOptions<R>)`), so `R` simply
infers to whatever `program` still requires and `Action.run(program)`
typechecks at *any* leftover `R`. There is no "you forgot to provide this"
type error at that call site, ever — a missing provide is invisible to the
compiler unless something else asserts on the composed layer's shape.

This has shipped as a total production outage once already: a service was
added to one domain layer's body and provided to only one of its two
consumers in `makeAppLayer`. That passed typecheck and a full green test
suite, then failed every run in every consumer repository roughly 30ms in —
before the check run was even created, so nothing appeared in the GitHub UI.
See [the v4.6.0 PackageJsonFile incident](../incidents/v4-6-0-packagejsonfile-unprovided.md).

A second, distinct failure mode produced a second incident: a service was
resolved inside a **step's** method body rather than a layer body. The
layer-shape assertion below is structurally blind to that case — it checks
`makeAppLayer`'s *input* channel, and a method-resolved requirement never
reaches it. That service was built by `makeAppLayer` and handed to one other
layer's `Layer.provide`, but never merged into the layer `makeAppLayer`
actually returns, so it was available nowhere the step could reach it. See
[the WorkspaceCatalogs-not-merged incident](../incidents/workspacecatalogs-not-merged.md).

Building a service inside `makeAppLayer` is therefore not, by itself,
evidence that it is provided anywhere: check it appears in a `mergeAll` call,
not merely somewhere in a `Layer.provide` chain.

## How to check

Two compile-time assertions in `__test__/unit/layers/app.test.ts` cover the
two failure shapes above, and between them are what actually enforces this
rule — nothing at the `Action.run` call site does:

1. `Exclude<AppLayerRequirements, ActionServices>` must be `never`, where
   `AppLayerRequirements` is read off `ReturnType<typeof makeAppLayer>`. This
   catches a service resolved in a layer body that never reached a
   `Layer.mergeAll` call.[^app-layer-test]
2. `Exclude<InnerProgramRequirements, ActionServices>` must be `never`, where
   `InnerProgramRequirements` is read off `ReturnType<typeof innerProgram>`.
   This catches a service resolved inside a step's *method* body, which never
   shows up in assertion 1's channel at all.[^app-layer-test]

Run `pnpm typecheck` after adding or moving a service dependency. Either
assertion failing names the missing service in the compiler error; that error
is the signal this rule exists to produce. Neither assertion catches a
service that is wired but whose own layer fails to *construct* — nothing here
builds the graph, only checks its declared shape — so a green `pnpm
typecheck` after this change still needs the ordinary test suite to run
before it is trusted.

See [the compile-time layer guard decision](../decisions/compile-time-layer-guard.md)
for why the guard is a type-level assertion rather than a runtime check, and
[the unprovided-service gotcha](../gotchas/unprovided-service-is-not-a-type-error.md)
for how this presents to someone who has not yet read this rule.

[^app-layer]: `src/layers/app.ts`
[^app-layer-test]: `__test__/unit/layers/app.test.ts:32,41,70,73` (both
  `Exclude<…, ActionServices>` assertions)
