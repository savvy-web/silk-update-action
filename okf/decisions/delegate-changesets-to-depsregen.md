---
type: Decision
title: Delegate dependency changesets to silk-effects' DepsRegen
description: The changeset step is a thin adapter over @savvy-web/silk-effects' Changesets.DepsRegen, which owns the diff, consolidation and gating; this action carries no changeset predicate of its own.
status: draft
tags:
  - release
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 779844fd6b9c4986281638b9ef9eac309d32d1835a4432ba0b469eaa48160b6c
sources:
  - id: changesets-service
    resource: ../../src/services/changesets.ts
  - id: changesets-step
    resource: ../../src/steps/changesets.ts
  - id: drift-canary
    resource: ../../__test__/integration/changeset-emission.int.test.ts
---

# Delegate dependency changesets to silk-effects' DepsRegen

## Context

This action can bump dependencies across every workspace package in one run,
and Changesets is the versioning tool this ecosystem standardizes on. A
naive "one changeset per update" approach either produces one file per
dependency per run (accumulating indefinitely across re-fires) or requires
this action to reimplement Changesets' own gating rules (which packages are
publishable, which are excluded by config) to avoid writing changesets for
packages that should never get one.

## Decision

`Changesets` (`src/services/changesets.ts`) is a thin adapter over
`@savvy-web/silk-effects`' `Changesets.DepsRegen` — it does not compute a
diff, does not decide which packages are in scope, and carries no gating
predicate of its own.[^changesets-service] `DepsRegen.plan({ cwd, base })`
recomputes the cumulative dependency diff from `merge-base(base) → worktree`
(catalog- and workspace-aware), and `execute(plan)` writes **one** consolidated
`## Dependencies` changeset per in-scope package while deleting every stale
*pure-dependency* changeset it finds — so re-firing this action against an
accumulation of prior pure-dependency changesets converges to a single
current table per package instead of piling up duplicates.[^changesets-service]
Mixed changesets (a `## Dependencies` table plus other prose) are detected and
left untouched.[^changesets-service]

Gating — publishable OR `privatePackages.version`, minus the changeset
`ignore` list — lives entirely upstream in `DepsRegen`; this action does not
carry its own versionable/ignored predicate.[^changesets-service] Because of
that, this run's own per-run records (`lockfileChanges`, `regularUpdates`,
`peerUpdates`) are **not** inputs to the changeset step — its content comes
from the git diff DepsRegen computes, and those per-run records continue to
drive only the PR body, commit message and job summary in
`program.ts`.[^changesets-service]

`changesetsStep` (`src/steps/changesets.ts`) skips with a stated reason when
`changesets` is disabled or no `.changeset/` directory exists, and otherwise
calls `BranchManager.ensureBaseHistory(targetBranch, workspaceRoot)` before
invoking `Changesets.create` — `DepsRegen` diffs against
`merge-base(target-branch)`, so that history must be locally available (a
no-op on a `fetch-depth: 0` checkout, best-effort otherwise).[^changesets-step]
The base is the resolved `target-branch`, not `source-branch` — the release
baseline — so the diff window spans every unreleased change, which is what
makes consolidation correct rather than merely trimming.[^changesets-service]

`__test__/integration/changeset-emission.int.test.ts` drives the action's
`Changesets` service through the **real** `Changesets.DepsRegenDefault` layer
against a throwaway git repository, and functions as the upstream-drift
canary for this delegation: it is what would fail if a `silk-effects` release
changed the `DepsRegen` surface or its consolidation behavior out from under
this action.[^drift-canary]

## Alternatives rejected

- **One changeset per dependency update, written directly by this action.**
  Rejected: it accumulates indefinitely across re-fires with no consolidation,
  and duplicates gating logic that already exists upstream.
- **Feed the per-run update records (`regularUpdates`, `lockfileChanges`, …)
  into the changeset content.** Rejected: those records describe what *this
  run* changed, not the cumulative diff since the last release, which is what
  the changeset must describe. Reading from git directly is what makes
  consolidation and idempotency possible.
- **Implement the versionable-minus-ignored gating predicate locally.**
  Rejected: it would need to track the same changeset config
  (`privatePackages.version`, the `ignore` list) that `DepsRegen` already
  reads, duplicating a rule this action has no independent reason to
  reimplement.

## Consequences

- A `silk-effects` upgrade that changes `DepsRegen`'s diffing, consolidation
  or gating behavior changes this action's changeset output without a local
  code change — the integration test is the mechanism that would catch a
  regression, not a review of this action's own source.
- This action's changeset step is deliberately thin: nearly all of its logic
  is "should I call `DepsRegen` at all" (disabled, no `.changeset/` directory)
  rather than "what should the changeset contain."
- A failure inside `DepsRegen` (a git error, a workspace-discovery error, an
  I/O error, or a failed point-in-time read) is collapsed into this action's
  own `ChangesetError` with a descriptive reason rather than propagated
  as-is, and fails the step — a changeset the release depends on that was
  silently not written would be a worse outcome than a failed check
  run.[^changesets-service]

## What would change the answer

A need for changeset content this action alone can determine (for example, a
category of update `DepsRegen`'s git-diff-based view cannot see) would argue
for extending `DepsRegen` upstream rather than reintroducing a parallel
gating or diffing path in this action — the delegation exists specifically so
this repository does not carry two implementations of the same rules.

[^changesets-service]: `../../src/services/changesets.ts`
[^changesets-step]: `../../src/steps/changesets.ts`
[^drift-canary]: `../../__test__/integration/changeset-emission.int.test.ts`
