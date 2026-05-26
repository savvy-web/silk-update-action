# Dependencies

[Back to index](./_index.md)

## Runtime Dependencies (bundled into action)

```json
{
 "dependencies": {
  "@effect/platform": "catalog:silk",
  "@effect/platform-node": "catalog:silk",
  "@pnpm/lockfile.fs": "^1100.0.3",
  "@pnpm/lockfile.types": "^1100.0.2",
  "@savvy-web/github-action-effects": "^2.0.0",
  "@savvy-web/silk-effects": "^0.4.1",
  "effect": "catalog:silk",
  "runtime-resolver": "^0.3.10",
  "semver-effect": "^0.2.1",
  "workspaces-effect": "^1.1.0",
  "yaml": "^2.9.0"
 }
}
```

## Key Packages

- `@savvy-web/github-action-effects` (v2.0.0) - Effect-based services for GitHub Actions.
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
- `runtime-resolver` (^0.3.10) - Effect-native resolver for node/deno/bun
  runtime versions. Consumed by the `RuntimeUpgrade` service
  (`src/services/runtime-upgrade.ts`). Provides runtime-specific Tags
  (`NodeResolver`, `DenoResolver`, `BunResolver`) and bundled offline cache
  layers (`OfflineNodeCacheLive`, `OfflineBunCacheLive`, `OfflineDenoCacheLive`)
  that require no network or authentication, as well as live layers
  (`AutoNodeCacheLive`, `AutoBunCacheLive`, `AutoDenoCacheLive`) that fetch
  current data and fall back to the bundled cache on failure. The bundled cache
  and live API both exclude end-of-life major lines — resolution for an EOL line
  returns a `VersionNotFoundError` and is skipped with a warning.
- `semver-effect` (^0.2.1) - Effect-native semver parsing/comparison; used by
  `services/peer-sync.ts` (`SemVer.parse`) for bump-classification under the
  `peer-minor` strategy, and directly in `program.ts` (`Range.parse`) for
  validating the `upgrade-runtime-*` input values.
- `workspaces-effect` (^1.1.0) - Effect-native workspace + publishability layer.
  Consumed directly by domain services (`RegularDeps`, `PeerSync`, `Lockfile`,
  `Changesets`) via the upstream `WorkspaceDiscovery` Tag. Provides:
  - `WorkspaceDiscovery` Tag + `WorkspaceDiscoveryLive` Layer with
    `listPackages(cwd?)` and `importerMap(cwd?)` methods accepting an
    optional cwd parameter.
  - `WorkspaceRoot` Tag + `WorkspaceRootLive` Layer for resolving the
    workspace root from a cwd.
  - `getWorkspacePackagesSync(workspaceRoot)` - synchronously enumerate workspace
    packages, including the root workspace package.
  - `WorkspacePackage`, `PublishTarget`, `PublishConfig` value classes.
  - `PublishabilityDetector` Tag + `PublishabilityDetectorLive` (vanilla rules).
    The action overrides this Tag with the silk/adaptive detector from
    `@savvy-web/silk-effects` (see below); `services/publishability.ts` is a
    thin re-export shim over that library.
- `@savvy-web/silk-effects` (^0.4.1) - Shared silk publishability and changeset
  configuration services, FileSystem-based (reads via `@effect/platform`
  FileSystem rather than `node:fs`). Hosts the silk publishability rules and
  the `ChangesetConfig` service; `services/publishability.ts` and
  `services/changeset-config.ts` are thin re-export shims over it. Provides:
  - `SilkPublishabilityDetectorLive` + `PublishabilityDetectorAdaptiveLive` —
    `PublishabilityDetector` Tag overrides (silk rules / per-call dispatch by
    `ChangesetConfig.mode`). The adaptive variant requires `FileSystem |
    ChangesetConfig`.
  - `ChangesetConfig` Tag + `ChangesetMode` + `ChangesetConfigLive` (requires
    `ChangesetConfigReader` → FileSystem) + `ChangesetConfigReaderLive`. The
    `ChangesetConfig` service exposes `mode`, `versionPrivate`,
    `ignorePatterns`, `isIgnored` and `fixed`.
- `yaml` - Parse and stringify `pnpm-workspace.yaml` with consistent formatting

## pnpm Official Packages (for lockfile/workspace analysis)

- `@pnpm/lockfile.fs` - Read/write `pnpm-lock.yaml`
  - `readWantedLockfile(pkgPath, opts)` - Read lockfile, get `LockfileObject`
  - Returns catalogs, packages, importers for diff comparison
- `@pnpm/lockfile.types` - TypeScript types for lockfile structures
  - `LockfileObject`, `CatalogSnapshots`, `ResolvedCatalogEntry`, `ProjectSnapshot`
