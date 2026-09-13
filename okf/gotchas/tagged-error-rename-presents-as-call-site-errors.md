---
type: Gotcha
title: An Effect Schema base-class rename presents as dozens of unrelated call-site errors
description: When an Effect v4 prerelease renames a Schema class-factory base, the resulting typecheck failures overwhelmingly name call sites that never touch the renamed API, because the base type collapsing is what breaks every constructor and field getter built on it.
status: draft
stale_after: 2026-12-13T00:00:00Z
tags:
  - compat
  - dx
resource: ../../src/errors/errors.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 25db0f4ea9d9a0c42a9638b07f2ec103d09127089206e09e6282257fc0574823
sources:
  - id: errors-ts
    resource: ../../src/errors/errors.ts
  - id: effect-package-json
    resource: ../../node_modules/effect/package.json
---

# An Effect Schema base-class rename presents as dozens of unrelated call-site errors

## What you see

After advancing the `effect` catalog pin across an Effect v4 prerelease
boundary, `pnpm typecheck` reports a large number of errors spread across
many files — every `new SomeError({...})` construction reporting "Expected 0
arguments, but got 1," and every field getter on a tagged error reporting a
missing property. The failing files are overwhelmingly ordinary call sites
that construct or read a tagged error; almost none of them mention any
identifier that actually changed.

## What you will wrongly conclude

That a prerelease advance broke a large, diffuse surface of the codebase —
error construction throughout, field access throughout — and that the fix
will need to touch every one of the reported call sites individually.

## What is actually true

The actual change was a rename at a **small number of declaration sites**:
Effect v4's schema-based tagged-error factory was renamed at one prerelease
boundary and renamed back at a later one (`Schema.TaggedErrorClass` in the
intervening betas, `Schema.TaggedError` both before and after — the curried
shape is identical, only the name moved). Every class in
`src/errors/errors.ts` that extends this factory is declared with whichever
name the installed `effect` version currently exports.[^errors-ts] When the
installed name and the declared name disagree, the **base type each error
class extends collapses**, and every constructor call and every generated
field getter built on that base fails — not because the call sites changed,
but because the type they all inherit from stopped existing under that name.

That is why the failing-file list is dominated by call sites: a rename at
four declaration sites in this codebase's own history produced fifty errors
across fourteen files, and only two of those errors named the renamed API
directly. Fixing the declarations cleared every one of the other
forty-eight. **An advance whose error list is dominated by call sites is
usually a declaration-site problem — find the declaration before touching a
single call site.**

Nothing else about the migration needed local repair on the occasion this
was observed: no compatibility shim, no patched type declaration, no manual
retargeting of anything else in the dependency graph. The kit republished
native to the new prerelease, so re-declaring the four affected classes with
the current name was sufficient.

## How to check

- Read the currently installed `effect` version's exports directly —
  `node -p "require('./node_modules/effect/package.json').version"` against
  the schema module's actual export name — rather than assuming a name from
  memory or from a previous advance.[^effect-package-json]
- Before editing any call site that constructs or reads a tagged error, grep
  every class declaration in `src/errors/errors.ts` for the factory name it
  extends, and confirm that name matches what the installed `effect` version
  currently exports.
- If the failing-file list is large and heterogeneous but the errors
  themselves are shaped like "wrong argument count" or "missing property" on
  a tagged-error type, treat that shape itself as the signal: check the
  declaration sites first, and re-run the typecheck after fixing only those
  before touching any call site.
- Do not assume a rename requires a shim, a patched `.d.ts`, or any other
  local repair; check whether the kit has simply republished under the
  current name before building one.

[^errors-ts]: `src/errors/errors.ts`
[^effect-package-json]: `node_modules/effect/package.json`
