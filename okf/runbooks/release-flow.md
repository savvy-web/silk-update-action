---
type: Runbook
title: Follow dependency-update work from dev through to a published release
description: The chain of workflow triggers that carries a merged dependency-update PR on dev to a promoted main PR, a changeset release, a moved major-alias tag, and an evened-out dev branch.
status: draft
tags:
  - release
  - ci
resource: ../../.github/workflows/branch-sync.yml
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 7dac4b2780a54476e3e89f6b5bc3a3ac7eb665afcc191cf9a082b3c4908da0e9
sources:
  - id: branch-sync
    resource: ../../.github/workflows/branch-sync.yml
  - id: release-workflow
    resource: ../../.github/workflows/release.yml
---

# Follow dependency-update work from dev through to a published release

Dependency-update work always lands on `dev` first (see
[never rewrite dev](../conventions/never-rewrite-dev.md)); nothing merges
straight from a feature branch into `main`. `.github/workflows/branch-sync.yml`
carries three concerns in one file — promoting `dev` toward `main`, keeping
`dev` even with `main` afterward, and moving the `v<major>` alias tag — and
each is triggered independently rather than chained by hand.

**Trigger:** work has accumulated on `dev` (ordinary commits, or a merged
`pnpm/config-deps` dependency-update PR) and is ready to become a published
release.

## Steps

1. Work accumulates on `dev` through ordinary commits and through the
   config-dependency update flow, whose PR is headed `pnpm/config-deps` and
   merges into `dev`.
2. That merge — a closed, merged pull request against `dev` whose head ref
   is `pnpm/config-deps` — fires branch-sync.yml's `promote` job
   (`.github/workflows/branch-sync.yml:244-252`).[^branch-sync] If a
   `dev → main` PR is already open, it re-asserts squash auto-merge on the
   existing PR rather than opening a second one
   (`.github/workflows/branch-sync.yml:276-284`); otherwise it opens a new
   `dev → main` PR titled from the merged dependency PR, left open for
   review, with squash auto-merge enabled
   (`.github/workflows/branch-sync.yml:301-329`).
3. Pushing to `main` — merging that promotion PR — fires
   `.github/workflows/release.yml` (triggered on `push: branches: [main]`,
   `.github/workflows/release.yml:4-5`),[^release-workflow] which calls the
   shared reusable workflow at
   `savvy-web/.github/.github/workflows/release.yml@main`
   (`.github/workflows/release.yml:23`). Its Phase 1 detects changesets and
   opens a release PR on `changeset-release/main`.
4. Pushes to `changeset-release/main` are also matched by
   `.github/workflows/release.yml`'s `pull_request` trigger
   (`.github/workflows/release.yml:6-7`) and run Phase 2 validation: build,
   publish dry-runs, a release-notes preview, and a sticky status comment.
5. Merging the release PR runs Phase 3: publish, tag creation, and the
   GitHub release.
6. The published `release` event fires branch-sync.yml's `major-tag` job
   (`.github/workflows/branch-sync.yml:166-172`), which moves the
   `v<major>` alias tag to the new release commit — but only for a stable
   SemVer tag at `1.0.0` or above
   (`.github/workflows/branch-sync.yml:201-213`); a prerelease or sub-`1.0.0`
   tag is a no-op there.
7. That same push to `main` (step 3) independently fires branch-sync.yml's
   `sync-dev` job (`.github/workflows/branch-sync.yml:55-63`), keyed on
   `main` *moving* rather than on a release being published — a `main` push
   that produces no release (a dependency promotion with no changeset, for
   example) still needs `dev` evened out, and merging
   `changeset-release/main` is itself a push to `main`, so the release path
   is still covered by the same trigger. It force-resets `dev` to `main`
   when a merge-tree comparison proves `dev` holds nothing `main` lacks
   (`.github/workflows/branch-sync.yml:131-143`); otherwise it rebases `dev`
   onto `main` (`.github/workflows/branch-sync.yml:147-154`), and a
   conflicting rebase leaves `dev` untouched with a warning rather than
   forcing anything (`.github/workflows/branch-sync.yml:150-153`).

## Observable end state

`main` carries the new release tag and its GitHub release; for a stable
`1.0.0`-or-above release, the `v<major>` alias tag points at the same
commit; and `dev` is either reset to or rebased onto the new `main` —
never left silently diverged from it, and never rewritten in a way that
loses work `main` does not already have.

## Related

[Never rewrite dev](../conventions/never-rewrite-dev.md) is the convention
this whole flow protects — `sync-dev`'s merge-tree check exists specifically
so `dev` is only ever force-reset when doing so provably loses nothing.

[^branch-sync]: `.github/workflows/branch-sync.yml`
[^release-workflow]: `.github/workflows/release.yml`
