---
type: Decision
title: Adopt @effected/git for all local git operations; pin core.fileMode in repository config
description: Every local git operation this action performs — status reads and the mutating tier alike — now goes through @effected/git; core.fileMode=false is written once into the checkout's repository config rather than passed per command.
status: draft
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: baba7e691299ec9a47a046e8337dd79cab872cc35a4b30975ba50b79d682f1b2
sources:
  - id: configure-status
    resource: ../../src/steps/configure-status.ts
  - id: detect-changes
    resource: ../../src/steps/detect-changes.ts
  - id: branch-service
    resource: ../../src/services/branch.ts
  - id: effected-issue-279
    resource: "https://github.com/spencerbeggs/effected/issues/279"
---

# Adopt @effected/git for all local git operations; pin core.fileMode in repository config

## Context

This action commits through the GitHub Git Data API, which writes a content
tree at mode `100644`. An executable-bit-only flip — husky chmod-ing its hooks
during a `run` command is the case that actually happens — has no content to
commit, so counting it as a change produces an empty commit and a spurious PR.
Two independent readers need to agree on whether such a flip counts: the
run's own change-detection step and `BranchManager.commitChanges`'s file
list.[^configure-status][^detect-changes]

Separately, `services/branch.ts` performs nine local git operations beyond
status: an explicit-refspec `fetch` (load-bearing on a single-branch
`actions/checkout`, which otherwise never materializes `origin/<branch>`),
`fetchUnshallow`, `branchCreate` (covering both `checkout -B` and
`branch -f`), `reset`, `isShallow` and `mergeBaseOption`. Whether to run these
through a typed git service or a generic subprocess runner was a decision made
twice, in two directions.

## Decision

`@effected/git` (currently resolved to `0.15.1`) is adopted for **every**
local git operation this action performs, not only status reads. The
module doc on `services/branch.ts` records that `git@0.8.0`
(spencerbeggs/effected#279) closed the remaining gap and "`Run` is gone from
this module" — all nine operations now go through the service, each taking an
explicit `cwd` rather than inheriting the process directory.[^branch-service]

Layered on top of that adoption: `configureStatusStep`
(`src/steps/configure-status.ts`) writes `core.fileMode=false` into the
checkout's **local** git config a single time, immediately after
package-manager detection and before any status read. `git config <key>
<value>` with no scope flag writes the repository's own config — the same
effect as `--local` — scoped to this checkout and not the runner's global
config.[^configure-status] Both status readers — `detectChangesStep`'s change
verdict and `BranchManager.commitChanges`'s commit file list — read `git
status` afterward and therefore see the same, already-configured tree;
neither call site carries the flag itself.[^detect-changes][^branch-service]
Failure to write the setting propagates rather than degrading: if the write
does not take, every later status read silently reports exec-bit flips as
changes, and the run's whole change verdict is wrong in a way nothing
downstream can detect.[^configure-status]

### How the git-service adoption got here

This was not one decision but three, in sequence, and the middle two are
worth keeping because the reasoning that overturned the first was itself
wrong about *why* it was wrong the first time:

1. **Declined outright.** The original ruling covered 2 of the then-9 local
   operations and argued the remaining 7 could not move without either a
   per-command `-c core.fileMode=false` seam (which the service lacked) or a
   process-global `GIT_CONFIG_*` environment override (rejected on blast
   radius, since it would apply to every git invocation in the process). Every
   individual claim in that ruling was true.
2. **Adopted for `status` only.** The ruling's enumeration of scopes — per-command
   and process-global — was *incomplete*, not wrong: repository-local config is
   a third scope, distinct from both, and the setting could be written once
   into `.git/config` rather than threaded per call. That is what unblocked
   adopting the service for status reads: `Git.status` returns typed
   `StatusEntry` values instead of porcelain text, which retired a local
   `parseStatusLine` parser that had shipped three silent defects — a rename
   read as a single unusable path, a deletion whose two porcelain columns
   disagreed (`AD`, `RD`) read as a modification, and a copy's origin path was
   deleted along with the copy itself. All three became unrepresentable rather
   than merely fixed, because `StatusEntry` models both columns and
   `origPath` separately instead of one flattened string.[^branch-service]
3. **Fully adopted.** `@effected/git@0.8.0` added refspec `fetch`,
   `fetchUnshallow`, `branchCreate`, `reset`, `isShallow` and
   `mergeBaseOption`, closing the remaining gap
   (spencerbeggs/effected#279).[^branch-service][^effected-issue-279] At that
   point `services/branch.ts` stopped running two subprocess mechanisms for
   git side by side — a cost the second step had accepted deliberately and
   that the third step then closed outright, rather than a cost still being
   paid today.

## Alternatives rejected

- **A per-command `-c core.fileMode=false` flag on every status call.**
  Rejected: threading the same flag through two call sites is exactly the
  kind of consistency a reviewer cannot check by reading one of them in
  isolation, and it was never actually necessary once repository config was
  recognized as a third scope.
- **A process-global `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`
  environment override.** Rejected on blast radius: it would apply to every
  git command the process spawns for the rest of the job, not only the status
  reads that need it.
- **Keep the seven mutating operations on the generic `Run` command runner
  indefinitely**, on the grounds that two subprocess mechanisms for git in one
  module is an acceptable, bounded cost. Superseded once the kit closed the
  gap outright — accepting a known cost while waiting on an upstream fix is
  different from deciding to keep paying it once the fix exists.
- **Leave `core.fileMode` unset and rely on default file-mode tracking.**
  Rejected: this is precisely the case that produces an empty commit and a
  spurious PR when a dependency-install step flips an executable bit with no
  content change.

## Consequences

- Every local git operation `services/branch.ts` performs — API-adjacent
  reads and the mutating tier alike — shares one typed error union
  (`GitCommandError | NotARepositoryError | UnknownRefError`) instead of two
  different failure shapes from two different subprocess mechanisms.
- Every git command run in this checkout for the rest of the job — including
  a downstream changeset tool's own git operations — sees
  `core.fileMode=false`. This is accepted as benign: a mode-only flip cannot
  survive the content-based API commit regardless, and the setting is scoped
  to the workspace, not the runner.
- The step ordering is load-bearing: `configureStatusStep` must run before the
  first status read, or the first read is judged under the wrong file-mode
  setting with no error to signal it.
- Every `@effected/git` call now takes an explicit `cwd`, which closed a
  separate, earlier defect where the previous `Run`-based helper inherited
  the process directory with no default parameter for a grep to find.

## What would change the answer

A future need for per-command file-mode control (for example, a status read
that deliberately *should* count exec-bit flips) would need a different
mechanism than a single checkout-wide write. On the git-service side, nothing
currently argues for reintroducing a second subprocess mechanism — that
question is closed unless a future local git operation this action needs is
one `@effected/git` does not cover.

[^configure-status]: `../../src/steps/configure-status.ts`
[^detect-changes]: `../../src/steps/detect-changes.ts`
[^branch-service]: `../../src/services/branch.ts:1-31`
[^effected-issue-279]: `https://github.com/spencerbeggs/effected/issues/279`
