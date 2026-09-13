---
type: Measurement
title: Kit single-copy probe
description: Whether each installed @effected/* package resolves to exactly one copy, and whether a resolved duplicate actually reaches the bundled dist — measured twice, nine days apart, with different answers.
status: draft
stale_after: 2026-12-13T00:00:00Z
tags:
  - deps
  - bundle
justifies:
  - ../decisions/platform-stays-in-requirement-channel.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 78c530aea59158f851b97c19daa75211f16e8bc02da182c09fe3ae79763dfa31
sources:
  - id: pnpm-lock
    resource: ../../pnpm-lock.yaml
  - id: dist-main
    resource: ../../dist/main.js
  - id: package-json
    resource: ../../package.json
---

# Kit single-copy probe

## Inputs

Every installed `@effected/*` package and `effect` itself; the minified
bundled `dist/main.js`; the fully-qualified tag ids
`@effected/workspaces/WorkspaceCatalogs`, `@effected/workspaces/WorkspaceDiscovery`
and `@effected/workspaces/WorkspaceRoot` as the probe targets, with
`@effected/npm/NpmRegistry` and `@effected/github/GitBranch` as controls (each
expected to occur exactly once regardless of the workspaces result).

## Method

`pnpm why <pkg>`, read for its trailing `Found N version` line and, more
importantly, for **who pulls each resolved version** — not a `pnpm-lock.yaml`
grep, which reports which versions exist in the file but not who pulls them.
For the bundle question: grep the **fully-qualified tag id** in `dist/main.js`
and count occurrences, since a bare class name overcounts against method
names, log strings and re-exports.

## Numbers

**2026-09-04 measurement (as recorded in the source material):** all twelve
installed `@effected/*` packages, and `effect` itself, resolved to exactly
one copy. The tag-id probe found `@effected/workspaces/WorkspaceCatalogs`,
`…/WorkspaceDiscovery` and `…/WorkspaceRoot` each occurring once in
`dist/main.js`, matching the two controls at one each. The bare class names,
by contrast, returned 7 / 15 / 4 occurrences respectively — method names, log
strings and re-exports, not distinct bundled copies. The stated conclusion at
the time was that the workspaces duplicate had closed via a shape change
upstream (`@savvy-web/silk-effects` moving `@effected/workspaces` to a
**peerDependency** rather than a direct dependency), not via a version bump —
a peer range the consumer already satisfies cannot produce a second copy,
where a direct `0.x` caret one minor behind necessarily can.

**2026-09-13 re-measurement (this pass):**

```text
$ pnpm why @effected/workspaces
@effected/workspaces@0.21.1
├─┬ @vitest-agent/cli@3.0.0 … (dev tooling chain)
└── … @vitest-agent/{cli,engine,mcp,plugin} only

@effected/workspaces@0.22.0
├─┬ @savvy-web/cli@3.0.2 … (via @savvy-web/silk@4.0.2, @savvy-web/silk-effects@8.0.2)
└── silk-update-action@4.11.21 (dependencies)

Found 2 versions of @effected/workspaces
```

`@effected/github`, `@effected/npm` and `@effected/lockfiles` each still
resolve to exactly **1** version. The tag-id probe in `dist/main.js` is
unchanged: `@effected/workspaces/WorkspaceCatalogs` → 1,
`@effected/workspaces/WorkspaceDiscovery` → 1, `@effected/workspaces/WorkspaceRoot`
→ 1; controls `@effected/npm/NpmRegistry` → 1, `@effected/github/GitBranch` → 1.

## What this rules in and out

- **Rules out (again):** "single copy" as a settled property of this
  dependency graph. It has now been asserted as closed and then falsified by
  a fresh measurement more than once — first by a version-lag duplicate, then
  (per the 2026-09-04 note) by a shape fix, and now again by the `0.21.1` /
  `0.22.0` split found on 2026-09-13. Treat every prior "resolves to one
  copy" statement, including this document's own 2026-09-04 entry, as a
  **dated measurement**, never a standing fact.
- **Rules in:** the duplicate found on 2026-09-13 is **dev-tooling-only** —
  `0.21.1` is pulled exclusively by the `@vitest-agent/{cli,engine,mcp,plugin}`
  chain (a `devDependencies` path), while `0.22.0` is pulled by this action's
  own runtime dependency and by `@savvy-web/silk-effects@8.0.2`. Nothing under
  `dependencies` resolves `0.21.1`.
- **Rules in, and this is the load-bearing result:** the duplicate does
  **not** reach the bundle. The tag-id probe in `dist/main.js` still returns
  exactly 1 for all three workspaces tags and both controls, which is only
  possible because `@savvy-web/github-action-builder` bundles from
  `dependencies`, not `devDependencies` — so a dev-tooling-only duplicate is
  invisible to the shipped artifact even while `pnpm why` genuinely reports
  two resolved versions.
- **What the probe is for, restated:** a resolved-copy count alone
  (`pnpm why`) answers "does the graph contain more than one version" but not
  "does the shipped bundle contain more than one copy." Both questions matter
  and have different answers here — the graph does, the bundle does not — and
  only the tag-id-in-`dist/main.js` probe, with its controls, can distinguish
  them. Skipping the controls would make a coincidental single occurrence
  look like proof of no duplication, and skipping the bundle probe entirely
  would report a false problem based on a devDependency-only split.

Re-derive with `pnpm why @effected/workspaces | tail -1` for the current
resolved-version count, and the three greps against `dist/main.js` for the
bundle question; do not carry any of the counts above forward without
re-running both.

See [the duplicate-kit-copies gotcha](../gotchas/duplicate-kit-copies-and-stale-transitives.md)
for why a resolved duplicate is not, by itself, evidence of a bug, and
[the github 0.6.0 isolating experiment](github-0-6-0-isolating-experiment.md)
for the paired measurement that established that a stale transitive, not the
duplicate itself, is what makes two copies unsafe.
