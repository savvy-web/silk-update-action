---
type: Consumer
title: savvy-web/systems
description: The permanent @dev pin used to prove this action end to end, and the source of the @savvy-web/* first-party dependencies this action dogfoods.
repository: savvy-web/systems
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: e2a211f742fa9828eb57bfa5df2dc7c87e64488cc32d6c139d0c7153afd9f884
sources:
  - id: silk-update-workflow
    resource: ../../.github/workflows/silk-update.yml
  - id: package-json
    resource: ../../package.json
---

# savvy-web/systems

## Surfaces exercised

`savvy-web/systems` pins `uses: savvy-web/silk-update-action@dev` permanently
in its own `Update Silk Dependencies` workflow, rather than pinning a release
tag the way this repository's own `silk-update.yml` pins `@v4`.[^silk-update-workflow]
Because this action is bundled — a consumer running `@dev` executes the
committed `dist/{pre,main,post}.js`, not `node_modules` — that workflow is the
only place a change lands on a real monorepo before it is released, exercising
the full pipeline: package-manager detection, config-dependency resolution
against `pnpm-workspace.yaml`, regular- and peer-dependency updates, lockfile
regeneration, the `check-peers` gate, changeset creation via DepsRegen, and PR
creation with auto-merge.

## Where the edge sits

The edge is a pinned git ref (`@dev`) rather than a release tag, which is what
makes this repository's own `dev` branch a shared, actively-consumed artifact:
a push to `dev` here is immediately live in `systems`' next scheduled or
dispatched run, with no publish step between the two. The other direction of
the edge is dependency provenance: `systems` is the source repository for the
`@savvy-web/*` first-party packages this action itself dogfoods (via `pnpm
link` or a `pnpm-workspace.yaml` override), so a fix needed in one of those
packages is developed in `systems` and consumed here before either side
releases.

## Why this consumer matters

The `check-peers` gate was proven here, not in this repository's own suite —
across three consecutive runs against a real workspace, each of which failed
in a different way: a missing layer provide, a peer report that stayed
permanently `unverified`, and finally a clean `not gating (proven-clean)`
result with auto-merge actually enabled on the resulting PR. None of those
three failure modes was reachable from a mocked or fixture-based unit or
integration suite in this repository — each depended on a real
`pnpm-workspace.yaml`, real config-dependency plugins, and a real installed
lockfile. See [test a `dev`-branch build](../runbooks/test-a-dev-branch-build.md)
for the procedure this consumer's workflow makes possible.

## Open questions

- Whether `act`-based local testing would ever substitute for this consumer as
  a proving ground is explicitly unresolved — see
  [keep persistLocal disabled](../decisions/persist-local-disabled.md), which
  notes no workflow in this repository currently exercises `act` at all.
- Nothing pins which `@savvy-web/*` package versions `systems` has to be on for
  a given `silk-update-action@dev` push to be meaningful; a version skew
  between the two repositories could make a `dev` run pass or fail for reasons
  unrelated to the change under test.

[^silk-update-workflow]: `.github/workflows/silk-update.yml`
