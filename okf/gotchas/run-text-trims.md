---
type: Gotcha
title: Run.text trims its output, which corrupts a column-aligned format
description: '@effected/commands'' Run.text silently trims leading and trailing whitespace, shifting every subsequent index in fixed-width or column-aligned text; this repository no longer parses such formats, but the trap is live for the next caller that reaches for Run.text over one.'
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
resource: ../../src/steps/install.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 2cff83cc304a41daa73ded2fc97f5cc8bbab9cd38549b53595c23ca7ef57ceb2
sources:
  - id: install-step
    resource: ../../src/steps/install.ts
  - id: custom-commands-step
    resource: ../../src/steps/custom-commands.ts
---

# Run.text trims its output, which corrupts a column-aligned format

## What you see

`@effected/commands`' `Run.text(command)` returns the command's stdout as
a plain string, and the value looks like a faithful copy of what the
process printed.

## What you will wrongly conclude

That the string `Run.text` returns is byte-for-byte what the subprocess
wrote to stdout, safe to slice by fixed column offsets or to compare
against a leading-whitespace-sensitive expectation.

## What is actually true

`Run.text` trims leading and trailing whitespace from the captured output.
For an ordinary command whose output is a value to be used whole (a
version string, a resolved path), that is harmless or even convenient. For
a **column-aligned** or fixed-width text format — the kind where a leading
space is itself significant, such as `git status --porcelain`'s two status
columns — trimming a leading space silently shifts every subsequent
character's index by one, corrupting the parse in a way that produces a
plausible-looking wrong answer rather than an error.

This repository used to depend on that exact property. `services/branch.ts`
once read `git status --porcelain` through `Run.collect` specifically
**because** `Run.collect` returns the exit code and raw output as a
result rather than trimming it the way `Run.text` does — the trimming
behavior of `Run.text` was a live constraint on that code, and using it
there would have silently misaligned the parsed columns. That local
parser and the constraint it was written around are both gone now: status
reads go through `@effected/git`'s `Git.status`, which returns typed
`StatusEntry` values rather than text this repository parses at all, so
nothing in `src/` currently depends on `Run.text` *not* trimming a
column-aligned format.

The two current call sites both use the two `@effected/commands` helpers
for what they are actually suited to: `steps/install.ts` uses `Run.text`
for `pnpm clean --lockfile` / `pnpm install --frozen-lockfile=false` /
`bun install --force` / `npm install`, where a non-zero exit should fail
the step typed and the output is not a fixed-width format being
parsed.[^install-step] `steps/custom-commands.ts` uses `Run.collect` for
user-supplied shell commands, deliberately, because a non-zero exit there
is a **result** to collect and report rather than a typed failure to
propagate.[^custom-commands-step]

## How to check

- Before reaching for `Run.text` over output that is fixed-width or
  column-aligned (status lines, `diff --stat`-style tables, anything
  where a leading space or column offset carries meaning), confirm
  whether the leading/trailing trim would shift an index — if so, prefer
  `Run.collect` and parse the raw captured output, or reach for a typed
  reader that models the format directly rather than a text stream (as
  `@effected/git`'s `Git.status` now does for git's own porcelain output).
- Grep `src/` for `Run\.text` and `Run\.collect` to confirm the current
  split still holds: `Run.text` should appear only where a non-zero exit
  must fail the step and the output is not being parsed column-by-column;
  `Run.collect` should appear only where the exit code and raw text are
  values to inspect, not typed failures.

[^install-step]: `src/steps/install.ts:58`
[^custom-commands-step]: `src/steps/custom-commands.ts:52`
