---
type: Consumer
title: savvy-web/systems
description: A release-tag consumer since 2026-08-20 (it pinned @dev before that), and the source of the @savvy-web/* first-party dependencies this action dogfoods.
repository: savvy-web/systems
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-19T03:30:32Z
  body_sha256: 8e9b08be0c6f2681958a46b4b19866289e66f071f603f6ed6259f116fdad4a7c
sources:
  - id: silk-update-workflow
    resource: ../../.github/workflows/silk-update.yml
  - id: package-json
    resource: ../../package.json
---

# savvy-web/systems

## Surfaces exercised

`savvy-web/systems` pins `uses: savvy-web/silk-update-action@v4` in its
`Update Silk Dependencies` workflow, the same release tag this repository's own
`silk-update.yml` pins.[^silk-update-workflow] It pinned `@dev` until
`38db65f6` (2026-08-20, "ci: revert to standard update config"); since then
NO consumer runs the `dev` branch build permanently, and proving a `dev` build
end to end means flipping a ref for the duration of the test (see
[test a dev-branch build](../runbooks/test-a-dev-branch-build.md)). What a
run there still exercises is the full pipeline on a real monorepo:
package-manager detection, config-dependency resolution against
`pnpm-workspace.yaml`, regular- and peer-dependency updates, lockfile
regeneration, the `check-peers` gate, changeset creation via DepsRegen, and PR
creation with auto-merge.

## Where the edge sits

The edge is the `@v4` release tag, so a push to `dev` here reaches `systems`
only after a release moves the tag — a `dev` push is no longer live in its
next scheduled run. The other direction of
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
