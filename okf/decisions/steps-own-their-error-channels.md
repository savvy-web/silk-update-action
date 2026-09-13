---
type: Decision
title: Each orchestration step declares its own error channel
description: A step carries a tagged error in its type only if it can actually fail; five of sixteen steps are typed never, and program.ts composes rather than performs I/O.
status: draft
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: af1ca7f43bf6375fb5877c9cb12951173bced780fb0e9b92147c9054c3c8b3ef
sources:
  - id: program
    resource: ../../src/program.ts
  - id: custom-commands
    resource: ../../src/steps/custom-commands.ts
  - id: commit-and-pr
    resource: ../../src/steps/commit-and-pr.ts
  - id: peer-check
    resource: ../../src/steps/peer-check.ts
  - id: regular-deps-step
    resource: ../../src/steps/regular-dependencies.ts
  - id: upgrade-runtimes-step
    resource: ../../src/steps/upgrade-runtimes.ts
  - id: upgrade-pm-step
    resource: ../../src/steps/upgrade-package-manager.ts
---

# Each orchestration step declares its own error channel

## Context

`src/steps/` holds one module per orchestration unit — sixteen at present —
and each is required to declare, for itself: a result type, an explicit
requirement channel, and a tagged error **only if it can actually fail**.
This is a claim the compiler checks, not a convention documented and hoped
for: re-deriving it with

```sh
grep -lE 'Effect\.Effect<[^ ,]+,\s*never' src/steps/*.ts
```

against the current tree names exactly five modules —
`custom-commands.ts`,[^custom-commands] `peer-check.ts`,[^peer-check]
`regular-dependencies.ts`,[^regular-deps-step]
`upgrade-package-manager.ts`[^upgrade-pm-step] and
`upgrade-runtimes.ts`.[^upgrade-runtimes-step]
Each of the five degrades its own internal failures — a per-dependency
registry lookup, a per-runtime resolver call, a manifest read/write — into a
reported outcome rather than letting them surface as a typed error, so the
degradation happens *inside* the step rather than being left to a caller who
might forget to handle it. This count is not stable across the codebase's
history and should be re-derived rather than copied forward — it has already
silently stopped matching more than once as steps were added.

## Decision

Every step module states, in its own doc comment, which of two failure
postures it takes: fail-the-job, or degrade-to-warning. That statement and
the type are checked against each other by the rule above — a step claiming
to degrade internally but still carrying a real error type contradicts
itself in a way the grep exposes.

Two boundaries in that discipline are deliberate rather than incidental
simplifications:

- **`custom-commands.ts` runs every command, collects the failures, and
  returns them — it does not conclude the check run, set outputs, or fail
  the effect.**[^custom-commands] Concluding the check run and publishing
  outputs are composition concerns that `program.ts` owns for every terminal
  state; a step reaching for `conclude` would be the one place a run's
  verdict is decided somewhere other than the composition layer. The step
  reports what happened; the program decides what that means.
- **`commit-and-pr.ts` is one module with an asymmetric failure posture
  inside it, not two modules.**[^commit-and-pr] The commit and the PR share a
  precondition (not a dry run) and an ordering constraint (the PR must
  describe a commit that exists), so splitting them would move that
  constraint into the composition layer where it is easy to reorder by
  accident. Their failure postures still differ: the commit propagates,
  because a PR describing changes that were never committed would be a lie;
  the PR degrades to a warning and a `null` result, because by the time that
  call runs the commit is already pushed and durable, and failing the whole
  run would report a red job for work that had already landed.

`program.ts` itself is held to a related but distinct standard: it **issues
no I/O primitive and builds no strings of its own**. That is a narrower and
more defensible claim than "performs no I/O", which would be false — a
service helper call from inside `program.ts` can still read from disk, and a
grep for I/O primitives (`Run.*`, `ChildProcess.*`, `node:fs`) would report
clean regardless, because a call to a helper that reads is still a read. The
correct check is to follow the callees, not the imports. As of the current
tree, `program.ts` calls `compareLockfiles` directly (a service helper that
reads two lockfile snapshots),[^program] while `readWorkspaceYaml` — which
this same claim used to name as the other exception — has since been fully
extracted into `steps/config-dependencies.ts` and
`steps/format-workspace.ts`, so `program.ts` no longer touches it at all.
That the count of exceptions shrank between one telling of this claim and
the next is exactly why the claim has to be re-derived from the current
callees rather than trusted from a prior description of them.

## Alternatives rejected

- **A uniform error channel across every step**, whether or not the step can
  fail. Rejected because it would force every caller to handle a case that
  cannot occur for most steps, and would hide the five genuinely
  never-failing steps' internal degradation behind a type that claims
  otherwise.
- **`custom-commands.ts` concluding the check run itself** on a failed
  command. Rejected because it would let one step decide the run's terminal
  verdict outside the composition layer that owns every other terminal
  state, making the set of places a run can end non-uniform.
- **Splitting `commit-and-pr.ts` into a commit step and a PR step.**
  Rejected because the ordering constraint between them (a PR must describe
  a commit that exists) would then live in `program.ts` instead of the one
  module responsible for both halves, and composition-layer ordering bugs
  are exactly the class of mistake this repository's steps discipline exists
  to avoid.

## Consequences

- A reader auditing failure behavior can trust the type signature over the
  doc comment when the two disagree, because the signature is what the
  compiler and the `grep` command above actually check.
- Adding a step that can fail requires giving it a real tagged error, not
  quietly widening one of the five `never` steps' channel to accommodate a
  new failure — doing so would silently move that step out of the audited
  set without anyone re-running the derivation.
- `program.ts`'s two remaining direct read call sites are a known, accepted
  gap between the "no I/O primitive" claim it actually satisfies and a
  stronger "no I/O at all" claim it does not — extracting `compareLockfiles`
  into its own step would close it, and has not been done.

## What would change the answer

A step calling `compareLockfiles` (or any other file-reading helper)
directly from `program.ts`, without going through a `steps/` module, would
keep this decision's narrower claim true but should prompt re-checking
whether the extraction the repository has already done once for
`readWorkspaceYaml` should be finished for the remaining call site too. The
five-`never`-steps count should be re-derived with the grep above whenever a
step is added or a step's internal degradation logic changes, never carried
forward from this document.

[^program]: `src/program.ts`
[^custom-commands]: `src/steps/custom-commands.ts`
[^commit-and-pr]: `src/steps/commit-and-pr.ts`
[^peer-check]: `src/steps/peer-check.ts`
[^regular-deps-step]: `src/steps/regular-dependencies.ts`
[^upgrade-runtimes-step]: `src/steps/upgrade-runtimes.ts`
[^upgrade-pm-step]: `src/steps/upgrade-package-manager.ts`
