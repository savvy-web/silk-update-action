---
type: Decision
title: Guard makeAppLayer's requirement channel at compile time, not by convention
description: Two type-level assertions in a test file — not a runtime check anywhere in the production call path — are what stop an unprovided service from shipping as a defect on the runner.
status: draft
tags:
  - testing
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 36668c892bff250bacbcd7952460e89e9ede65daebe2f0ac056de6d57a35fe22
sources:
  - id: app-test
    resource: ../../__test__/unit/layers/app.test.ts
  - id: app-layer
    resource: ../../src/layers/app.ts
  - id: main-entry
    resource: ../../src/main.ts
  - id: action-run-type
    resource: ../../node_modules/@effected/github-actions/index.d.ts
---

# Guard makeAppLayer's requirement channel at compile time, not by convention

## Context

`Action.run` is declared as
`static readonly run: <E, R = never>(program: Effect.Effect<void, E, ActionServices | R>, options?: ActionRunOptions<R>) => Promise<void>`
(`node_modules/@effected/github-actions/index.d.ts:966`).[^action-run-type]
Because `options` is optional, `R` infers to whatever the program still
requires after every explicit layer is applied, and nothing forces a
caller to supply one for it. `src/main.ts` calls `Action.run(program)`
with no `{ layer }` argument at all[^main-entry] — by design, since
`makeAppLayer` is meant to satisfy everything `program` needs beyond the
core services `Action.run` itself injects. But that design is an
intention living in a comment; the type system does not check it. A
program with a leftover requirement typechecks at **any** leftover `R`,
with no "you forgot a layer" error at any call site, ever.

This is not a hypothetical failure mode. `PackageManagerUpgrade.layer`
resolves `PackageJsonFile` in its own layer body; `makeAppLayer` once
provided that service to `RuntimeUpgrade.layer` only. That state passed
a clean `tsc` and 588 (later 634) green tests, and every run in every
consumer repository died roughly 30ms in with `Service not found:
@effected/package-json/PackageJsonFile` — before the check run was even
created, so nothing appeared in the GitHub UI at all.

A second, structurally different instance of the same hole fired later.
`steps/peer-check.ts` resolves `WorkspaceCatalogs` inside its own step
body — a method, not a layer body — so that requirement never enters
`makeAppLayer`'s input channel at all; it lands on `innerProgram`'s
requirement channel instead. `makeAppLayer` built the `WorkspaceCatalogs`
layer and piped it into `ReleaseAge` alone, without merging it into the
layer the function returns.[^app-layer] That also typechecked and passed
634 tests, and died on the runner with `Service not found:
@effected/workspaces/WorkspaceCatalogs`.

Worse, the unit suite that exercised `innerProgram` could not have
caught it even if run against production wiring, because it supplied its
own `WorkspaceCatalogs.layerTest` double — the double was *more capable*
than the real `makeAppLayer`, so it hid exactly the wiring gap it looked
like it was exercising.

## Decision

Guard the requirement channel with two **compile-time** type assertions
in `__test__/unit/layers/app.test.ts`, not with a runtime check or a
review convention:

1. `type AppLayerRequirements = RequirementsOf<ReturnType<typeof
   makeAppLayer>>` and `type UnsatisfiedRequirements =
   Exclude<AppLayerRequirements, ActionServices>`, asserted `never` via
   `const _everyRequirementIsProvidedByActionRun: [UnsatisfiedRequirements]
   extends [never] ? true : UnsatisfiedRequirements = true`
   (`__test__/unit/layers/app.test.ts:29-45`).[^app-test] This is the
   layer's **input** channel — what `makeAppLayer` still needs from its
   caller after building everything it builds itself.
2. `type InnerProgramRequirements =
   RequirementsOfEffect<ReturnType<typeof innerProgram>>` and `type
   UnsatisfiedProgramRequirements = Exclude<InnerProgramRequirements,
   ActionServices>`, asserted `never` the same way
   (`__test__/unit/layers/app.test.ts:67-77`).[^app-test] This is the
   second assertion, added after the `WorkspaceCatalogs` incident: it
   checks what `innerProgram` still needs *after* it provides `appLayer`
   internally, which is the only way to see a requirement introduced by
   a step body rather than a layer body — the first assertion is
   structurally blind to that class of bug, because a method-level
   `yield*` never touches the layer's own input channel.

