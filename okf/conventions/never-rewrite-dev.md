---
type: Convention
title: Never rewrite the dev branch — commit, don't squash, rebase, or force-push
description: dev is the long-lived feature branch. Commit ordinary commits directly to it; never squash, rebase, or force-push it, because a consumer pinning `@dev` runs the committed dist and that consumer's CI is pinned to whatever dev currently is.
stale_after: 2027-03-12T00:00:00Z
tags:
  - release
  - ci
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: ee4079ce15e01b8c6cbb4e3ed09af2039dc60a047075d5ef106f20750b7a01dd
sources:
  - id: branch-sync-workflow
    resource: ../../.github/workflows/branch-sync.yml
  - id: silk-update-workflow
    resource: ../../.github/workflows/silk-update.yml
  - id: action-config
    resource: ../../action.config.ts
---

# Never rewrite the dev branch — commit, don't squash, rebase, or force-push

## Rule

Commit feature work to `dev` directly, with ordinary commits, the way any
other long-lived branch is worked on. Never squash it, never rebase it, and
never force-push it. A `dev → main` pull request — opened by hand or by the
`promote` job in `branch-sync.yml`[^branch-sync-workflow] — is the correct way to
finalize a batch of work; GitHub squashes at merge without rewriting `dev`
itself first, which is what makes that path safe and an ad hoc history
rewrite of `dev` unsafe.

## Why

This action is **bundled**: `action.config.ts` drives a build that inlines
every runtime dependency into `dist/{pre,main,post}.js`,[^action-config] and a
consumer workflow that writes `uses: savvy-web/silk-update-action@dev`
executes that **committed `dist`**, not `node_modules` and not `src/`. `dev`
is therefore not a private staging area — other repositories' CI is pinned to
whatever commit currently sits at the tip of `dev`, and a rewrite changes code
underneath a workflow that may be running against it right now.

This is also the *only* way to test a change end to end. Nothing in this
action's own suite can open a real PR against a real config-dependency
plugin, so proving a change works means: build (`pnpm build:prod`), commit
`src` and `dist` together, push to `dev`, then trigger a consumer's workflow
and read the run. A short-lived feature branch cannot be exercised this way,
because nothing consumes it — which is why the work has to live on `dev`
while it is still being proven out, rather than arriving there finished.

Two corollaries follow directly and are easy to violate by omission rather
than by intent:

- **A stale `dist` is a silently wrong test.** The consumer runs the bundle,
  so forgetting the build step before pushing to `dev` tests the *previous*
  change, and the run looks green (or red) for the wrong reason.
- **A dogfooded (unreleased, `link:`-overridden) first-party dependency in
  that bundle must be rebuilt against the registry release before the link is
  removed and `dev` is pushed again** — otherwise every consumer pinning
  `@dev` keeps running code that was never actually published.

## How to check

- Before pushing to `dev`: `git status` shows both `src/**` and `dist/**`
  changed in the same commit, or the push is testing stale code.
- `.github/workflows/silk-update.yml` runs this action `@v4` against this
  repository by default; flipping the `uses:` line to `@dev` (and reverting
  after) is the sanctioned way to exercise a `dev`-branch build against this
  repository specifically — see
  [test a dev-branch build](../runbooks/test-a-dev-branch-build.md).[^silk-update-workflow]
- If a workflow ever needs to rewrite `dev`'s history (squash, rebase, force
  push), stop — that workflow is targeting the wrong branch. The `promote`
  job in `branch-sync.yml` opens a `dev → main` PR rather than rewriting
  `dev`, and `sync-dev` only force-resets `dev` back to `main` after a
  release, when git can prove by patch-id that `dev` holds nothing `main`
  lacks.[^branch-sync-workflow]

See [the dev-branch glossary entry](../glossary/dev-branch.md) for what
"dev" names in this repository, and
[the release flow runbook](../runbooks/release-flow.md) for the full
`dev` → `main` → release sequence.

[^branch-sync-workflow]: `.github/workflows/branch-sync.yml`
[^silk-update-workflow]: `.github/workflows/silk-update.yml`
[^action-config]: `action.config.ts` (the bundling build)
