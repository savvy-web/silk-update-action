---
type: Glossary
title: release-age gate
description: This action's resolution-time mirror of pnpm's minimumReleaseAge/minimumReleaseAgeExclude, combined strictest-wins across inline settings and replayed config-dependency hooks, and fail-open by design.
status: draft
tags:
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: e6b041d36c65173338e6ed4ee10442a6f5490b41f485c948f48ade8f72a0886d
sources:
  - id: release-age-service
    resource: ../../src/services/release-age.ts
---

# release-age gate

**pnpm's own sense:** `minimumReleaseAge` and `minimumReleaseAgeExclude` are
pnpm settings, checked at *install* time, that reject resolving a version
published inside a cutoff window (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`).

**This action's sense** is the same policy, mirrored one step earlier: at
*resolution* time, before this action ever proposes a version, so it never
suggests something pnpm would go on to refuse at install. `ReleaseAge`
combines the inline `pnpm-workspace.yaml` keys with whatever a
config-dependency pnpmfile hook injects via `updateConfig`, strictest source
wins, and discovery of that combined gate belongs to
`@effected/workspaces`' `WorkspaceCatalogs.releaseAgeGate()` rather than to
this action's own code.[^release-age-service] Filtering by the gate is a
local concern: `ReleaseAge.filterVersions` drops any candidate version too
young to satisfy it before resolution ever sees it.[^release-age-service]

The gate **fails open**: a discovery failure (a broken pnpmfile, a subprocess
timeout, a misparsed payload) degrades to the inert zero gate with a warning
rather than aborting the run, because pnpm re-enforces the real gate at
install regardless. See
[release-age gate discovery fails open](../decisions/release-age-fail-open.md)
for why that posture is deliberate, and
[hook logging after the payload](../limitations/hook-logging-after-payload.md)
for the specific way discovery can silently fail.

[^release-age-service]: `src/services/release-age.ts`
