---
type: Decision
title: Force-reset a dedicated branch every run rather than rebase
description: Why the update branch is validated then force-reset to the source ref on every run instead of merged or rebased forward.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 1145dcf2007bdb72e72c8169f33181db13ffc37c374b98054e6da0e23644e27e
sources:
  - id: services-branch
    resource: ../../src/services/branch.ts
  - id: steps-branch
    resource: ../../src/steps/branch.ts
---

# Force-reset a dedicated branch every run rather than rebase

## Context

Each run of this action needs a branch to push dependency updates to before
opening or updating a PR. The branch's `source-branch` (the ref it is cut
from and reset to) and `target-branch` (the PR's base, following
`source-branch` when unset) are both user-configured inputs, so either can be
a typo naming a ref that does not exist.

## Decision

`branchStep` validates both refs with `BranchManager.validateBranches`
**before** calling `BranchManager.manage`, so a missing ref fails with a
typed `InvalidInputError` (`field: "source-branch"` or `"target-branch"`)
before any destructive operation runs; the target check is skipped entirely
when `target === source`.[^services-branch][^steps-branch] Only after that
preflight does `manage` read the source branch's SHA via the API and call
`GitBranch.upsert(branchName, baseSha)`, which creates the branch when absent
and **force-resets** it to that SHA when present, returning which of the two
happened.[^services-branch] `upsert` replaced an older exists → delete →
create sequence: same net effect (a fresh start from the source ref every
run), without a window in which the ref does not exist for anything else
that might read it.

After the API-side reset, `manage` fetches the branch by an explicit refspec
(`+refs/heads/<branch>:refs/remotes/origin/<branch>`) rather than a bare
`git fetch origin` — load-bearing on `actions/checkout`'s default
single-branch clone, where a bare fetch only covers the checked-out branch
and never materializes `origin/<branch>` for anything else — then checks it
out locally with `branchCreate` (`checkout -B` semantics: force +
checkout).[^services-branch]

`BranchManager.ensureBaseHistory(base, workspaceRoot)` is a separate,
best-effort preflight run before the changeset step, not part of branch
management itself. It probes whether `git merge-base <base> HEAD` already
resolves (true under the documented `fetch-depth: 0` checkout, which makes
the probe a no-op); only when it does not does it fetch the base ref,
unshallow the clone if needed, and materialize a local ref by name, warning
rather than failing if the merge-base is still missing
afterward.[^services-branch] Every command in both `manage` and
`ensureBaseHistory` takes an explicit `workspaceRoot` rather than defaulting
to the process's current directory: the action can legitimately be invoked
from a subdirectory of the workspace, and a default would resolve `git
status`, `merge-base`, and the recovery fetches against the wrong directory
— succeeding, and reporting a confident wrong answer (no changesets, which
reads identically to "nothing to version"), rather than failing
visibly.[^services-branch]

## Alternatives rejected

- **Rebase the branch forward onto the source ref instead of resetting.**
  Rejected: the branch only ever contains automated dependency updates, so
  there is nothing on it worth preserving across runs, and rebase introduces
  conflict resolution this action would have no human present to perform.
  Always starting from a clean reset needs no conflict logic and is always in
  a known-good state.
- **Skip the ref-existence preflight and let `upsert` fail naturally on a
  bad ref.** Rejected: `upsert` is destructive (it force-resets an existing
  branch), so the check has to happen *before* that call, not surface as a
  side effect of it. Validating first means a typo'd ref is reported as
  `InvalidInputError` naming the bad field, not as an opaque GitHub API
  rejection after a branch has already been reset.
- **Default `workspaceRoot` to `process.cwd()` in `commitChanges` and
  `ensureBaseHistory`.** This existed at one point and was removed: it is a
  silent-wrong-directory hazard rather than an error, because the action
  running in a subdirectory does not fail — it reads (or fetches) the wrong
  tree and reports a plausible but incorrect result. Both parameters are now
  required.

## Consequences

- A `source-branch` or `target-branch` typo is now caught inside the check
  run, before the reset, rather than surfacing later as an API error or a
  changeset diff against a base that does not exist.
- `ensureBaseHistory` only runs when changesets are enabled, so a
  shallow-checkout workflow that never enables changesets never pays for the
  fetch/unshallow/branch-create recovery path.
- Every future caller of a `BranchManager` method must pass `workspaceRoot`
  explicitly — there is no fallback to add back without reintroducing the
  silent-wrong-directory class of bug this decision closed.

[^services-branch]: `src/services/branch.ts`
[^steps-branch]: `src/steps/branch.ts`
