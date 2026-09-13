---
type: Incident
title: "v4.6.0: every consumer run died on an unprovided PackageJsonFile"
description: PackageManagerUpgrade.layer began resolving PackageJsonFile in its layer body; makeAppLayer provided that service to RuntimeUpgrade.layer only, and the leftover requirement typechecked cleanly under Action.run's optional layer argument.
status: draft
occurred: "2026-08-16"
guard: ../../__test__/unit/layers/app.test.ts
tags:
  - ci
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: f1abb5faef247d176f48aa4ec9cf867b0669960604c252c5f6f182d04499db94
sources:
  - id: app-layer
    resource: ../../src/layers/app.ts
  - id: app-test
    resource: ../../__test__/unit/layers/app.test.ts
  - id: package-manager-upgrade
    resource: ../../src/services/package-manager-upgrade.ts
  - id: runtime-upgrade
    resource: ../../src/services/runtime-upgrade.ts
  - id: main-ts
    resource: ../../src/main.ts
---

# v4.6.0: every consumer run died on an unprovided PackageJsonFile

## Occurred

2026-08-16, the `4.6.0` release commit.

## Where it surfaced

Every consumer repository pinning this action ran the released build and
failed the same way, on every invocation, with no exception: the run died as
an uncaught defect roughly 30ms into `main`, before `CheckRun.withCheckRun`
had created the check run. A consumer saw a red job with no check-run
annotation at all — the failure was invisible in the GitHub UI beyond the
raw job log.

## What it looked like

`Service not found: @effected/package-json/PackageJsonFile` thrown as a
defect, not a typed `Effect` failure — nothing in the program's declared
error channel, so nothing an `Effect.catch` in `program.ts` could have
intercepted even if one had been placed there.

## Root cause (as a mechanism)

`PackageManagerUpgrade.layer` began resolving `PackageJsonFile` (from
`@effected/package-json`) inside its own layer body, alongside
`NpmRegistry`.[^package-manager-upgrade] `makeAppLayer` provided
`PackageJsonFile.layer` to `RuntimeUpgrade.layer` — which also resolves it in
its layer body[^runtime-upgrade] — but not to `PackageManagerUpgrade.layer`.
That left `PackageJsonFile` in the composed layer's requirement channel.

Nothing caught it there. `src/main.ts` calls `Action.run(program)` with no
second argument.[^main-ts] `Action.run` is declared
`<E, R = never>(program: Effect.Effect<void, E, ActionServices | R>, options?:
ActionRunOptions<R>) => Promise<void>` — because `options` is optional, `R`
infers to whatever `program` still requires after `makeAppLayer` is applied,
and nothing at that call site forces a layer to be supplied for it. The
leftover `PackageJsonFile` requirement was absorbed into `R` and the call
typechecked cleanly. `tsc` was clean and the full suite (588 tests at the
time) was green, because nothing in the suite built the actual
`makeAppLayer()` composition and asked whether every layer's inputs were
satisfied — each service's own tests supplied it a fresh test double for
whatever it needed.

## Guard

`__test__/unit/layers/app.test.ts` now asserts, at compile time, that
`Exclude<AppLayerRequirements, ActionServices>` is `never`, where
`AppLayerRequirements` is read off `ReturnType<typeof makeAppLayer>`.[^app-test]
Reinstating the bug — providing `PackageJsonFile` to only one of the two
consuming layers — reproduces `error TS2322: Type 'boolean' is not
assignable to type 'PackageJsonFile'`, naming the missing service directly in
the compiler error. Because the assertion lives in an ordinary `.ts` file
under `__test__/**`, which is inside the project's `tsconfig` `include`, it
fails `pnpm typecheck` at pre-commit and in CI — not only inside a `vitest`
run, and not only on a code path that has to execute to be checked. The fix
itself was providing `PackageJsonFile.layer` to both `PackageManagerUpgrade.layer`
and `RuntimeUpgrade.layer` in `src/layers/app.ts`.[^app-layer]

## What it taught

A domain service resolved in a layer body rises into `makeAppLayer`'s
requirement channel the moment it is added, and nothing at the `Action.run`
call site can see whether that channel is fully satisfied — see
[the gotcha this incident is an instance of](../gotchas/unprovided-service-is-not-a-type-error.md).
The counter-measure had to be written as a separate compile-time assertion
because the framework's own type signature cannot express "reject a leftover
requirement" — see
[the decision to guard the channel at compile time](../decisions/compile-time-layer-guard.md).
It is also the concrete case for the general rule that
[adopting a service into a second consumer is a layer-wiring change, not merely a call-site change](../conventions/adopting-a-service-is-a-wiring-change.md):
the diff that shipped this bug added a call site inside
`PackageManagerUpgrade.layer`'s body and never touched `makeAppLayer`'s
provide list, which is exactly the shape the convention now names. See also
[the decision to adopt `@effected/package-json` for surgical field edits only](../decisions/package-json-modify-only.md),
which is the change that introduced the `PackageJsonFile` dependency in the
first place.

[^app-layer]: `src/layers/app.ts`
[^app-test]: `__test__/unit/layers/app.test.ts`
[^package-manager-upgrade]: `src/services/package-manager-upgrade.ts`
[^runtime-upgrade]: `src/services/runtime-upgrade.ts`
[^main-ts]: `src/main.ts`
</content>
