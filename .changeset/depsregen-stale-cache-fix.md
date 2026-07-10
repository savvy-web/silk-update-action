---
"silk-update-action": patch
---

## Bug Fixes

The changeset step no longer silently writes zero changesets when dependency updates were applied earlier in the same run. The bundled `workspaces-effect` and `@savvy-web/silk-effects` now refresh the workspace-discovery cache before `DepsRegen` snapshots the worktree, so the diff sees the just-updated manifests instead of the ones cached before the update steps ran.

## Documentation

* Corrected the README and `docs/` guide to describe the `source-branch` / `target-branch` inputs and the `pnpm clean --lockfile` regeneration step, which were previously documented as always resetting to `main` and reconciling via `--fix-lockfile`
