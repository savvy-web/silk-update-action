---
status: current
module: silk-update-action
category: architecture
created: 2026-02-06
updated: 2026-06-13
last-synced: 2026-07-05
completeness: 95
related: []
dependencies: []
implementation-plans: []
---

# Silk Update Action

## Overview

The `silk-update-action` is a GitHub Action that automates updates to pnpm config dependencies,
regular dependencies, and peer dependencies. Unlike Dependabot, this action supports
[pnpm's config dependencies](https://pnpm.io/config-dependencies) feature, which allows dependencies to be
declared in `pnpm-workspace.yaml` for centralized version management across a monorepo. It also syncs peer
dependency ranges across workspace packages to keep them consistent.

**Key Features:**

- Upgrades pnpm itself via the `upgrade-package-manager` input (`false`/`true`/`auto`/a semver range) by editing the `packageManager` and `devEngines.packageManager` fields directly with a hash-pinned version — `true`/`auto` stay within the current major, an explicit range may cross majors
- Upgrades `devEngines.runtime` engines (node/deno/bun) via `runtime-resolver` (`RuntimeUpgrade` service), with `auto`/explicit-range modes and offline/live data sources. It only ever upgrades an entry the manifest already declares (never adds one), and always writes the bare resolved version — the range drives resolution only
- Updates config dependencies via direct npm queries and YAML editing, resolving within a conservative range synthesized from the current major rather than jumping to npm's absolute latest
- Updates regular dependencies via direct npm registry queries (avoids `catalogMode: strict` issues), resolving the highest version within each dependency's declared specifier range rather than the absolute latest
- Syncs peer dependency ranges across workspace packages (`syncPeers` helper) with configurable lock/minor strategies
- Supports glob patterns for dependency matching
- Runs custom commands after updates (linting, testing, building)
- Integrates with Changesets for versioning by delegating the dependency-changeset step to `@savvy-web/silk-effects`' `Changesets.DepsRegen`, which regenerates a consolidated per-package dependency changeset from the cumulative `merge-base(target) → worktree` git diff and applies its own versionable-minus-ignored gating upstream (requires a `fetch-depth: 0` checkout)
- Regenerates the lockfile via `pnpm clean --lockfile` then `pnpm install --frozen-lockfile=false` so it reflects the changed pnpm version, config and ranges (advancing transitives is expected, not noise)
- Uses GitHub App authentication across a three-phase (pre/main/post) token lifecycle coordinated by the `GitHubToken` namespace for secure, short-lived tokens
- Manages dedicated update branch with delete-and-recreate strategy
- Creates verified/signed commits via GitHub API (`GitCommit.commitFiles`)
- Creates detailed PR summaries with dependency changes

## Purpose and Goals

**Primary Goals:**

1. **Config Dependency Support**: Fill the gap left by Dependabot's lack of config dependency support
2. **Monorepo Centralization**: Enable centralized dependency management in pnpm monorepos
3. **Automation**: Reduce manual effort in keeping dependencies up-to-date
4. **Safety**: Provide clear visibility into what's being updated via detailed PR summaries
5. **Integration**: Work seamlessly with existing tools (Changesets, CI/CD, code review)
6. **Flexibility**: Support custom commands after updates (linting, testing, building)

**Non-Goals:**

- Replace Dependabot entirely (complementary tool)
- Manage dependencies for other package managers (config/regular/peer dependency updates are pnpm-specific). The `upgrade-package-manager` input is deliberately named generically — it currently upgrades pnpm only, but support for upgrading other package managers is planned
- Automatically merge PRs (requires human review)
- Handle breaking change detection (relies on semver and testing)

## Navigation Guide

Load sections based on what you are working on. Do not load all sections at once.

| Work Context | Section | File |
| --- | --- | --- |
| Runtime deps, key packages | Dependencies | @./01-dependencies.md |
| Module structure, data flow, pre/main/post execution | Architecture | @./02-architecture.md |
| Core interfaces, Effect error types | Type Definitions | @./03-type-definitions.md |
| pre/main/post + program.ts entry points | Entry Points | @./04-module-entry-points.md |
| Domain services, layer composition, pure helpers | Services & Utilities | @./05-module-library.md |
| Service architecture, error handling, retry, resource mgmt | Effect Patterns | @./06-effect-patterns.md |
| Auth, branch mgmt, check runs, PR management | GitHub Integration | @./07-github-integration.md |
| Unit/integration tests, fixtures, coverage | Testing | @./08-testing.md |
| Implementation plan, current state, rationale, related docs | Project Status | @./09-project-status.md |
