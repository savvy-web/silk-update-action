---
type: Decision
title: Publish the output baseline before any work runs
description: Every declared output is set to a safe value as the first statement of the program, not from a failure handler, so no exit path ever leaves one unset.
status: draft
tags:
  - ci
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-15T18:43:07Z
  body_sha256: 0531aaff5fca4d5fe6741cb557fdd70ccfeef71ea9d8d5aa6abd8ba305f5e7b4
sources:
  - id: outputs-schema
    resource: ../../src/schema/outputs.ts
  - id: program
    resource: ../../src/program.ts
  - id: program-inner-test
    resource: ../../__test__/unit/program.inner.test.ts
---

# Publish the output baseline before any work runs

## Context

This action declares [five outputs](../interfaces/action-outputs.md) in
`action.yml` — four scalars
(`pr-number`, `pr-url`, `updates-count`, `has-changes`) plus `result`, the
whole run as one JSON document. A consuming workflow reads these
unconditionally once the action completes, whatever the outcome, and GitHub
Actions represents an output nobody ever set as an empty string — which is
indistinguishable, at the reading end, from an output deliberately set to
empty.

`result` in particular has to be more than an empty string on every exit
path: the entire point of a structured output is that a consumer can
`fromJSON(...)` it without a guard, and a baseline of `""` would push that
guard onto every reader — the same defect as an unset scalar wearing a
different shape. `emptyRunResult` is therefore a full empty-run document
(`$schema`, every array empty, `packageManager: null`,
`pullRequest: null`) rather than an empty string.[^outputs-schema]

## Decision

`program` calls `emitOutputs(initialOutputs)` as its first
statement — before `readInputs`, before any layer is built, before the check
run exists.[^program] `initialOutputs` sets every declared output to the
value a run that did nothing honestly produced: `"false"` for
`has-changes`, `"0"` for `updates-count`, empty strings for the two PR
outputs, and the empty-run document for `result`.[^outputs-schema]
`emitOutputs` itself iterates the full `OUTPUT_NAMES` tuple and writes every
one, so a caller cannot publish a partial set by only setting the outputs it
happens to have a value for.[^outputs-schema]

Because the baseline is emitted first and every step writes only when it has
something to report, later steps *refine* the outputs rather than
initialize them. A failure inside `readInputs` — the earliest thing able to
abort the run — still leaves every output holding a coherent, parseable
value, because the baseline was already published before `readInputs` ran.

## Alternatives rejected

- **Emit the baseline from an `Effect.onError` handler at the end.** This
  was considered and rejected as strictly worse, not merely equivalent: a
  failure handler that re-emits the baseline also *overwrites* anything a
  step already published earlier in the same run. A run that opened a PR and
  then failed at a later step (a custom command, say) would report
  `pr-number: ""` and `has-changes: false` — which is not a conservative
  default, it is a false statement about work that genuinely happened. The
  chosen approach — publish first, let steps refine — gives the same
  every-exit-path guarantee without ever contradicting completed work.
- **A `result` baseline of `""`.** Rejected because it pushes a guard onto
  every consumer that wants to parse `result`, which is precisely the
  ergonomic problem a structured output exists to remove.

## Consequences

- Every declared output has a value on every exit path by construction,
  including failure inside input parsing itself — there is no code path in
  `program` that can leave an output at GitHub's own default (unset =
  empty string) while claiming a different meaning for that emptiness.
- `program.inner.test.ts` asserts the `result` document's *contents*, not
  only that a document exists, on each of the terminal states the program
  can reach — a no-changes exit and a custom-command-failure exit each need
  their own assertion, because a fix to one exit path's document (for
  example, correcting `packageManager` after detection had already
  succeeded) does not imply the other path's document is also
  correct.[^program-inner-test] The two exits share no code path, so one
  being right says nothing about the other.
- A step that wants to report partial progress must call `emitOutputs`
  again with a merged view of the baseline and its own results — there is
  no automatic accumulation, only the discipline of never calling
  `emitOutputs` with a value that would erase a field a prior step already
  set correctly.

## What would change the answer

If GitHub Actions ever distinguished "unset" from "set to empty" at the
consumer's reading end, the empty-string / empty-document baseline would
stop needing to double as that signal, and a run could in principle leave
early outputs genuinely unset. Nothing in the runner does this today, and
this decision holds as long as it does not.

[^outputs-schema]: `src/schema/outputs.ts`
[^program]: `src/program.ts`
[^program-inner-test]: `__test__/unit/program.inner.test.ts`
