# Project Status

[Back to index](./_index.md)

## Current State

**Status:** Effect-first restructure complete and migrated to
`@savvy-web/github-action-effects@^2.0.0` / `workspaces-effect@^1.0.0`. The
action now runs as three phases (`pre` / `main` / `post`) around the 2.0
`GitHubToken` token lifecycle. All domain logic is wrapped as Effect services
with `Context.Tag` + `Layer`, plus a few standalone helper modules (`PeerSync`,
`WorkspaceYaml`). Layer composition centralized in `src/layers/app.ts`. The
action uses `workspaces-effect` for workspace enumeration and
`@savvy-web/silk-effects@^0.4.0` for publishability detection and
changeset-config reading; `workspace-tools` is no longer a dependency.

**Architecture (current):**

- **Three-phase entry:** `src/pre.ts` provisions the GitHub App installation
  token (`GitHubToken.provision`, fail-fast scope check) and records a start
  time; `src/main.ts` is a thin wrapper calling `Action.run(program)` (no
  `{ layer }`); `src/post.ts` reports total duration and revokes the token
  (`GitHubToken.dispose`, honoring `skip-token-revoke`). The testable `program`
  Effect lives in `src/program.ts` along with `runCommands` and `runInstall`
  helpers. Cross-phase state schemas live in `src/state.ts` (`StartTimeState`,
  `STATE_KEYS`).
