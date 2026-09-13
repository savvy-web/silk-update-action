---
type: Decision
title: Leave platform services in makeAppLayer's requirement channel instead of building private copies
description: makeAppLayer never constructs FileSystem, Path, HttpClient or ChildProcessSpawner — every layer that needs them leaves the requirement in the returned layer's input channel for Action.run's own runtime to satisfy, so the bundle never carries a second copy of the Node platform.
status: draft
tags:
  - bundle
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 6373f5ee53fab9d73bcb4d32357649192c4389015e204600edd0f19ffe009742
sources:
  - id: layers-app
    resource: ../../src/layers/app.ts
  - id: app-test
    resource: ../../__test__/unit/layers/app.test.ts
  - id: package-json
    resource: ../../package.json
---

# Leave platform services in makeAppLayer's requirement channel instead of building private copies

## Context

`Action.run`'s own runtime already provides `ActionServices` — the platform
primitives (`FileSystem`, `Path`, `HttpClient`, `ChildProcessSpawner`, among
others) that most of this action's domain layers need. `makeAppLayer`
composes every kit and domain layer this action uses, and several of them —
`NpmRegistry`, the `@effected/workspaces` layers, `PackageJsonFile`,
`PackageTarball` — declare exactly these platform services as their own
requirements.[^layers-app]

## Decision

`makeAppLayer` never builds `NodeServices.layer`, `FetchHttpClient.layer`, or
any other platform-shaped layer of its own. Every domain or kit layer that
needs a platform primitive is composed bare, and its unmet requirement is
left in `makeAppLayer`'s own returned requirement channel rather than being
satisfied locally — `NpmRegistry.layer`, `PackageJsonFile.layer`, and
`PackageTarball.layer` are each used exactly this way, commented at each
site as deliberate.[^layers-app] The comment at the `NpmRegistry`/
`PackageJsonFile` construction states the reasoning directly: building the
platform locally "instead meant the action shipped a second copy of the Node
platform and the fetch client in its bundle, and forced a direct
`@effect/platform-node` dependency the program has no business
naming."[^layers-app]

The current topology has two further layers of the same posture:

- `WorkspaceCatalogs` (from `@effected/workspaces`) is composed inside
  `domainLayers` and merged into the layer `makeAppLayer` returns, rather
  than only being piped into `ReleaseAge` internally — a distinction with a
  documented production incident behind it, since a layer built but not
  merged into the return value is invisible to both the requirement-channel
  guard and to any other consumer that needs it.[^layers-app]
- The live runtime-resolver path is more selective than "always bare":
  `NodeResolver.layer` needs only `HttpClient.HttpClient`, an
  `ActionServices` member, so it stays bare; `DenoResolver.layer` and
  `BunResolver.layer` are each explicitly provided
  `@effected/runtimes`' `GitHubClient.layerDefault`, because that layer is
  genuinely self-contained (`E = never`, pre-wiring its own auth and
  `FetchHttpClient`) rather than a second copy of a platform service already
  in `ActionServices`.[^layers-app]

Nothing in the production call path — `Action.run(program)`'s optional
`options` parameter — forces a layer to be passed for whatever is left in
that channel; a leftover requirement typechecks regardless.[^app-test] The
contract this decision states — "everything left in `makeAppLayer`'s
requirement channel is an `ActionServices` member" — is therefore checked at
compile time, not left to convention: `__test__/unit/layers/app.test.ts`
asserts `Exclude<AppLayerRequirements, ActionServices>` is `never`, reading
`AppLayerRequirements` off `ReturnType<typeof makeAppLayer>`.[^app-test] See
[the compile-time layer guard](compile-time-layer-guard.md) for that
assertion's own scope and blind spots.

This decision is also why a single-copy measurement of the installed kit
packages is meaningful evidence rather than incidental: leaving platform
services (and everything downstream of them) in the requirement channel is
part of what keeps each `@effected/*` package resolving to exactly one copy
in the bundle — see
[the 2026-09-04 single-copy probe](../measurements/kit-single-copy-probe-2026-09-04.md).

## Alternatives rejected

- **Build a local `NodeServices.layer` / `FetchHttpClient.layer` inside
  `makeAppLayer`.** This is what an earlier version did, and it is rejected
  because it bundles a second copy of the Node platform bundle and the fetch
  client into `dist`, for no behavioral benefit — `Action.run`'s own runtime
  already provides one copy through `ActionServices`.
- **Depend on `@effect/platform-node` directly from `src/`.** Rejected for
  the same reason: it is a real, declared `package.json` dependency, but
  nothing under `src/` imports it — a grep for `platform-node` under `src/`
  returns only the explanatory comment in `layers/app.ts`, not an
  import.[^layers-app] Whether the `package.json` declaration is still
  load-bearing (for types, or for transitive resolution) versus vestigial
  has not been checked one way or the other; this decision does not claim
  either.

## Consequences

- A future domain layer added to `makeAppLayer` that resolves a platform
  primitive is correct to leave that requirement in the channel — it does
  not need its own `Layer.provide` of a platform layer, and adding one would
  be the regression this decision exists to prevent.
- The compile-time guard only catches a *missing* provide of a service
  `ActionServices` was never going to supply; it does not catch a layer that
  is wired but fails to construct, and it is only as trustworthy as
  `ActionServices` being an accurate list of what `Action.run` actually
  constructs.
- Whether `@effect/platform-node` remains a necessary declared dependency of
  this package (versus a leftover that could be dropped) is explicitly
  unverified as of this writing.

[^layers-app]: `src/layers/app.ts`
[^app-test]: `__test__/unit/layers/app.test.ts`
