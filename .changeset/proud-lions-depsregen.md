---
"silk-update-action": minor
---

## Features

- Adopt `@savvy-web/silk-effects` `Changesets.DepsRegen` as the source of truth for the dependency-changeset step. Dependency changesets are now regenerated from the cumulative `merge-base(target-branch) → worktree` diff and consolidated into a single `## Dependencies` table per package, deleting stale pure-dependency changesets — so re-running the action converges instead of accumulating duplicate changesets. Catalog-aware diffing and versionable-minus-ignored gating are handled upstream in silk-effects; the previous in-repo gating cascade and the `changeset-config`/`publishability` shims are removed.
- Workflows that enable `changesets` now need a full-history checkout (`actions/checkout` with `fetch-depth: 0`): the changeset step diffs against the base branch via `git merge-base`. `BranchManager.ensureBaseHistory` best-effort deepens a shallow clone when the base history is missing.
