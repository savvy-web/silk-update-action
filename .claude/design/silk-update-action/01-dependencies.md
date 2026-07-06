# Dependencies

[Back to index](./_index.md)

## Runtime Dependencies (bundled into action)

The authoritative dependency list and ranges live in the `dependencies` block of `package.json` — this doc does not mirror them. Every runtime dependency is inlined into `dist/{pre,main,post}.js` at build time; the packages whose behavior is load-bearing for this action are described below.

## Key Packages

- `@savvy-web/github-action-effects` (v2.3.6) - Effect-based services for GitHub Actions.
  Replaces `@actions/*` with a native ESM implementation. Provides:
  - **Action plumbing:** `ActionOutputs`, `ActionEnvironment`, `ActionLogger`,
    `ActionState`, `Action.run()`, `CheckRun.withCheckRun()`, `AutoMerge.enable()`
  - **Config API:** `Config.*` from Effect for typed input parsing (replaces `Action.parseInputs()`)
  - **Token lifecycle:** `GitHubToken` namespace — `provision()` (pre),
    `client()` (main), `dispose()` (post) — coordinates one installation
    token across the three phases by persisting its envelope to `ActionState`.
  - **Domain services:** `CommandRunner`, `GitBranch`, `GitCommit`, `GitHubClient`,
    `GitHubGraphQL`, `NpmRegistry`, `PullRequest`, `DryRun`, `GithubMarkdown`
  - **Live layers:** `GitHubAppLive` (requires `OctokitAuthAppLive` **and**
    `HttpClient.HttpClient` — satisfied via `FetchHttpClient.layer`),
    `GitBranchLive`, `GitCommitLive`, `CheckRunLive`, `CommandRunnerLive`,
    `DryRunLive`, `GitHubGraphQLLive`, `OctokitAuthAppLive`, `ActionStateLive`
    (requires `FileSystem.FileSystem`).
  - **`GitHubClient` namespace:** `GitHubClient` is a namespace of layer
    constructors (`fromEnv()`, `fromToken(Redacted)`, `fromApp({ clientId,
    privateKey, installationId? })`), not a bare `GitHubClientLive`. This
    action builds its `GitHubClient` from `GitHubToken.client()`, which reads
    the envelope the pre phase persisted to `ActionState`.
  - **Build note (transitive cyclonedx):** the library pulls in
    `@cyclonedx/cyclonedx-library`, whose optional XML/JSON-validator plugins
    (`xmlbuilder2`, `libxmljs2`, `ajv-formats-draft2019`) the action never
    invokes. `action.config.ts` lists them under `build.ignore` (aliased to a
    throwing stub that cyclonedx's `_optPlug` wrapper catches) so the bundle
    builds without them.
- `@effect/platform` / `@effect/platform-node` - Effect platform layer for `Command`
  (shell execution) and FileSystem/Path. `NodeContext.layer` is provided by the
  library's `Action.run()` pipeline at the platform level. `makeAppLayer` also
  pulls `NodeContext.layer` in directly to satisfy `WorkspaceDiscoveryLive` and
  `WorkspaceRootLive` from `workspaces-effect`, which require FileSystem/Path
  to read workspace manifests.
- `effect` - Typed error handling, retry logic, resource management
- `runtime-resolver` - Effect-native resolver for node/deno/bun runtime versions. Consumed by the `RuntimeUpgrade` service (`src/services/runtime-upgrade.ts`). Provides runtime-specific Tags (`NodeResolver`, `DenoResolver`, `BunResolver`) and bundled offline cache layers (`OfflineNodeCacheLive`, `OfflineBunCacheLive`, `OfflineDenoCacheLive`) that require no network or authentication, as well as live layers (`AutoNodeCacheLive`, `AutoBunCacheLive`, `AutoDenoCacheLive`) that fetch current data and fall back to the bundled cache on failure. The bundled cache and live API both exclude end-of-life major lines — resolution for an EOL line returns a `VersionNotFoundError` and is skipped with a warning.
- `semver-effect` (^0.3.1) - Effect-native semver parsing/comparison; used via
  its standalone `parseValidSemVer` in `services/peer-sync.ts` for
  bump-classification under the `peer-minor` strategy, and its standalone
  `parseRange` directly in `program.ts` for validating explicit-range
  `upgrade-runtime-*` and `upgrade-package-manager` input values. The action
  calls the standalone functions rather than the `SemVer.parse` / `Range.parse`
  static aliases: those aliases are attached by post-class assignment and were
  tree-shaken out of the bundled dist (semver-effect shipped `"sideEffects":
  false`), causing `Range.parse is not a function` at runtime. `0.3.1` fixes the
  packaging, but the standalone functions are the bundle-safe, canonical API
  regardless. (Version resolution in `utils/semver.ts` — including the in-range
  resolution for `ConfigDeps`/`RegularDeps` and `configDepUpgradeRange` — uses
  `SemverResolver` from `@savvy-web/github-action-effects`, not `semver-effect`.)
- `workspaces-effect` (^2.0.2) - Effect-native workspace layer (a git-aware
  major: adds `PointInTimeWorkspace` and options-object signatures; the
  `listPackages`/`importerMap`/`detect` surface this action uses is unchanged).
  Consumed directly by domain services (`RegularDeps`, `PeerSync`, `Lockfile`)
  via the upstream `WorkspaceDiscovery` Tag. `Changesets` no longer consumes it
  directly — it delegates to silk's `DepsRegen`, which wires its own workspace
  discovery internally. Provides:
  - `WorkspaceDiscovery` Tag + `WorkspaceDiscoveryLive` Layer with
    `listPackages(cwd?)` and `importerMap(cwd?)` methods accepting an
    optional cwd parameter.
  - `WorkspaceRoot` Tag + `WorkspaceRootLive` Layer for resolving the
    workspace root from a cwd.
  - `getWorkspacePackagesSync(workspaceRoot)` - synchronously enumerate workspace
    packages, including the root workspace package.
  - `WorkspacePackage`, `PublishTarget`, `PublishConfig` value classes.
- `@savvy-web/silk-effects` (^3.0.2) - Shared silk changeset services, FileSystem-based (reads via `@effect/platform` FileSystem rather than `node:fs`). It is the **source of truth** for the dependency-changeset step via its `Changesets.DepsRegen` service. v3 is a major that swaps the embedded changesets engine from the @changesets v2 line to the v3 `next` prereleases (`@changesets/apply-release-plan@8-next`, `get-release-plan@5-next`, `config@4-next` etc. — the engine that writes the `@changesets/config@4` `$schema` into `.changeset/config.json`); the consumed surface below is **unchanged**, so the adapter (`src/services/changesets.ts`) and layer wiring (`src/layers/app.ts`) needed no source changes. The publishability rules and `ChangesetConfig` still live here but are **internal** to `DepsRegen` — the action no longer imports them directly (the former `changeset-config.ts` and `publishability.ts` re-export shims are deleted). Consumed surface:
  - `Changesets.DepsRegen` Tag — plans (`plan({ cwd, base })`) and executes
    (`execute(plan)`) the cumulative `merge-base(base) → worktree` dependency
    diff, consolidating stale pure-dependency changesets into one current table
    per package. Gating (versionable-minus-ignored) lives inside it.
  - `Changesets.DepsRegenDefault` — the batteries-included Layer that bundles
    `PointInTimeWorkspace`, `ConfigInspector`, `WorkspaceDiscovery`, silk's
    adaptive `PublishabilityDetector` and `ChangesetConfig` internally, leaving
    only platform services (FileSystem/Path/CommandExecutor) to satisfy.
  - `Changesets.serializeDependencyTableToMarkdown` — reconstructs a
    `## Dependencies` Markdown table from a diff's rows (used to build the PR
    body / summary without re-reading disk).
  - **Build note (dynamic changelog import):** the v3 engine's `@changesets/apply-release-plan` loads the configured changelog module via a fully dynamic `await import(changelogPath)`. `action.config.ts` lists it under `build.nativeDynamicImports` (a github-action-builder 1.1.0 option) so rspack preserves a genuine dynamic import in the bundle — without it rspack compiles the import into a context module and the action throws `Cannot find module 'file:///…'` at runtime. `workspaces-effect` is listed too, defensively: its config-dependency-hooks loader has the same pattern but is currently tree-shaken out of this bundle. See the comment in `action.config.ts`.
- `yaml` - Parse and stringify `pnpm-workspace.yaml` with consistent formatting

## pnpm Official Packages (for lockfile/workspace analysis)

- `@pnpm/lockfile.fs` - Read/write `pnpm-lock.yaml`
  - `readWantedLockfile(pkgPath, opts)` - Read lockfile, get `LockfileObject`
  - Returns catalogs, packages, importers for diff comparison
- `@pnpm/lockfile.types` - TypeScript types for lockfile structures
  - `LockfileObject`, `CatalogSnapshots`, `ResolvedCatalogEntry`, `ProjectSnapshot`
