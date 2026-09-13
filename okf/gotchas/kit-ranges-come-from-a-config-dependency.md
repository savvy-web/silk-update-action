---
type: Gotcha
title: This repository's @effected ranges come from a config dependency, not package.json
description: package.json declares every @effected/* range as a catalog reference; the actual version ranges live in a pnpm config dependency's published catalog, pinned one level away in pnpm-workspace.yaml.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - deps
resource: ../../pnpm-workspace.yaml
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 874ecc7c9c9c4e9ddf4e8a606bfe1992439ee306310fb3c79af7db9e081547bc
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
  - id: package-json
    resource: ../../package.json
---

# This repository's @effected ranges come from a config dependency, not package.json

## What you see

Every `@effected/*` entry in `package.json`'s `dependencies` reads
`"catalog:effected"` rather than a version range — for
example `"@effected/workspaces": "catalog:effected"`.[^package-json] The
apparent source of truth for what this action depends on is a pnpm catalog
protocol reference, and `pnpm-workspace.yaml` names a `configDependencies`
block pinning `@effected/pnpm-plugin-effect` by exact version and integrity
hash.[^pnpm-workspace] Checking the registry shows the published plugin's own
catalog names sane, current ranges, and a fresh install after removing a
dogfood override resolves back to versions that look wrong.

## What you will wrongly conclude

That because `package.json` names no direct range, there is nothing to check
beyond confirming `@effected/pnpm-plugin-effect` itself is up to date on the
registry — and that a stale-looking resolved version after reinstalling means
either the registry has not caught up, or the install is broken.

## What is actually true

The `catalog:effected` protocol means the actual version **ranges** for every
`@effected/*` package are not declared in this repository's own
`package.json` at all — they live inside the `catalogs` export of
`@effected/pnpm-plugin-effect`, a **pnpm config dependency** pinned by exact
version and integrity hash in `pnpm-workspace.yaml`'s
`configDependencies` block.[^pnpm-workspace] Bumping a kit package here is
therefore not a `package.json` edit and cannot be done with `pnpm add` — the
range lives in a published artifact belonging to someone else, and this
repository consumes whichever version its `configDependencies` pin names,
not whichever version the plugin's registry listing currently publishes.

The consequence is specific: after removing a dogfood `file:`/`link:`
override for a kit package and reinstalling, pnpm resolves back to the **old**
versions — because the pinned plugin still carries the old catalog. Every
probe short of the actually-resolved tree looks fine at that point: the
packages exist on the registry at the new versions, and the *published*
plugin's own catalog correctly names the new ranges. The stale thing is the
**pin** in `pnpm-workspace.yaml`, one level up from both of those checks, and
neither the registry nor the plugin's published catalog says anything about
which version of the plugin *this repository* has pinned.

## How to check

- Do not check the registry listing for `@effected/pnpm-plugin-effect` and
  conclude the catalog it names is what this repository installs — that
  proves the *plugin* is current and says nothing about which plugin version
  this repository's `configDependencies` pin resolves.
- Check the resolved tree directly: `node -p
  "require('./node_modules/@effected/npm/package.json').version"` (or grep
  the adopted symbol out of the installed `.d.ts`) after an install, and
  compare it against what the *current* `@effected/pnpm-plugin-effect`
  release's catalog names.
- If they disagree, the fix is bumping the `configDependencies` pin itself —
  both the version and the integrity hash — in `pnpm-workspace.yaml`, then
  reinstalling. Bumping a direct `@effected/*` entry in `package.json` has no
  effect, because none of them declare a direct range to bump.

See [bump the effected kit](../runbooks/bump-the-effected-kit.md) for the
full procedure, including the extra step this pin adds on top of an ordinary
dependency bump, and
[config dependency](../glossary/config-dependency.md) for what the pnpm
mechanism itself provides.

[^pnpm-workspace]: `pnpm-workspace.yaml`
[^package-json]: `package.json`
