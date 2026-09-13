---
type: Decision
title: Commit via the Git Data API with no author, sign off separately from the token identity
description: Why commits omit an explicit author (that is what makes GitHub verify them) and why the DCO Signed-off-by trailer is a separate, deliberate concern resolved from the persisted App token rather than a literal.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 0fe5fba944a9a552c9410bdcd8a190053b3f56da22d619557e5367ded7377c8c
sources:
  - id: services-report
    resource: ../../src/services/report.ts
  - id: commit-signoff
    resource: ../../src/utils/commit-signoff.ts
  - id: services-branch
    resource: ../../src/services/branch.ts
---

# Commit via the Git Data API with no author, sign off separately from the token identity

## Context

Commits this action creates are pushed to someone else's repository and
should be trustworthy without requiring SSH or GPG key management for a
short-lived bot identity, and they must carry a DCO `Signed-off-by` trailer
like any other commit in a repository that enforces DCO — but the mechanism
this action uses to create a verified commit bypasses the porcelain path
(`git commit -s`) that would normally add that trailer automatically.

## Decision

`BranchManager.commitChanges` calls `GitCommit.commitFiles({ branch,
message, changes })`, which wraps the GitHub Git Data API (create tree →
create commit → update ref) in one call, and passes **no explicit
author**.[^services-branch] Omitting the author is what lets GitHub attribute
and verify the commit as coming from the GitHub App installation — the same
mechanism GitHub's own bots use, requiring no SSH or GPG keys to be
provisioned or rotated.[^services-report] Changes are modelled as tagged
members rather than a sentinel: `FileContent.make({ path, content })` for
additions and modifications, `FileDeletion.make({ path })` for
removals.[^services-branch]

**The `Signed-off-by` trailer does not make the commit verify — that is a
separate, unrelated fact about DCO, not about GitHub's verification
badge.**[^services-report] The trailer is supplied because the Git Data API
path bypasses `git commit -s`, so nothing adds it automatically; DCO 1.1
requires exact casing, spacing, and angle brackets, and because the commit
never runs through porcelain, nothing validates a malformed trailer at
commit time.[^commit-signoff] The identity named in the trailer is resolved
by `utils/commit-signoff.ts`'s `resolveSignoff()`, which reads
`GitHubToken.botIdentity()` — the same App bot identity the token belongs to
— rendering through `BotIdentity.signoff`, and falls back to the well-known
`BotIdentity.githubActions` identity when the botIdentity call itself fails
(covering every unit test that does not stand up a `pre` phase, where no
token was ever persisted).[^commit-signoff] `Report.layer` resolves this
signoff **once, in the layer body**, and closes over it in both
`generateCommitMessage` and the PR body's proposed-squash-commit
fence.[^services-report] That placement is deliberate: `resolveSignoff` is an
`Effect` over `ActionState`, while `generateCommitMessage` is a synchronous
string builder and the PR-body method's requirement channel must stay
`Repo`-only, so the layer body is the one place the state read can happen
without pushing `ActionState` into a member's own requirement channel. It
also structurally guarantees the commit trailer and the PR body's proposed
commit message cannot name two different identities, because both read the
same resolved string rather than each resolving it independently.[^services-report]

## Alternatives rejected

- **Pass an explicit author matching the App bot.** Rejected: passing any
  author defeats the mechanism that makes GitHub mark the commit as
  verified — verification for a Git Data API commit specifically depends on
  the commit having no author for GitHub to substitute its own attribution.
- **Take an `appSlug?` parameter on `generateCommitMessage` and let each
  caller supply it.** This existed as `signoffLine(appSlug?)` and was
  removed: the one production caller never passed a slug, so the branch that
  used the actual App identity was reachable only from the test suite, and
  every real run signed as the generic `github-actions[bot]` fallback while
  the commit itself was authored by the installation's own bot — a silent
  mismatch between the commit's real author and its sign-off line, visible
  only in a consumer's repository. `resolveSignoff()` replaced the parameter
  with a value resolved once, from the actual persisted token, so there is
  no caller-supplied branch to forget.
- **Resolve the sign-off per rendering (in `generateCommitMessage` and in the
  PR body builder separately).** Rejected: two independent resolutions of
  the same `ActionState` read can, in principle, race or simply be edited
  independently later, producing two different-looking trailers in one run.
  Resolving once in the layer body and closing over the result rules that
  out by construction rather than by discipline.

## Consequences

- `Report.layer`'s dependency on `ActionState` (an `ActionServices` member,
  not a locally built layer) must be left in the compile-time requirement
  channel, not provided by `makeAppLayer` — see
  [the requirement-channel gotcha](../gotchas/unprovided-service-is-not-a-type-error.md)
  for the distinction between the two outcomes of "a service resolved in a
  layer body."
- A test that stands up `Report.layer` without a persisted token still
  produces a well-formed commit message and PR body, signed as
  `github-actions[bot]`, rather than failing — the fallback covers exactly
  that gap.
- Any future change to which identity should sign a commit is a policy
  change inside `resolveSignoff()`, not a rendering change in
  `services/report.ts` — the two are already separated along exactly that
  line.

[^services-report]: `src/services/report.ts`
[^commit-signoff]: `src/utils/commit-signoff.ts`
[^services-branch]: `src/services/branch.ts`
