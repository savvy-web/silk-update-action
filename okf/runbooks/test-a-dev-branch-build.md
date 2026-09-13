---
type: Runbook
title: Test a dev-branch build end to end against a real consumer
description: Rebuild dist on dev and run it through a real consumer workflow, since a bundled action can only be exercised end to end by the committed dist a consumer actually executes.
status: draft
tags:
  - ci
  - testing
resource: ../../.github/workflows/silk-update.yml
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 57177fd4683b8c11ff8da3dbf8f0c9bccca97dd5c374a511041f57dc7b5820a1
sources:
  - id: silk-update-workflow
    resource: ../../.github/workflows/silk-update.yml
  - id: release-workflow
    resource: ../../.github/workflows/release.yml
---

# Test a dev-branch build end to end against a real consumer

This action is bundled: a consumer pinning `@dev` executes the committed
`dist/{pre,main,post}.js`, not `node_modules`. A short-lived feature branch
cannot be tested this way because nothing consumes it — only a push to the
long-lived `dev` branch is.

**Trigger:** a change to `src` (a normal edit, or the aftermath of
[dogfooding a first-party dependency](dogfood-a-first-party-dependency.md))
needs to be proven against a real workspace before it merges toward `main`.

## Steps

1. Run `pnpm build:prod`. The committed bundle is the artifact under test;
   skipping this step tests the previous build.
2. Commit `src` and `dist` together — a `dist` stale relative to `src` is a
   silently wrong test, since the consumer runs whatever is committed.
3. Push to `dev`.
4. Trigger a consumer's workflow and read the run, using whichever of these
   fits the change:
   - **This repository's own workflow.** `.github/workflows/silk-update.yml`
     invokes `uses: savvy-web/silk-update-action@v4` at line
     79.[^silk-update-workflow]
     Flip that ref to `@dev` to run the committed dev-branch build against
     this repository itself, then dispatch or push to `dev` (its trigger is
     `push: branches: [dev]`, `.github/workflows/silk-update.yml:11-12`) and
     watch the run.
   - **The release workflow.** `.github/workflows/release.yml` calls the
     shared reusable workflow via
     `uses: savvy-web/.github/.github/workflows/release.yml@main` at line
     23.[^release-workflow] Flip that ref to `@dev` to exercise the release
     path itself against the dev-branch build.
   - **A second, permanently-pinned consumer — usually the better test, and
     it needs no ref flip at all.** `savvy-web/systems` pins
     `@dev` permanently; dispatch its `Update Silk Dependencies` workflow
     directly. See
     [savvy-web/systems](../consumers/savvy-web-systems.md).
5. Watch the triggered run (for example `gh run watch`) to completion and
   read its outcome — a real workspace, real config-dependency plugins, and
   (where the workflow reaches that step) a real pull request.
6. Once verification is done, or once the release this build supports has
   been cut, revert whichever ref was flipped in step 4 back to its release
   pin (`@v4` or `@main`).

## Observable end state

The triggered workflow run against the dev-branch build has completed —
either succeeding end to end against a real workspace, or failing in a way
that names the actual defect rather than a wiring gap this repository's own
suite cannot see — and any ref flipped in step 4 is reverted to its release
pin.

## Related

[dogfood a first-party dependency](dogfood-a-first-party-dependency.md) is
the usual reason a dev-branch build needs this kind of proof before it can
merge.
[Never rewrite dev](../conventions/never-rewrite-dev.md) explains why the
build under test has to live on the long-lived `dev` branch rather than a
disposable one.

[^silk-update-workflow]: `.github/workflows/silk-update.yml`
[^release-workflow]: `.github/workflows/release.yml`