When either exclusion is non-empty, the leftover service type stops
being assignable to `true` and the resulting `tsc` error names the
missing service directly. Because these are ordinary `.ts` files under
`__test__/**`, which is inside the project's `tsconfig` `include`, this
fails `pnpm typecheck` at pre-commit and in CI — not only inside a
`vitest` run. Both `it` blocks in the file are deliberately weak
runtime assertions (`expect(...).toBe(true)`, `expect(makeAppLayer(true)).toBeDefined()`);
the file's own doc comment says the real teeth are the type annotations
above them, and the runtime checks exist only to prove the module was
evaluated at all.

The counter-measure to the `WorkspaceCatalogs` incident specifically was
merging `workspaceCatalogs` into `domainLayers` in `makeAppLayer`
(`src/layers/app.ts:158`) rather than piping it only into
`ReleaseAge`[^app-layer] — the fix for the wiring bug is separate from,
and prerequisite to, the guard being able to pass again.

## Alternatives rejected

- **Trust `Action.run(program)`'s type signature to catch a missing
  layer.** Directly falsified: the signature's optional `options`
  parameter is precisely why nothing catches it — `R` infers to whatever
  is left and the call always typechecks.
- **Rely on the test suite to catch it via a failing run.** Falsified
  twice over: 588 and 634 green tests respectively did not catch either
  incident, because a service missing from `makeAppLayer` was still
  satisfiable by a test double supplying its own layer for that service.
- **Rely on code review to catch a missing `Layer.provide`.** The
  `WorkspaceCatalogs` incident is the counterexample: the service *was*
  built inside `makeAppLayer`, and the mistake was piping it into one
  consumer without also merging it into the returned layer — a diff a
  reviewer would plausibly read as "wired," not as "wired to the wrong
  place."

See [the general shape of this hole](../gotchas/unprovided-service-is-not-a-type-error.md),
and the two incidents themselves:
[the v4.6.0 PackageJsonFile release](../incidents/v4-6-0-packagejsonfile-unprovided.md)
and
[the WorkspaceCatalogs merge gap](../incidents/workspacecatalogs-not-merged.md).
[Adopting a service into a second consumer](../conventions/adopting-a-service-is-a-wiring-change.md)
is the convention this guard exists to enforce.

## Consequences

- Adopting any service into a second consumer, or moving a service's
  resolution from a layer body into a step body, is now a change this
  guard can reject at `pnpm typecheck` time rather than at runtime on a
  consumer's repository.
- The guard only covers a **missing** provide, not a **broken** one.
  Nothing in this suite builds the actual layer graph, so a layer that
  is wired to the right place but fails to construct (a bad
  configuration value, a runtime exception inside `Layer.effect`) still
  ships undetected by this guard.
- The guard's teeth depend on three things staying true, none of them
  self-enforcing: `ActionServices` must be an honest list of what
  `Action.run` actually constructs (if the kit widens that alias to
  include something it does not build, the guard subtracts a lie and
  passes); nothing in `makeAppLayer`'s wiring may let an `any` or
  `unknown` leak into its inferred requirement channel (an `Exclude<any,
  …>` stays `any`, and a stray `as` can erase the channel the guard
  reads); and every domain service must keep resolving its own
  dependencies inside its `layer` body rather than inside an
  individual method, because a method-level resolution only reaches
  `InnerProgramRequirements`, not `AppLayerRequirements` — abandoning
  that convention for one service silently reopens the hole this guard
  closes for every other service.

## What would change the answer

A future version of `Action.run` that made `options` non-optional when
`R` is non-`never`, or that otherwise forced a layer at the call site,
would let this guard be simplified or removed — the check exists because
nothing at the call site enforces it today.

[^app-test]: `__test__/unit/layers/app.test.ts`
[^app-layer]: `src/layers/app.ts`
[^main-entry]: `src/main.ts`
[^action-run-type]: `node_modules/@effected/github-actions/index.d.ts:966`
</content>
