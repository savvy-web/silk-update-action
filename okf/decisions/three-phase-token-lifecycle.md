---
type: Decision
title: Run as three phases around a GitHub App token, not a personal access token
description: Why the action provisions a short-lived installation token in pre, consumes it in main, and revokes it in post — always — rather than reading a long-lived PAT once.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: cfdf07f835f97bd0ba6a42c337ad516392060dab2a8bfcbd5fe19cc48c868f2f
sources:
  - id: pre-ts
    resource: ../../src/pre.ts
  - id: post-ts
    resource: ../../src/post.ts
  - id: main-ts
    resource: ../../src/main.ts
  - id: state-ts
    resource: ../../src/state.ts
  - id: layers-app
    resource: ../../src/layers/app.ts
---

# Run as three phases around a GitHub App token, not a personal access token

## Context

`action.yml` wires three separate entry points — `pre`, `main`, `post` — each
its own Node process. GitHub Actions gives `pre` and `post` no return value
back to `main`; the only channel between the three processes is the
runner's persisted `STATE_*` environment, which `ActionState` reads and
writes.[^state-ts] Whatever authenticates the GitHub API calls in `main` has
to be minted before `main` runs and cleaned up after it, even when `main`
itself fails.

## Decision

Authentication is a GitHub App installation token, provisioned in `pre`,
consumed in `main`, and revoked in `post` — unconditionally, on every run
outcome including a failed `main`.

`pre.ts` parses `app-client-id` and `app-private-key` via `ActionInput`
(never a bare `Config` read — see
[read inputs via ActionInput](../conventions/read-inputs-via-actioninput.md)),
reads the repository owner off `ActionEnvironment`, and calls
`GitHubToken.provision({ appId, privateKey, owner, required })`.[^pre-ts] The
kit takes credentials explicitly rather than reading the action inputs
itself, and the `required` field is a permission map
(`{ contents: "write", pull_requests: "write", checks: "write" }`) that
`provision` verifies against what GitHub actually granted before persisting
the token — so a misconfigured App installation fails here, in `pre`, rather
than mid-run in `main` with a bare 403 on whichever API call happens to need
the missing scope first.[^pre-ts] `pre` also records a wall-clock start time
to `ActionState` under `STATE_KEYS.startTime`, using the `StartTimeState`
schema class, for `post`'s duration report.[^state-ts] `pre`'s own domain
layer, `PreLive`, is just `GitHubApp.layer` — the kit's App layer is
self-contained, with no separate octokit auth-app strategy or HTTP client to
wire.[^pre-ts]

`main.ts` reads the token back through `GitHubToken.clientLayer()`, built
inside `makeAppLayer` and wrapped in `Layer.orDie` so a missing or expired
token is a fatal defect rather than an error every caller must
handle.[^layers-app] `main.ts` itself does no token plumbing — it is a
four-line guarded call to `Action.run(program)` with no `{ layer }` argument,
because `program`'s own requirements should be exactly what `Action.run`
already injects.[^main-ts] Every resource call in `main` also resolves a
`Repo` service, obtained via `Repo.layerFromConfig()` and likewise wrapped in
`Layer.orDie`.[^layers-app] `Repo` is left in each domain method's own
requirement channel rather than captured once when a service's layer is
built, which is what keeps `Repo.provide(ref)` meaningful for a future caller
that targets a different repository than the one the workflow runs in.

`post.ts` always runs, even when `main` fails, because GitHub Actions runs a
`post` step regardless of the job's outcome (subject to its own execution
conditions). It reads the persisted `StartTimeState` with `state.getOptional`
— not `state.get` — so a run where `pre` never recorded one (a `pre`-phase
failure) is silent rather than raising an error, then reports total
duration.[^post-ts] It then calls `GitHubToken.dispose()`, wrapped in an
`Effect.catch` so a revocation failure only logs a warning, and the whole
`post` effect is additionally wrapped in `Effect.catchDefect` so a defect in
either half never fails the workflow — defense in depth on top of the
`Effect.catch`.[^post-ts] `dispose()` is a documented no-op if `pre` never
provisioned a token at all.[^post-ts] `post`'s own domain layer, `PostLive`,
mirrors `pre`'s: `GitHubApp.layer`.[^post-ts]

All three entry points carry an identical `if (process.env.GITHUB_ACTIONS)`
guard around their module-level `Action.run(...)` call.[^pre-ts][^post-ts][^main-ts]
Without it, merely *importing* the module — which a test file, a coverage
pass, or an editor's module graph traversal will do — would run the whole
phase as a side effect, including a live token provisioning or revocation
call.

## Alternatives rejected

- **A single personal access token read once.** Rejected: a PAT does not
  expire on its own (so a leaked token stays valid indefinitely), carries
  coarse repository- or organization-wide permissions rather than the
  fine-grained scopes `required` checks for, and commits made with it are not
  attributable to or verifiable as coming from an App identity the way the
  Git Data API path (see
  [GitHub App and verified commits](github-app-and-verified-commits.md)) is.
- **Reading `app-client-id` / `app-private-key` inside `main`.** Rejected:
  the scope check has to happen before any API work is attempted, and `pre`
  is the phase that runs before the check run even exists, so failing there
  produces a clear job-level failure rather than a check-run failure buried
  among other log lines.
- **`main.ts` building its own token layer via `{ layer }`.** Rejected in
  favor of `program`'s requirements resolving to exactly what `Action.run`'s
  own runtime already provides — see
  [platform stays in the requirement channel](platform-stays-in-requirement-channel.md)
  for the general form of this rule and its one known hole.

## Consequences

- The token lifecycle depends on `post` actually running; a workflow
  configuration that skips `post` steps on cancellation would leak a token
  until its own natural expiry (GitHub App installation tokens expire after
  at most one hour regardless).
- `ActionState` is the only channel between the three processes, so any new
  cross-phase value needs its own `Schema.Class` beside `StartTimeState` and
  its own key in `STATE_KEYS` — see `src/state.ts`.[^state-ts]
- Every unit test that does not stand up a `pre` phase reads back no
  persisted token, which is why `resolveSignoff()` and similar readers must
  degrade rather than fail — see
  [GitHub App and verified commits](github-app-and-verified-commits.md).

[^pre-ts]: `src/pre.ts`
[^post-ts]: `src/post.ts`
[^main-ts]: `src/main.ts`
[^state-ts]: `src/state.ts`
[^layers-app]: `src/layers/app.ts`
