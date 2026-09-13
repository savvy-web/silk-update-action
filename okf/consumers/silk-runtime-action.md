---
type: Consumer
title: savvy-web/silk-runtime-action
description: The next step in the pipeline, which reads devEngines.runtime this action writes and rejects any range operator in it.
repository: savvy-web/silk-runtime-action
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: e20987b9d7974b75e697b3862218962b187d1020c30d11a6d50b76a8331f6869
sources:
  - id: runtime-upgrade-service
    resource: ../../src/services/runtime-upgrade.ts
  - id: silk-update-workflow
    resource: ../../.github/workflows/silk-update.yml
---

# savvy-web/silk-runtime-action

## Surfaces exercised

`silk-runtime-action` reads the `devEngines.runtime` field of a workspace's
root `package.json` — the same field `RuntimeUpgrade.upgrade` writes when
`upgrade-runtime-{node,deno,bun}` is enabled — to set up the pinned runtime
version for a later CI job. This repository's own `silk-update.yml` workflow
runs `savvy-web/silk-runtime-action@v1` as an earlier step in the same job that
later runs this action, which is one concrete occurrence of the pipeline
relationship rather than the only place it occurs.[^silk-update-workflow]

## Where the edge sits

This action writes `devEngines.runtime.<name>.version`; `silk-runtime-action`
reads it in whatever run comes after this action's PR is merged. The two
repositories share no code and no schema beyond that one manifest field, so
the entire contract is: whatever this action commits into `devEngines.runtime`
must be a value `silk-runtime-action` can consume without further
interpretation.

## Why this consumer matters

`silk-runtime-action` **does not support range operators** in
`devEngines.runtime`. That single fact is why
[`RuntimeUpgrade` always writes a bare, exact resolved version and never a
range](../decisions/runtime-upgrade-only-exact.md), in every mode — `auto` and
an explicit range alike both resolve within a range but only ever write the
concrete result. Writing an operator (`^24.9.1` rather than `24.9.1`) would
satisfy this action's own validation and only fail one step later, in a
consumer's CI run, with no visibility back into the run that wrote it.

## Open questions

- Whether `silk-runtime-action` will ever add range-operator support is
  outside this repository's control; if it did, the "always exact" rule would
  likely still hold for its other stated reason (a bare version is
  unambiguous evidence of what was actually resolved) but would no longer be
  forced by a hard downstream failure.
- Nothing in this action verifies, at the point it writes
  `devEngines.runtime`, that the value it wrote is actually consumed
  correctly by `silk-runtime-action` in a later run — the contract is
  asserted, not round-tripped.

[^silk-update-workflow]: `.github/workflows/silk-update.yml`
