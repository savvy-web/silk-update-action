---
type: Measurement
title: Isolating experiment over a duplicated @effected/github pair
description: A controlled comparison across two states of the same duplicated pair, showing that the duplicate held constant while the type-check result flipped — so the stale transitive dependency inside one copy, not the duplication itself, was the actual variable.
status: draft
stale_after: 2026-12-13T00:00:00Z
tags:
  - deps
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: c4df67dbd5e8f5403ca1f0ac7ce0c63469701e6274c8158a4a3a48c4a2201dcc
sources:
  - id: pnpm-lock
    resource: ../../pnpm-lock.yaml
---

# Isolating experiment over a duplicated @effected/github pair

## Inputs

Two resolved versions of `@effected/github` present in the dependency graph
at the same time — one pulled directly by this repository, one pulled
transitively through `@effected/github-actions` — at two different pairings,
and a `tsc` type error naming `GitHubClient` that appeared alongside one of
them.

## Method

Revert the declared range that introduced the duplicate, reinstall, and
typecheck — twice, holding "a duplicate exists" constant across both runs and
varying only which two versions were paired.

## Numbers

| `@effected/github` copies present | count | `tsc` result |
| --- | --- | --- |
| `0.6.0` + `0.7.0` (the latter via `@effected/github-actions`) | 2 | **fails**, `Type 'boolean' is not assignable to type 'GitHubClient'` |
| `0.6.1` + `0.7.0` | 2 | **clean** |

Both rows have the identical duplication count. Only the type-check result
changed. The difference between `0.6.0` and `0.6.1` was two of `0.6.0`'s own
transitive dependencies: `@octokit/types` moved `^16` → `^17` and
`@octokit/plugin-paginate-rest` moved `^14` → `^15`. `GitHubClient`'s exported
type embeds octokit's types directly, so at `0.6.0` the client one copy
produced was structurally incompatible with what the resource layers, built
against the other copy's dependencies, required.

The lockfile had been holding `0.6.0` for an unrelated reason worth recording
alongside the result: a caret range (`^0.6.0`) that is already satisfied is a
range `pnpm` never revisits on an ordinary install, so the stale transitive
persisted silently until something else in the graph forced a fresh
resolution.

## What this ruled in and out

- **Ruled out:** "two copies of a package meet in one signature" as a
  sufficient condition for a type error. The `0.6.1` + `0.7.0` row has the
  same shape of duplication as the failing row and typechecks clean.
- **Ruled in:** a duplicate is safe **while the two copies' shapes agree**,
  and unsafe when one copy's own transitive dependency has drifted from what
  the other copy's dependents were built against. Effect resolves services by
  the tag's string id rather than by object identity, so a layer built from
  either copy satisfies a requirement from the other precisely as long as the
  shapes underneath agree.
- **What this does not establish:** that duplication is never worth fixing.
  The fix that actually landed (moving off `0.6.0` entirely) also happened to
  be the right call for the unrelated reason that this repository keeps one
  copy of each kit package for bundling reasons — but that is a separate
  argument from "the duplicate caused the type error," which this experiment
  shows was false.

See [the duplicate-kit-copies gotcha](../gotchas/duplicate-kit-copies-and-stale-transitives.md)
for the general lesson this measurement supports, and
[the 2026-09-04 kit single-copy probe](kit-single-copy-probe-2026-09-04.md)
for how a resolved-copy claim should be checked (`pnpm why`, plus a
tag-id-in-`dist` probe for whether a duplicate actually reaches the bundle).
