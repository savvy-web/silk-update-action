---
type: Limitation
title: No main/index.js fallback when a config dependency's exports map does not match
description: The bun catalog-merge path's entry resolver is stricter than this action's own hand-rolled predecessor — a require-only config dependency shipping main but no matching exports condition resolves to nothing instead of falling back.
status: draft
tags:
  - compat
bounds: ../decisions/catalog-base-routing.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 567a69b49441a1e1da7210b1a3d5f401abf20880385296e7da506090d5444d7f
sources:
  - id: module-catalogs
    resource: ../../src/services/module-catalogs.ts
  - id: effected-282
    resource: "https://github.com/spencerbeggs/effected/pull/282"
---

# No main/index.js fallback when a config dependency's exports map does not match

## Condition

`fetchModuleCatalogs` resolves the extracted tarball's entry point with
`@effected/package-json`'s `resolveEntryPoint`, adopted from
`effected#282`.[^module-catalogs][^effected-282] That function implements
Node's `exports` encapsulation rule literally: when a package declares
`exports` and no condition in it matches, resolution fails rather than
falling through to a `main` or `index.js` field. This action's own
predecessor resolver did fall through, and the kit's adoption changed that
behavior deliberately, not by omission.

## Symptom

A config dependency whose `package.json` declares an `exports` map with no
matching condition — most concretely, a package that ships **only**
`require`-style entry points and no `import`/`default` condition bun's
loader can select, while also naming a `main` field — resolves to nothing.
`fetchModuleCatalogs` reports this as `Unavailable` with reason
`unresolvedEntryPoint`,[^module-catalogs] which `CatalogConfigDeps` then
routes to the conservative "skip this dependency" path rather than reading
any catalogs from it, because the base or next version cannot be read
faithfully.

## Why acceptable

Measured against what this repository actually consumes today, the gap is
unreached: both config dependencies wired into this repository declare a
`"."` conditions map carrying `import` and `default`, and **neither declares
a `main` field at all**, so the old fallback could never have fired for
either of them even under the previous, lenient resolver. The stricter
behavior is also the *correct* one per Node's own encapsulation rule — a
lenient fallback resolves a file the package deliberately does not export,
which is not a behavior worth preserving purely for compatibility with a
resolver this action no longer owns.

## What a fix would take

The residual exposure is unbounded in principle: any consumer of this action
could name a `require`-only config dependency that ships a `main` field with
no matching `exports` condition, and that dependency's catalogs would then be
unreachable. A fix would mean either the upstream `resolveEntryPoint`
growing an opt-in fallback mode (which would reopen the exact hazard Node's
encapsulation rule exists to close), or this action detecting the
`unresolvedEntryPoint` reason specifically and falling back to a local,
narrower `main` read — at the cost of resolving a file the package did not
intend to be imported this way.

[^module-catalogs]: `src/services/module-catalogs.ts`
[^effected-282]: <https://github.com/spencerbeggs/effected/pull/282>
