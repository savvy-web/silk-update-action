---
type: Incident
title: The first check-peers dogfood run died on an unmerged WorkspaceCatalogs
description: steps/peer-check.ts resolved WorkspaceCatalogs in its own step body rather than a layer body; makeAppLayer built the layer and piped it into ReleaseAge alone without merging it into the layer it returns, so the requirement never entered the layer-side guard's input channel.
status: draft
occurred: "2026-08-20"
guard: ../../__test__/unit/layers/app.test.ts
tags:
  - ci
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-19T03:30:32Z
  body_sha256: cefc9cd6cd481aca973b67a741d95b415daac72d2291f45404854f408e830c51
sources:
  - id: app-layer
    resource: ../../src/layers/app.ts
  - id: app-test
    resource: ../../__test__/unit/layers/app.test.ts
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: program-inner-test
    resource: ../../__test__/unit/program.inner.test.ts
---

# The first check-peers dogfood run died on an unmerged WorkspaceCatalogs

## Occurred

2026-08-20, during development of the `check-peers` feature, dogfooded
against `savvy-web/systems` via a `dev`-branch build before the feature
merged.

## Where it surfaced

The first end-to-end run of the newly added `check-peers` gate, exercised as
a real consumer run against `savvy-web/systems` (which at the time pinned
this action's `dev` branch permanently, letting a rebuilt `dist` be tested
against a real monorepo; it has pinned `@v4` since 2026-08-20). This was the first of three runs on that consumer that each
failed differently before the feature was proven — see
[the savvy-web/systems consumer](../consumers/savvy-web-systems.md).

## What it looked like

`Service not found: @effected/workspaces/WorkspaceCatalogs` thrown as a
defect, on a build that had passed `tsc` cleanly and 634 green tests.

## Root cause (as a mechanism)

`steps/peer-check.ts` resolves `WorkspaceCatalogs` inside its own step
body — a `yield*` inside a method, not inside a `Layer.effect` layer
body.[^peer-check-step] That placement matters structurally: a requirement
introduced this way never enters the layer's own input channel at all. It
instead surfaces on `innerProgram`'s requirement channel, one level up from
where the layer-side compile-time guard looks.

`makeAppLayer` built the `WorkspaceCatalogs` layer (as `workspaceCatalogs`)
and piped it into `ReleaseAge`'s provide alone, without also merging it into
the `domainLayers` composition the function returns.[^app-layer] That
distinction — providing a built layer *inward* to one consumer versus
merging it *outward* into the layer the function exposes — is invisible in a
diff review: the service is genuinely built and genuinely wired to
something, just not to everything that needs it.

Two things let this ship past every existing signal. First, the
layer-side compile-time guard (`AppLayerRequirements`, the assertion that
closed the [v4.6.0 incident](v4-6-0-packagejsonfile-unprovided.md)) checks
only `makeAppLayer`'s **input** channel — what it still needs from its
caller — and says nothing about what it **outputs**, so a service the
program resolves and the layer never exposes is structurally invisible to
it. Second, the unit suite exercising `innerProgram`
(`__test__/unit/program.inner.test.ts`) supplied its own
`WorkspaceCatalogs.layerTest` double, so the double satisfied
`peerCheckStep`'s requirement in tests regardless of whether production
wiring did the same — the double was *more capable* than production, which
hid exactly the wiring gap it looked like it was exercising.[^program-inner-test]

## Guard

`__test__/unit/layers/app.test.ts` gained a second, structurally different
compile-time assertion after this incident: `Exclude<InnerProgramRequirements,
ActionServices>` must be `never`, where `InnerProgramRequirements` is read off
`ReturnType<typeof innerProgram>` **after** `innerProgram` provides `appLayer`
internally.[^app-test] Because this reads the requirement channel of the
whole program rather than of `makeAppLayer` alone, it sees a requirement
introduced by a step body that the layer-side assertion structurally cannot.
Reinstating the bug reproduces `error TS2322: Type 'boolean' is not
assignable to type 'WorkspaceCatalogs'`. The fix was merging
`workspaceCatalogs` into the `domainLayers` `Layer.mergeAll` call in
`src/layers/app.ts` rather than only piping it into `ReleaseAge`.[^app-layer]

## What it taught

A service built inside `makeAppLayer` is not thereby provided to everything
that needs it — check that it appears in a `mergeAll` (or equivalent
outward-facing provide), not merely that it is piped somewhere via
`Layer.provide`. See
[the gotcha this incident is an instance of](../gotchas/unprovided-service-is-not-a-type-error.md)
and
[the decision that guards both requirement channels at compile time](../decisions/compile-time-layer-guard.md).
The sharper lesson is about the test double, not the layer:
[a double more capable than production hides the wiring bug it appears to exercise](../gotchas/double-more-capable-than-production.md).
This is also the concrete case for
[adopting a service into a second consumer being a layer-wiring change](../conventions/adopting-a-service-is-a-wiring-change.md) —
here the "second consumer" was a step body resolving a service the layer
graph had only wired for one other consumer.

[^app-layer]: `src/layers/app.ts`
[^app-test]: `__test__/unit/layers/app.test.ts`
[^peer-check-step]: `src/steps/peer-check.ts`
[^program-inner-test]: `__test__/unit/program.inner.test.ts`
</content>
