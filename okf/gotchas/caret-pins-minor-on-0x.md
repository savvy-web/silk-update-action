---
type: Gotcha
title: A caret on a 0.x dependency pins the minor, and pnpm never revisits a satisfied range
description: pnpm install exits 0 while silently leaving a 0.x dependency on an old minor, because a caret range that is already satisfied is a range pnpm never re-resolves.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - deps
resource: ../../package.json
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 2dc491a3faf69ef6ba0e98b982d3f669af3ef46e88df7511750376e15cc53f26
sources:
  - id: package-json
    resource: ../../package.json
---

# A caret on a 0.x dependency pins the minor, and pnpm never revisits a satisfied range

## What you see

`pnpm update` runs clean, `pnpm install` exits `0`, and a `0.x` dependency
declared with a caret range — for example `@okfit/plugin: "^0.3.3"` in this
repository's own `package.json`[^package-json] — sits at some installed
version that looks current. Nothing in the install output, the exit code, or
a routine `pnpm update` pass suggests the dependency is behind.

## What you will wrongly conclude

That a caret range keeps a `0.x` package current the same way it would for a
`1.x` package, and that a clean install is evidence the dependency graph
reflects the latest compatible releases.

## What is actually true

semver's caret operator pins the **minor** on a `0.x` version, not the major:
`^0.9.5` does not admit `0.10.0`, and `^0.2.1` does not admit `0.3.0`. That
half is normal semver behavior and is not the trap by itself.

The trap is the second half, and it fails silently: **a range that is already
satisfied is a range pnpm never revisits.** Once a `0.x` dependency resolves
to a version its caret range admits, `pnpm install` has no reason to look
again — it is satisfied, by definition — so the lockfile can hold that
version for months while every one of its peers moves forward underneath it.
Nothing in the install path distinguishes "correctly pinned" from "silently
stale behind a satisfied range"; both produce the same exit code `0` and the
same absence of a warning.

This has produced a real, live failure in this codebase's dependency graph:
a `0.x` kit package crossed a minor release upstream while this repository's
declared range still admitted the old minor, so the lockfile kept the old
version resolved while code elsewhere had already moved onto the newer
surface — install succeeded, and the mismatch surfaced only later, as a type
or runtime error unrelated to the dependency bump that actually caused it.

## How to check

- Never trust the install's exit code, and never trust a bare version-string
  read via `require(...).version` in isolation — that only reports what is
  installed, not what a declared range should admit today.
- Run `pnpm why <pkg>` and read the resolved version against the *current*
  upstream release line, not against what the declared range says is
  satisfied.
- After bumping any `0.x` dependency's peers, check every other `0.x`
  dependency's declared range by hand — `pnpm update` will not surface a
  stale one that is still technically satisfied.
- For a `0.x` package pulled in by a **catalog** rather than a direct
  `package.json` range — as most of this repository's `@effected/*`
  dependencies are — the same trap applies one level removed: see
  [kit ranges come from a config dependency](kit-ranges-come-from-a-config-dependency.md)
  for where those ranges actually live and how to check them.

See [bump the effected kit](../runbooks/bump-the-effected-kit.md) for the
procedure that re-checks every kit package's range on a bump, and
[duplicate kit copies and stale transitives](duplicate-kit-copies-and-stale-transitives.md)
for the related failure this same mechanism can produce when two copies of a
package resolve at once.

[^package-json]: `package.json`
