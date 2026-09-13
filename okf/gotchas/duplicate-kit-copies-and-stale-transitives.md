---
type: Gotcha
title: A duplicate kit package and a type error are not necessarily cause and effect
description: Two resolved copies of an @effected package look like the obvious explanation for a type error touching its exported type, and measurement has shown that reading to be wrong.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - deps
  - bundle
resource: ../../pnpm-lock.yaml
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 48420bff4b885af2687357d8b2d9014d15b3d78426e7e7155f4c0f48746a5278
sources:
  - id: pnpm-lock
    resource: ../../pnpm-lock.yaml
  - id: package-json
    resource: ../../package.json
  - id: dist-main
    resource: ../../dist/main.js
---

# A duplicate kit package and a type error are not necessarily cause and effect

## What you see

`pnpm why <pkg>` reports **more than one** resolved version of an
`@effected/*` package — `@effected/workspaces` currently resolves both
`0.21.1` (pulled in by dev tooling's plugin chain) and `0.22.0` (pulled in by
`@savvy-web/silk-effects`'s own dependency chain)[^pnpm-lock] — at the same
time a type error names a type that package exports. The two facts sit next
to each other and look like one explains the other.

## What you will wrongly conclude

That the duplicate **is** the bug: two copies of a package mean two distinct
nominal types, so anywhere the two copies' values meet in one signature must
be a type mismatch, and the fix is simply to force a single resolution.

## What is actually true

Effect resolves services by the tag's **string id**, not by object identity,
so a layer built from either copy of a duplicated package satisfies a
requirement from the other — **while the two copies' shapes agree.** A
duplicate is not unsafe by construction; it is unsafe only when one copy's
shape has drifted from what the code consuming the other copy expects, which
is a narrower and different condition than "more than one copy exists."

This was tested directly rather than assumed, on a real duplicate-plus-error
pair in this repository's dependency graph: reverting the range that produced
the duplicate, reinstalling, and typechecking against two different states of
the *same* duplicated pair showed the duplication holding constant while the
type-check result flipped from failing to clean. What actually explained the
failure was a stale **transitive** dependency embedded inside the older of
the two copies — an upstream type package that copy still depended on at an
older major, producing a structurally incompatible shape from the newer
copy's dependents. The duplicate was present in both the failing and the
passing state; only the stale transitive explained the difference. See
[the isolating experiment](../measurements/github-0-6-0-isolating-experiment.md)
for the paired measurement that established this, and
[the single-copy probe](../measurements/kit-single-copy-probe-2026-09-04.md)
for how a resolved-copy-count claim is verified rather than assumed.

A leftover requirement surfacing in
[the compile-time layer guard](../decisions/compile-time-layer-guard.md) has
at least three possible causes, and a duplicate is only one: a missing
`Layer.provide`, a genuine duplicate whose shapes have drifted, or — the one
easiest to miss — a single copy whose own transitive dependency has drifted
from what its peers were built against. The guard's compiler error names the
*type*, never which of the three produced it.

## How to check

- Verify a duplicate with `pnpm why <pkg>`, **never** a `pnpm-lock.yaml`
  grep. A lockfile grep reports which versions exist in the file; only
  `pnpm why` reports who actually pulls each one, and provenance is the
  question that matters.
- If checking whether a duplicate has reached the bundled `dist/main.js`,
  grep the **fully-qualified tag id** — for example
  `@effected/workspaces/WorkspaceCatalogs` — and not the bare class name.
  The bare name matches method names, log strings and re-exports and
  overcounts; the fully-qualified tag id occurs exactly once per class
  declaration actually bundled, which is what makes an occurrence count over
  minified output usable at all.[^dist-main]
- Before treating a duplicate as the explanation for a type error, isolate
  it: revert only the range that introduced the duplicate, reinstall, and
  typecheck. If the error persists with the duplicate gone, or if a
  different two-copy state passes cleanly, the duplicate was never the
  variable — look at each copy's own transitive dependencies instead.
- Do not treat "the ranges now agree" as a durable fix. It lasts only until
  one side moves again; a dependency being declared as a `peerDependency`
  rather than a direct dependency is a structurally different and more
  durable fix, because a peer range the consumer already satisfies cannot
  produce a second copy at all.

[^pnpm-lock]: `pnpm-lock.yaml`
[^dist-main]: `dist/main.js`
