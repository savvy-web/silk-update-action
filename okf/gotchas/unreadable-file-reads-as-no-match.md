---
type: Gotcha
title: A search that cannot read a file returns nothing, indistinguishable from a real no-match
description: grep silently skips a file it detects as binary, and that empty result looks identical to a genuine absence — src/services/lockfile.ts once carried a raw NUL byte that made grep skip all 531 lines and an audit report the file clean.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - docs
resource: ../../src/services/lockfile.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 852dca100e07d72c10f7b854b4ce2cca651ec09083749779174e32c9264ab6a7
sources:
  - id: lockfile-service
    resource: ../../src/services/lockfile.ts
---

# A search that cannot read a file returns nothing, indistinguishable from a real no-match

## What you see

`grep -rn 'from "node:'` or a similar text search over `src/` returns
clean on a particular file — no matches — and the file is treated as
verified absent of whatever was being searched for.

## What you will wrongly conclude

That an empty result from a text search means the pattern genuinely does
not occur in that file.

## What is actually true

`grep` (and most line-oriented text tools) silently skips a file it
detects as binary rather than erroring, and its output for "this file is
binary, I did not look" is identical to its output for "I looked at every
line and found nothing" — both are silence. A search that cannot read a
file returns nothing, and nothing is exactly what a real no-match also
returns.

`src/services/lockfile.ts` once demonstrated this directly: its composite
dependency key was built with a literal, raw `U+0000` byte as the
separator rather than the `\0` escape sequence —
`` `${dep.name}${NUL}${dep.depType}` `` where `NUL` was an actual embedded
null character in the source file rather than two ASCII characters
spelling out an escape. `file(1)` reported the file's type as `data`
(binary), and a `grep`-based audit of raw `node:` imports across `src/`
silently skipped all 531 lines of the file — returning a result
indistinguishable from a clean pass. An enumeration built from that audit
was consequently wrong about this file, not through a stale line but
through a search that never actually ran against it.

The line is now written as the ordinary two-character escape (`depKey`
composes `` `${dep.name}\0${dep.depType}` ``), which reads identically as
a separator but keeps the file plain text.[^lockfile-service] The runtime
string it produces is unchanged — the NUL character itself is a correct
choice of separator (a package name cannot contain one), only its literal
encoding in the source was wrong. The test suite could not have caught the
original defect on its own: `depKey` is used symmetrically on both sides
of every comparison in the module, so a wrong or malformed separator would
still compare equal to itself, and no test asserts on the byte-level
content of the composed key.

## How to check

- `file src/services/lockfile.ts` — confirm it reports `ASCII text` (or
  similar), not `data`, before trusting any text search over it.
- Before trusting an absence reported by a grep-based audit, demonstrate a
  positive control: plant the pattern being searched for in a copy of the
  file (or in a known-good file) and confirm the same search finds it.
  An absence is only evidence once the search has been shown capable of
  finding the real thing — the same discipline that makes a mutation test
  meaningful rather than decorative.
- Prefer a tool that reads the whole tree without silently excluding
  binary-flagged files, or check exit codes and file lists rather than
  trusting an empty match list at face value, when auditing across many
  files rather than one already-known target.

[^lockfile-service]: `src/services/lockfile.ts:440`
