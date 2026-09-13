---
type: Gotcha
title: A fixture that forgets to seed its own state decodes the host workflow's persisted data and passes
description: Without vitest.setup.ts stripping runner-owned env prefixes, ActionState.get can succeed against real STATE_* pairs left by the CI job running the test, so a test passes for the wrong reason and only under a real runner.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - testing
  - ci
resource: ../../vitest.setup.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 72866b1833aafa4dd5ee7752aa2fa35d02ac2d071263082e136c50f743a535eb
sources:
  - id: vitest-setup
    resource: ../../vitest.setup.ts
  - id: vitest-config
    resource: ../../vitest.config.ts
---

# A fixture that forgets to seed its own state decodes the host workflow's persisted data and passes

## What you see

A test suite exercising `ActionState`, `ActionInput` or `ActionEnvironment`
passes locally and in CI. Nothing distinguishes a pass that came from the
fixture's own seeded values from a pass that came from whatever the
process environment happened to already contain.

## What you will wrongly conclude

That a passing assertion over a service reading `process.env` proves the
suite's own fixture supplied the value being asserted on.

## What is actually true

`vitest.setup.ts` deletes every `process.env` key whose name starts with
one of five prefixes the GitHub Actions runner owns — `INPUT_`, `GITHUB_`,
`RUNNER_`, `ACTIONS_` and `STATE_` — before any test file's own imports
are evaluated.[^vitest-setup] It is registered as **`setupFiles`**, not
`globalSetup`: `globalSetup` runs in a separate process from the worker
that actually imports `src/`, so anything it deleted there would be
invisible to the code under test, while `setupFiles` runs inside the same
worker process before the import happens.[^vitest-config]

This exists to prevent two different failure classes, and the second is
the sharp one. First, all three entry points
(`src/pre.ts`, `src/main.ts`, `src/post.ts`) end in
`if (process.env.GITHUB_ACTIONS) await Action.run(...)`; a suite that
imports one of those modules under a real runner's environment would run
the entire phase as an import side effect — including a live
`GitHubToken.provision` call — mid-suite. Second, and more insidious:
`ActionInput` resolves `INPUT_*`, `ActionEnvironment` snapshots `GITHUB_*`
and `RUNNER_*` at layer construction, and `ActionState` reads `STATE_*`
pairs. Any of the first four prefixes leaking in mostly produces a
**wrong** value, which tends to fail an assertion outright. `STATE_*` does
not: `ActionState.get` decodes through each caller's own Schema, so if a
test's fixture forgets to seed its own state and the ambient environment
happens to carry the **host CI workflow's own persisted `STATE_*`
pairs**, the read succeeds, decodes cleanly (because it is real,
well-formed data — just someone else's), and the test passes for a reason
that has nothing to do with what the test author intended to assert.
That failure mode is invisible locally, because a developer's shell
rarely carries `STATE_*` variables at all — it only manifests under a
real runner, which is precisely where nobody is watching a test suite's
internals.

`TEST_LOGS` — the suites' own opt-in for log output — is deliberately
outside every stripped prefix, so it is not caught by this net.

## How to check

- Confirm `vitest.setup.ts` is wired as `setupFiles` (via
  `AgentPlugin.discover()`, which points each project's `setupFiles` at
  it), not `globalSetup` — the distinction is what makes the strip
  visible to the worker process that imports `src/`.[^vitest-config]
- The denylist is only as complete as the last time it was checked
  against what `@effected/github-actions` actually reads from
  `process.env`; if a future kit version reads a new prefix, this list
  needs updating by hand, not by discovery.
- This is unverified in one respect: whether seeding a real `STATE_*`
  environment before running the current suite would change any test's
  result today. The strip was added as defence, not in response to an
  observed failure in this repository, so no test has been run against a
  seeded `STATE_*` environment to demonstrate the difference exists here.

[^vitest-setup]: `vitest.setup.ts`
[^vitest-config]: `vitest.config.ts`
