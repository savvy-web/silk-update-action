---
type: Decision
title: Keep a lockfile-snapshot read failure fatal, for now
description: LockfileError from the before/after lockfile snapshot still fails the job, even though a case exists for degrading it to a diagnostic null, because that change was never isolated from the extraction it surfaced alongside.
status: draft
tags:
  - architecture
  - testing
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 6bacf63a6ae3f1f3e72e0b5314e56486589381b72297066ffd7542eeaf71f261
sources:
  - id: lockfile-snapshot-step
    resource: ../../src/steps/lockfile-snapshot.ts
  - id: lockfile-service
    resource: ../../src/services/lockfile.ts
---

# Keep a lockfile-snapshot read failure fatal, for now

## Context

`lockfileSnapshotStep` runs twice per run — once before any mutation and
once after the install — so `compareLockfiles` can report what actually
moved. A missing lockfile is handled already: it logs a skip and returns
`null`, because a first install legitimately has no lockfile to
read.[^lockfile-snapshot-step] What is not handled specially is a
`LockfileError` from a lockfile that exists but fails to parse — that
propagates uncaught and fails the job.

There is a real argument, recorded in the step's own module doc, that
this is the wrong failure posture: `git status` is this run's actual
change signal, and a lockfile snapshot exists to produce a *diff*
(`compareLockfiles`), which is diagnostic detail layered on top of that
signal rather than the fact the run depends on. Under that view, a
`LockfileError` should degrade to `null` on both sides — the run would
report no lockfile changes but would still proceed to commit, PR, and
report on the file-level changes `git status` already found.

## Decision

`LockfileError` stays fatal. The step's own doc comment records the
counter-argument and explicitly does not apply it: this behavior was
extracted into its own module (`src/steps/lockfile-snapshot.ts`) as part
of a **behavior-preserving** restructure of `program.ts`, and the
argument for degrading surfaced only mid-restructure — after the
extraction had already begun, not before it. Folding a behavior change
into a move that is supposed to be reviewable as "moved code, not
changed code" makes the diff unreviewable: a reader cannot tell, from the
diff alone, whether an added `Effect.catch` is part of the move or a
policy change riding along with it.

So the fatal posture is preserved exactly as it existed before
extraction, and the degrade-to-`null` argument is left recorded rather
than applied.

## Alternatives rejected

- **Degrade `LockfileError` to `null` now, since the argument is
  documented.** Rejected on process grounds, not on the argument's
  merits: the argument may well be correct, but it needs to land as its
  own reviewable decision, not smuggled into a move whose only stated
  property is that it preserves behavior.
- **Silently keep the old behavior with no note.** Rejected because the
  counter-argument is real enough to record — a future reader hitting a
  `LockfileError` failure should find the tradeoff already considered,
  not have to re-derive it from scratch.

## Consequences

- A run whose lockfile cannot be parsed still fails the job today, even
  when `git status` alone would have been sufficient to detect and
  report changes. This is more conservative than strictly necessary
  under the diagnostic-signal argument above.
- The next person to touch `src/steps/lockfile-snapshot.ts` inherits an
  explicit, recorded fork in the road rather than an implicit one — the
  module doc names both the current posture and the rejected-for-now
  alternative in the same place.

## What would change the answer

A dedicated change proposing the degrade-to-`null` behavior on its own —
reviewable independently of any refactor — would be the correct vehicle
to revisit this. Until then, the posture recorded here is "argued, not
acted on," not "settled."

[^lockfile-snapshot-step]: `src/steps/lockfile-snapshot.ts`
</content>