- **Effect-first services:** Domain services in `src/services/` —
  `BranchManager`, `PnpmUpgrade`, `ConfigDeps`, `RegularDeps`,
  `Report`, `Lockfile`, `Changesets`. `ChangesetConfig` and the
  `PublishabilityDetector` Tag overrides are no longer local — they come
  from `@savvy-web/silk-effects`, and `services/changeset-config.ts` /
  `services/publishability.ts` are thin re-export shims over it. Stateless
  helpers (`PeerSync`, `WorkspaceYaml`)
  export functions without their own Tag. Workspace enumeration goes
  through `WorkspaceDiscovery` from `workspaces-effect` directly — the
  local `Workspaces` wrapper service was removed (issue #38) when
  `workspaces-effect` exposed cwd-accepting methods upstream.
- **Layer composition:** `makeAppLayer(dryRun)` in `src/layers/app.ts` wires
  all library and domain layers together. The `GitHubClient` is built from
  `GitHubToken.client()` (over a self-contained `ActionStateLive`,
  `Layer.orDie`), which reads the token envelope `pre` persisted to
  `ActionState` — there is no bare `GitHubClientLive` and no
  `process.env.GITHUB_TOKEN` bridge. The layer factory takes only `dryRun`.
- **Pure helpers:** `src/utils/` contains stateless functions (`deps.ts`,
  `input.ts`, `markdown.ts`, `pnpm.ts`, `semver.ts`).
- **No barrel re-exports:** Direct imports everywhere, no `index.ts` files.
- **Co-located tests:** Each `.ts` file has a `.test.ts` sibling.
- **Library services:** `NpmRegistry` (npm queries), `PullRequest` (PR
  management with auto-merge), `GithubMarkdown` (markdown utilities),
  `OctokitAuthAppLive` (provides `GitHubAppLive`'s auth dependency).

**Implemented Features:**

- Three-phase (`pre` / `main` / `post`) execution. The dependency-update
  workflow is orchestrated in `program.ts` (`main` phase); token provisioning
  and revocation live in `pre.ts` / `post.ts`.
- GitHub App token lifecycle via the `GitHubToken` namespace: `provision()`
  (pre, fail-fast scope check) → `client()` (main, builds `GitHubClient`) →
  `dispose()` (post, honoring `skip-token-revoke`, never fails the workflow).
  The envelope is persisted to `ActionState` (backed by `GITHUB_STATE`) — no
  `process.env.GITHUB_TOKEN` bridge.
- Branch management with delete-and-recreate strategy via `BranchManager`
  service.
- Config dependency updates via `ConfigDeps` service (uses `NpmRegistry`).
- Regular dependency updates via `RegularDeps` service (uses `NpmRegistry`
  and `WorkspaceDiscovery` from `workspaces-effect`). Iterates
  `dependencies`, `devDependencies`, and `optionalDependencies`
  independently and reports the real section type per update —
  `peerDependencies` are managed by `syncPeers`.
- Peer dependency range syncing via `syncPeers` (`peer-lock` and
  `peer-minor` strategies, powered by `semver-effect`).
- pnpm self-upgrade via `PnpmUpgrade` service.
- Lockfile reconciliation via `runInstall`:
  `pnpm install --frozen-lockfile=false --fix-lockfile` (replaces the older
  `rm -rf node_modules pnpm-lock.yaml && pnpm install` clean-install).
- Workspace YAML formatting via `WorkspaceYaml` helpers.
- Custom command execution via `runCommands` (`sh -c`) with error collection.
- Lockfile comparison via `Lockfile` service. Catalog comparison emits one
  `LockfileChange` per (catalog change, consuming importer, dep section)
  triple, carrying the precise `type` field so downstream consumers can
  trigger off `type` alone.
- Changeset creation via `Changesets` service. The gating rules (ignore gate, versionable cascade and trigger/informational classification) replace the previous always-on patch fallback. A changeset-ignored package (per
  `ChangesetConfig.isIgnored`) is skipped before the publishability check, so
  the `.changeset/config.json` `ignore` list wins even when
  `privatePackages.version: true`. Empty changesets are no longer written.
  The third parameter to `Changesets.create` was renamed from `devUpdates`
  to `regularUpdates` and is now routed by `update.type` against the same
  `TRIGGER_TYPES` set already used for lockfile changes
  (dependency/optionalDependency/peerDependency are triggers,
  devDependency is informational only). PeerDependency changes still
  arrive primarily via two existing paths — `compareCatalogs` for
  catalog refs in workspace peerDependencies, and `syncPeers` for
  peer-minor/peer-lock rewrites — both of which already feed the
  trigger lane and are covered by `changesets.test.ts`
  ("catalog change in peerDependency triggers a changeset",
  "writes a changeset for peer-sync rewrites").
- Changeset-config reading (`mode`, `versionPrivate`, `ignorePatterns`,
  `isIgnored`, `fixed`) and publishability detection
  (`SilkPublishabilityDetectorLive`, `PublishabilityDetectorAdaptiveLive`) are
  provided by `@savvy-web/silk-effects` (FileSystem-based), wired via the
  `services/changeset-config.ts` and `services/publishability.ts` re-export
  shims.
- Verified commits via `BranchManager.commitChanges()` (GitHub API,
  `GitCommit.commitFiles`).
- PR creation/update via `Report` service (uses `PullRequest` library service).
- Auto-merge support via `PullRequest` service (GraphQL API).
- Check run lifecycle via `CheckRun.withCheckRun()`.
- PR sentinel fix: failures propagate as `PullRequestError` instead of
  `{ number: 0 }`.
- Dry-run mode for testing.

**Deleted Modules / Dependencies:**

- `src/lib/` (entire directory) — Logic moved to `src/services/` and
  `src/utils/`.
- `src/types/index.ts` — No barrel re-exports; import from
  `src/schemas/domain.ts`.
- `src/lib/errors/types.ts` — Replaced by `src/errors/errors.ts`.
- `src/lib/schemas/index.ts` — Replaced by `src/schemas/domain.ts`.
- `src/lib/schemas/errors.ts` — Replaced by `src/errors/errors.ts`.
- `src/lib/__test__/fixtures.ts` — Replaced by `src/utils/fixtures.test.ts`.
- `workspace-tools` — Replaced by `workspaces-effect`. Domain services
  consume the upstream `WorkspaceDiscovery` Tag directly.
- `src/services/workspaces.ts` and `src/services/workspaces.test.ts`
  (issue #38) — The local `Workspaces` wrapper service became unnecessary
  once `workspaces-effect` exposed
  `WorkspaceDiscovery.listPackages(cwd?)` and
  `WorkspaceDiscovery.importerMap(cwd?)` accepting an optional cwd
  parameter. `RegularDeps`, `PeerSync`, `Lockfile`, and `Changesets` now
  yield `WorkspaceDiscovery` from `workspaces-effect` directly.
- The single-phase token wiring (2.0 migration): the `GitHubApp.withToken()`
  wrapper, `app-id` / `app-private-key` parsing in `program.ts`, the
  `process.env.GITHUB_TOKEN` bridge, and the bare `GitHubClientLive` usage in
  `makeAppLayer`. Token lifecycle now lives in `pre.ts` / `post.ts` via the
  `GitHubToken` namespace; `makeAppLayer` builds `GitHubClient` from
  `GitHubToken.client()`. The `app-id` input was renamed `app-client-id`.
- The empty-changeset fallback path inside `Changesets.create` (a generic
  patch was previously written when nothing else triggered).
- The single-section `DEP_FIELDS = ["devDependencies"]` constant in
  `RegularDeps` — replaced by `DEP_SECTIONS` covering
  `dependencies` / `devDependencies` / `optionalDependencies`, each with
  its accurate `type` field.
- The local silk publishability implementation (`silkDetect`,
  `resolveTargetAccess`, `readRawPackageJson`, the hand-written
  `SilkPublishabilityDetectorLive` / `PublishabilityDetectorAdaptiveLive`)
  and the local `node:fs`-based `ChangesetConfig` (Tag + reader + cache) —
  adopted from `@savvy-web/silk-effects@^0.4.0` (commit `8980e92`).
  `services/publishability.ts` and `services/changeset-config.ts` are now
  thin re-export shims; the library is FileSystem-based, so `makeAppLayer`
  provides `NodeContext.layer` to both. The unit suites
  `src/services/changeset-config.test.ts` and
  `src/services/publishability.test.ts` were deleted (logic now tested in
  silk-effects); `changeset-emission.int.test.ts` was extended with a
  `silk-ignored-versionable` fixture as an upstream-drift canary.

**Next Steps:**

1. Integration testing with real GitHub App in CI.
2. Documentation: user guide and troubleshooting.
3. Support for additional changeset strategies beyond `patch`.

## Rationale

### Why Effect Instead of Plain TypeScript/Promises?

**Type-Safe Error Handling:**

Effect's type system makes errors explicit in function signatures. You can see at a glance what errors
a function might produce, and the compiler ensures you handle them.

**Error Accumulation:**

GitHub Actions should be resilient. If updating 10 dependencies, and 2 fail, we want to:

1. Continue with the other 8
2. Report all failures at the end
3. Still create a PR with successful updates

Effect makes this pattern easy with `Effect.all`, `Effect.either`, and custom error types.

**Resource Management:**

GitHub App tokens and check runs need proper lifecycle management. The token is
provisioned in `pre` and revoked in `post` (which always runs, even when `main`
fails) via the `GitHubToken` namespace, and check runs use Effect's resource
pattern (`acquireUseRelease` under `CheckRun.withCheckRun()`) so cleanup always
happens.

**Testing:**

Effect programs are pure and composable, making them easier to test. Services can be
mocked via `Layer.succeed()` without complex mocking frameworks.

### Why Effect-First Service Architecture?

**Dependency injection:** `Context.Tag` + `Layer` provides compile-time verified
dependency injection. Each service declares its dependencies in its Layer, and
the compiler ensures all dependencies are satisfied.

**Testability:** Mock any service by providing `Layer.succeed(Tag, mockImpl)`.
No need for complex mocking frameworks or module mocking.

**Composition:** `makeAppLayer` in `src/layers/app.ts` wires all layers in one place.
Adding a new service means defining its Tag, implementing its Layer, and adding it
to `makeAppLayer`.

### Why Three-Phase (Pre/Main/Post)?

The 2.0 library is built around the three-phase token lifecycle and steers
single-token actions to the `GitHubToken` namespace. Adopting it:

- **Is idiomatic for 2.0.** `GitHubClientLive` is no longer a bare Layer;
  `GitHubToken.client()` reads the envelope `pre` persisted, removing the
  `process.env.GITHUB_TOKEN` bridge entirely.
- **Revokes the token even when `main` fails.** `post` always runs and disposes
  the token (guarded so it never fails the workflow). Tokens also expire after
  1 hour, so `skip-token-revoke` is offered as an escape hatch.
- **Fails fast on missing scopes.** `pre` passes the required permissions to
  `GitHubToken.provision`, so a misconfigured App fails in `pre` rather than
  mid-run in `main`.

Cross-phase state persistence is handled by `ActionState` (backed by
`GITHUB_STATE`); the only consumer-modelled state is `StartTimeState` for
duration reporting.

### Why Dedicated Branch Instead of Ephemeral Branches?

**Delete-and-Recreate Strategy:**

- Always starts from clean state (no stale changes)
- Simpler than rebase (no conflict resolution)
- Appropriate for automated dependency updates

### Why Changesets Integration?

Changesets is the de facto standard for versioning in pnpm monorepos:

- Automatic changelog generation
- Semantic versioning enforcement
- Release automation compatibility

### Why GitHub App Instead of PAT?

- Tokens expire in 1 hour (vs PAT never expires)
- Fine-grained permissions
- Verified commits via Git Data API (no SSH/GPG keys needed)
- Consistent with GitHub's own bots (Dependabot, etc.)

## Related Documentation

**External References:**

- [pnpm Config Dependencies](https://pnpm.io/config-dependencies)
- [GitHub Apps Authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app)
- [Changesets Documentation](https://github.com/changesets/changesets)
- [Effect Documentation](https://effect.website)
- [GitHub Actions Toolkit](https://github.com/actions/toolkit)
