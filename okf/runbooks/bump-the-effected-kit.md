---
type: Runbook
title: Bump the @effected kit
description: The extra config-dependency pin, the every-package pnpm why sweep, and the .repos re-pin a kit bump needs beyond an ordinary dependency update.
status: draft
tags:
  - deps
  - compat
resource: ../../pnpm-workspace.yaml
generated:
  by: okfit/claude-code
  at: 2026-09-27T08:37:13Z
  body_sha256: c3eadd66227deefc58be8a6829590eb2f642e98a5e0757828edbfe7b714a424a
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
  - id: package-json
    resource: ../../package.json
  - id: repos-config
    resource: ../../.repos/config.json
---

# Bump the @effected kit

Every `@effected/*` entry in `package.json` reads `"catalog:effected"`
rather than a direct range,[^package-json] so a kit bump is not a
`package.json` edit. The ranges live inside the `catalogs` export of
`@effected/pnpm-plugin-effect`, a pnpm config dependency pinned by bare
exact version in `pnpm-workspace.yaml`'s `configDependencies` block, with
its integrity recorded in the `pnpm-lock.yaml` config-dependency
preamble rather than inline.[^pnpm-workspace] See
[kit ranges come from a config dependency](../gotchas/kit-ranges-come-from-a-config-dependency.md)
for why that makes the registry listing and the plugin's own published
catalog both insufficient checks on their own.

**Trigger:** a newer `@effected/pnpm-plugin-effect` release publishes a
catalog naming newer `@effected/*` versions, and this repository needs to
move onto it.

## Steps

1. Bump the `@effected/pnpm-plugin-effect` entry in `pnpm-workspace.yaml`'s
   `configDependencies` block (`pnpm-workspace.yaml:4-6`)[^pnpm-workspace]
   with `pnpm add --config @effected/pnpm-plugin-effect@<version>`. pnpm
   writes the bare version and records the integrity in the lockfile's
   config-dependency preamble; do not hand-add a `+sha512-` suffix (see
   [write pins bare](../decisions/write-pins-bare.md)).
2. `pnpm clean --lockfile && pnpm install`. Dropping the lockfile is
   load-bearing: the lockfile's body pins the previously resolved
   `@effected/*` versions independently of the plugin pin, so a plain
   `pnpm install` after the bump can keep the old versions.
3. Verify the resolved versions from the installed tree, never from the
   registry or the plugin's own published catalog: for example
   `node -p "require('./node_modules/@effected/npm/package.json').version"`.
   Checking the registry only proves the *plugin* published a sane catalog;
   it says nothing about which plugin version this repository's pin
   actually resolves.
4. `pnpm why <pkg>` on **every** `@effected/*` package this repository
   installs, not only the one the bump was nominally about — the range
   that needs attention after a wave of kit releases is frequently not the
   package named in the change. See
   [a caret on a 0.x dependency pins the minor](../gotchas/caret-pins-minor-on-0x.md)
   for why a `0.x` package can sit stale behind a satisfied range with no
   warning anywhere in the install path.
5. `pnpm typecheck`. If the failing-file list is large and dominated by
   call sites that never mention a renamed API — every constructor
   reporting a wrong argument count, every field getter reporting a
   missing property — that shape is itself the signal: find the
   declaration the failures actually trace back to before touching a
   single call site. See
   [an Effect Schema base-class rename presents as call-site errors](../gotchas/tagged-error-rename-presents-as-call-site-errors.md).
   A leftover requirement reported by
   [the compile-time layer guard](../decisions/compile-time-layer-guard.md)
   is a distinct failure shape with at least three possible causes — a
   missing `Layer.provide`, a genuine duplicate whose shape has drifted, or
   a stale transitive inside one copy — and the compiler error names only
   the missing type, never which of the three produced it.
6. `pnpm test`.
7. `pnpm build:prod`.
8. Probe the rebuilt bundle for an unexpected second copy: grep the
   **fully-qualified tag id** (for example
   `@effected/workspaces/WorkspaceCatalogs`) in `dist/main.js`, not the bare
   class name, which overcounts against method names, log strings and
   re-exports. See
   [a duplicate kit package and a type error are not necessarily cause and effect](../gotchas/duplicate-kit-copies-and-stale-transitives.md)
   for how to read what the probe finds.
9. Re-pin `.repos/config.json`'s `effected` entry's `ref` field to the
   release tag matching the versions just installed, in the **same commit**
   as the bump.[^repos-config] Verify the re-pin by comparing the vendored
   `packages/<name>/package.json` at that ref against `node_modules`, never
   by reading the tag name — use `/silk:repos` (the `repos_manage` tool)
   rather than a manual submodule checkout.
10. Write a changeset describing the bump.

## Observable end state

`pnpm why <pkg>` on every installed `@effected/*` package reports the
version the new plugin release's catalog names; `pnpm typecheck`,
`pnpm test`, and `pnpm build:prod` are all clean; `.repos/config.json`'s
`effected.ref` names the release tag matching what is actually installed;
and a changeset for the bump exists.

## Related

[Dogfood a first-party dependency](dogfood-a-first-party-dependency.md) is
the companion procedure for proving a kit fix *before* it publishes, rather
than pulling it in after the fact through this pin.

[^pnpm-workspace]: `pnpm-workspace.yaml`
[^package-json]: `package.json`
[^repos-config]: `.repos/config.json`
