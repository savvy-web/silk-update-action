---
type: Convention
title: Declare a service's layer as a static field inside the class body
description: Every domain service exposes its layer as `static readonly layer`, declared inside the class body rather than assigned after it, and resolves its own dependencies inside that layer so each member's requirement channel is never.
status: draft
stale_after: 2027-03-12T00:00:00Z
tags:
  - bundle
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: fe1f6f26effdf39dc2b7770e6989b367e1334857eb0b51e02ba876b602fe8ff8
sources:
  - id: report-service
    resource: ../../src/services/report.ts
  - id: branch-service
    resource: ../../src/services/branch.ts
  - id: changesets-service
    resource: ../../src/services/changesets.ts
  - id: app-layer
    resource: ../../src/layers/app.ts
---

# Declare a service's layer as a static field inside the class body

Give every domain service a `static readonly layer = Layer.effect(this, …)`
(or `Layer.succeed`) declared **inside the class body**, matching the
`.layer` / `.layer(opts)` convention the `@effected/*` kit itself uses on its
own service classes. Do not attach a layer to a class by assigning to it
after the class declaration.[^report-service][^branch-service][^changesets-service]

Resolve everything that layer's members need — other services, ambient
infrastructure like a spawner — **inside the layer body**, once, rather than
inside an individual method. `Report.layer` is the clean example: it yields
`PullRequestTag` and calls `resolveSignoff()` once, then closes over both
results in the returned methods, so `createOrUpdatePR` and
`generateCommitMessage` both read a value that was resolved a single time
rather than re-resolving it per call.[^report-service]

## Why

A member attached to a class by post-class assignment (`Foo.layer =
Layer.succeed(...)`) rather than declared in the class body is tree-shaken
out of the bundled `dist` under this project's `"sideEffects": false`
build — and it fails only in production, because the test suite runs the
source, not the bundle. Declaring the field inside the class body is what
keeps it reachable in the built artifact.

Resolving a member's dependencies in the layer body rather than in the
method is what keeps that method's own requirement channel `never`. If a
service instead yields another service inside one of its methods, that
requirement rises into the *method's* `R`, not the layer's — and the
compile-time guard over `makeAppLayer`'s requirement channel is structurally
blind to a requirement stuck on a method rather than the layer: it only
inspects `ReturnType<typeof makeAppLayer>`. This has shipped as a real
defect: a service resolved in a step body reached `makeAppLayer`, was built
there, and was then piped into one consumer's layer without being merged
into the returned layer at all — the app layer's own guard could not see
it, because the miss was in the layer's *output*, not its declared *input*.

## How to check

- `grep -n "static readonly layer" src/services/*.ts` should show one hit
  per domain service class, inside the class body (visible in the same
  `grep -n` as the class's other members, not appended after a closing
  brace).
- For any service with more than one internal dependency, confirm the
  layer body yields each dependency once via `Effect.gen` and closes the
  returned method values over the resolved bindings — as `Report.layer`
  does for `PullRequestTag` and `resolveSignoff()` — rather than yielding
  inside an individual method.[^report-service]
- Cross-check `src/layers/app.ts`: every domain layer wired there should
  name exactly the services its own layer body resolves, and a layer
  built inside `makeAppLayer` must be **merged into** the layer it returns
  (via `Layer.mergeAll`), not merely piped into one consumer's
  `Layer.provide` — the latter satisfies that one consumer while leaving
  the service absent from the composed layer everything else receives.[^app-layer]

[^report-service]: `../../src/services/report.ts`
[^branch-service]: `../../src/services/branch.ts`
[^changesets-service]: `../../src/services/changesets.ts`
[^app-layer]: `../../src/layers/app.ts`
