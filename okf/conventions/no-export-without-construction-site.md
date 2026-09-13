---
type: Convention
title: Demonstrate a failure path with a test, or leave it out of the signature
description: A type-level construct — an error union member, a service tag, an interface field — that no code in src/ ever constructs, resolves, or reads is a claim the type system carries indefinitely and no test can falsify; delete it rather than keep it "for completeness".
status: draft
stale_after: 2027-03-12T00:00:00Z
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 68671b05647c17cf5a8cdfbce8384633d26df371e477aeee508a0e24353414a8
sources:
  - id: errors
    resource: ../../src/errors/errors.ts
  - id: errors-test
    resource: ../../__test__/unit/errors/errors.test.ts
  - id: pnpm-utils
    resource: ../../src/utils/pnpm.ts
  - id: lockfile-service
    resource: ../../src/services/lockfile.ts
---

# Demonstrate a failure path with a test, or leave it out of the signature

Add a member to the `ActionError` union in `src/errors/errors.ts` only if
some code actually constructs it. Keep it there only for as long as that
construction site exists. Apply the same rule to any exported
type-level surface with no call site: a `Context.Service` tag and its layer,
an interface field, a helper function. If nothing in `src/` (or the test
suite exercising it as the sole caller does not count) constructs, resolves,
or reads it, remove it rather than leave it for "completeness" or a
future caller that has not arrived.

`__test__/unit/errors/errors.test.ts` pins the exported error set as a
closed list, so re-adding a member without a construction site fails that
test rather than passing silently.[^errors-test]

## Why

An error union member, a service tag, or an interface field is a promise
the type system repeats to every caller indefinitely: "this can happen," or
"resolve me and get something real." If nothing in the codebase ever
constructs or reads it, the promise is unfalsifiable — no test can ever
demonstrate the path, because there is no path, and no reviewer reading the
type in isolation can tell the difference between "this is exercised
elsewhere" and "this is dead."

This repository has deleted exactly this shape twice, for two different
reasons that are worth keeping distinct rather than folding into one story:

- **No caller anywhere.** Four error classes (`GitHubApiError`, `GitError`,
  `PnpmError`, `DependencyUpdateFailures`) and the `isRetryableError` helper
  that dispatched on them were declared, exported, and had zero
  construction sites in `src/` — the only code that ever built one was the
  test suite asserting on their retry predicates, so those tests passed
  precisely because they were the union's sole callers. The `WorkspaceYaml`
  and `Lockfile` service tags and their layers were deleted on the same
  finding: nothing in `src/` ever resolved either tag, only each module's
  own test suite did, so the tag and layer were dead code wearing a type
  signature.[^lockfile-service] `parsePnpmVersion` / `formatPnpmVersion` /
  `ParsedPnpmVersion` in `src/utils/pnpm.ts` went the same way: zero callers
  in `src/` and zero in `__test__/`, and the justification recorded for
  keeping them had also independently expired.[^pnpm-utils]
- **The kit ships the capability now.** This is a *different* argument and
  should not be conflated with the first: `corepackHashFromIntegrity` had a
  real caller and worked, but was deleted anyway once
  `@effected/npm@0.11.0` shipped the same conversion as
  `CorepackIntegrityHash.fromSri`. "No caller" and "the kit ships it now"
  imply different follow-ups — the first is a pure deletion, the second is
  a deletion paired with an upstream adoption.

A documentation pass is what found the pnpm-utils deletions: reconciling
which of several helpers an adoption had actually replaced required
checking call sites one by one, and that check is what surfaced both the
dead exports and the expired justification for keeping them. That is the
reusable method — auditing by call site finds what auditing by re-reading a
table does not.

## How to check

- `grep -rn "GitHubApiError\|GitError\|PnpmError\|DependencyUpdateFailures\|isRetryableError" src/` should return nothing; those five names should not exist anywhere outside history.
- Run `__test__/unit/errors/errors.test.ts` — it asserts the exported error
  set is exactly `ChangesetError`, `FileSystemError`, `InvalidInputError`,
  `LockfileError`, so adding a member without updating that test fails the
  suite.[^errors][^errors-test]
- Before adding any new tagged error, service tag, or optional interface
  field, identify the construction/resolution site in `src/` it will have
  on arrival. If the only answer is "the test I'm about to write," that
  test is the sole caller and the construct is not yet load-bearing —
  write it once a real caller exists, not before.
- When an adoption or refactor removes the last caller of a helper,
  delete the helper in the same change rather than leaving it for a
  "future need" — record the deleted helper's name and reasoning in a
  comment at its former location if the reasoning is non-obvious, as
  `src/utils/pnpm.ts` does.[^pnpm-utils]

See [errors](../models/action-errors.md) for the current error model this
rule keeps closed.

[^errors]: `../../src/errors/errors.ts`
[^errors-test]: `../../__test__/unit/errors/errors.test.ts`
[^pnpm-utils]: `../../src/utils/pnpm.ts`
[^lockfile-service]: `../../src/services/lockfile.ts`
