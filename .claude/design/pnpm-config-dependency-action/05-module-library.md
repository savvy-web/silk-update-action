# Services and Utilities

[Back to index](./_index.md)

## Domain Services (src/services/)

All domain logic is wrapped as Effect services with `Context.Tag` + `Layer`,
or (for stateless concerns) exported as standalone helper functions. Each
service depends on library services from `@savvy-web/github-action-effects`
and/or `workspaces-effect`.

### Workspace discovery (via workspaces-effect)

Domain services consume the upstream `WorkspaceDiscovery` Tag from
`workspaces-effect` directly, via its `listPackages(cwd?)` and
`importerMap(cwd?)` methods (both accept an optional cwd).

The upstream service interface (relevant slice):

```typescript
import { WorkspaceDiscovery } from "workspaces-effect";

// WorkspaceDiscovery exposes (among others):
//   listPackages: (cwd?: string) =>
//     Effect.Effect<ReadonlyArray<WorkspacePackage>, ...>
//   importerMap: (cwd?: string) =>
//     Effect.Effect<ReadonlyMap<string, WorkspacePackage>, ...>
```

`importerMap` returns a map keyed by importer path relative to the workspace
root (`.` for the root workspace), used by `Lockfile.compare` to translate
importer ids into package names.

`WorkspaceDiscoveryLive` requires `WorkspaceRootLive` and `NodeContext.layer`
(FileSystem/Path). Both are wired in `makeAppLayer`; integration tests build
their own `discoveryLayer` from `NodeContext.layer` directly.

### src/services/changeset-config.ts - ChangesetConfig (re-export shim)

This module is a thin re-export shim over `@savvy-web/silk-effects`. It re-exports the library `ChangesetConfig` Tag and `ChangesetMode`, and exports `ChangesetConfigLive = LibChangesetConfigLive.pipe(Layer.provide(ChangesetConfigReaderLive))` so consumers only need to satisfy a platform `FileSystem` (the library reads `.changeset/config.json` via `@effect/platform` FileSystem, not `node:fs`).

The `ChangesetConfig` service exposes `mode`, `versionPrivate`, `ignorePatterns`, `isIgnored` and `fixed`. `isIgnored(name, root)` backs the ignore gate in `Changesets.create` (see below). See `@savvy-web/silk-effects` for mode-detection and caching semantics.

### src/services/publishability.ts - PublishabilityDetector overrides (re-export shim)

This module is a thin re-export shim: `export { PublishabilityDetectorAdaptiveLive, SilkPublishabilityDetectorLive } from "@savvy-web/silk-effects"`. The silk rules and the adaptive dispatcher live in the shared library. Both layers override `workspaces-effect`'s `PublishabilityDetector` Tag and are FileSystem-based: `PublishabilityDetectorAdaptiveLive` requires `FileSystem | ChangesetConfig` and dispatches per-call on `ChangesetConfig.mode` (silk / vanilla / none). `makeAppLayer` wires the adaptive variant. See `@savvy-web/silk-effects` for the silk rule details.

The versionable cascade (publishable OR `versionPrivate`) plus the ignore gate live inline in `Changesets.create` — they are silk-changesets-specific and short enough not to need their own service.

### src/services/branch.ts - BranchManager

Branch management and commit operations using `GitBranch`, `GitCommit`, and
`CommandRunner` library services.

**Service interface:**

```typescript
export class BranchManager extends Context.Tag("BranchManager")<BranchManager, {
 readonly manage: (branchName: string, defaultBranch?: string) =>
  Effect.Effect<BranchResult, GitBranchError | CommandRunnerError>;
 readonly commitChanges: (message: string, branchName: string) =>
  Effect.Effect<void, GitCommitError | CommandRunnerError>;
}>() {}
```

**Branch Strategy:** Delete-and-recreate instead of rebase. When the branch
already exists, it is deleted and recreated from the default branch for a
fresh start.

**Commit via GitHub API:** `commitChanges` reads changed files from
`git status --porcelain` (handling `D`-marked deletions as `{ path, sha: null }`)
and calls `GitCommit.commitFiles(branch, message, fileChanges)` — the library's
single-call wrapper that creates the tree, the commit (without an explicit
author so GitHub verifies it), and updates the branch ref. After committing,
the working tree is synced via `git fetch origin <branch>` + `git reset --hard
origin/<branch>` because `git checkout` would refuse to overwrite the
just-committed working-copy state.

### src/services/workspace-yaml.ts - WorkspaceYaml

Format `pnpm-workspace.yaml` consistently to avoid lint-staged hook changes.

**Formatting Rules:**

1. Sort arrays alphabetically: `packages`, `onlyBuiltDependencies`, `publicHoistPattern`
2. Sort `configDependencies` object keys alphabetically
3. Sort top-level keys alphabetically, but keep `packages` first
4. YAML stringify: `indent: 2`, `lineWidth: 0`, `singleQuote: false`

**Exported helpers** (used directly by `program.ts` and `ConfigDeps`):

- `formatWorkspaceYaml(workspaceRoot?)` - Read, sort, and write back
- `readWorkspaceYaml(workspaceRoot?)` - Read and parse workspace YAML
- `sortContent(content)` - Sort workspace content
- `STRINGIFY_OPTIONS` - Consistent YAML stringify options

### src/services/pnpm-upgrade.ts - PnpmUpgrade

Upgrade pnpm to the latest version within `^` semver range via `corepack use`.
Depends on `CommandRunner`.

**Service interface:**

```typescript
export class PnpmUpgrade extends Context.Tag("PnpmUpgrade")<PnpmUpgrade, {
 readonly upgrade: (workspaceRoot?: string) =>
  Effect.Effect<PnpmUpgradeResult | null, FileSystemError>;
}>() {}
```

**Algorithm:**

1. Read root `package.json`
2. Parse `packageManager` field (format: `pnpm@10.28.2`, `pnpm@^10.28.2+sha512...`)
3. Parse `devEngines.packageManager` field (name must be `pnpm`)
4. Query pnpm versions via `npm view pnpm versions --json`
5. Resolve latest in `^` range, run `corepack use pnpm@<version>`
6. Update `devEngines.packageManager.version` if present

### src/services/config-deps.ts - ConfigDeps

Update config dependencies by querying npm via `NpmRegistry` and editing
`pnpm-workspace.yaml` in place. Avoids `pnpm add --config` catalog promotion.

**Service interface:**

```typescript
export class ConfigDeps extends Context.Tag("ConfigDeps")<ConfigDeps, {
 readonly updateConfigDeps: (deps: ReadonlyArray<string>, workspaceRoot?: string) =>
  Effect.Effect<ReadonlyArray<DependencyUpdateResult>>;
}>() {}
```

**Algorithm:**

1. Read `pnpm-workspace.yaml` via `readWorkspaceYaml()`
2. For each dep, query `NpmRegistry` for latest version + integrity
3. Compare current with latest; skip if up-to-date
4. Write back via `sortContent()` + `stringify()`

### src/services/regular-deps.ts - RegularDeps

Update regular dependencies by querying npm via `NpmRegistry`. Avoids
`pnpm up --latest` which promotes deps to catalogs with `catalogMode: strict`.

**Service interface:**

```typescript
export class RegularDeps extends Context.Tag("RegularDeps")<RegularDeps, {
 readonly updateRegularDeps: (patterns: ReadonlyArray<string>, workspaceRoot?: string) =>
  Effect.Effect<ReadonlyArray<DependencyUpdateResult>>;
}>() {}
```

**Key Design Decisions:**

- Queries npm registry directly via `NpmRegistry` service.
- Enumerates workspace `package.json` files via `WorkspaceDiscovery` from
  `workspaces-effect`.
- Uses `matchesPattern` from `src/utils/deps.ts` for glob matching.
- Preserves specifier prefix (`^`, `~`, or exact) from `package.json`.
- Skips `catalog:` and `workspace:` specifiers.
- Iterates `dependencies`, `devDependencies`, and `optionalDependencies`
  via `DEP_SECTIONS` (a typed array of `{ field, type }` records).
  `peerDependencies` are intentionally excluded — peer ranges are managed
  by `syncPeers`, not by direct version bumps. Catalog-resolved deps in
  any section still flow through `compareCatalogs` independently.
- Each match carries its `field` and `type` through the pipeline. Dedup
  is per `(path, field)`, so a dep declared in both `dependencies` and
  `devDependencies` of one package emits two records, each with the
  accurate `type`.
- `updatePackageJson` accepts `Map<DepSectionField, Map<string, string>>`
  so each section is updated independently without cross-pollination.
- `DependencyUpdateResult.type` reflects the actual section (`dependency`
  / `devDependency` / `optionalDependency`).
- Gracefully handles npm query failures per-dependency.

### src/services/peer-sync.ts - PeerSync

Sync peerDependency ranges after devDependency updates based on `peer-lock`
and `peer-minor` input configuration. Uses `semver-effect` for version
parsing. **Has no `Context.Tag` of its own** — exported as standalone
functions and consumed directly from `program.ts`. Yields `WorkspaceDiscovery`
from `workspaces-effect` to resolve package paths.

**Exported functions:**

- `computePeerRange(params)` — Compute new peer range based on strategy
  (returns `Effect<string | null, never>`).
- `syncPeers(config, devUpdates, workspaceRoot?)` — Sync all peer ranges;
  signature is
  `Effect<readonly DependencyUpdateResult[], FileSystemError, WorkspaceDiscovery>`.

**Types:**

- `PeerStrategy` — `"lock" | "minor"`.
- `PeerSyncConfig` — `{ lock: ReadonlyArray<string>; minor: ReadonlyArray<string> }`.

**Strategies:**

- `lock`: Sync peer range on every version bump (patch and minor).
- `minor`: Sync peer range only on minor+ bumps, floor patch to `.0`.

**Algorithm:**

1. Build strategy lookup map from config.
2. Yield `WorkspaceDiscovery` and call `listPackages(workspaceRoot)` to
   resolve package paths.
3. For each devDep update matching a strategy:
   - Read the package.json.
   - Find the peerDependencies entry.
   - Compute new range using `computePeerRange`.
   - Write updated package.json.

### src/services/lockfile.ts - Lockfile

Compare lockfile snapshots before and after updates to detect changes.
Uses `@pnpm/lockfile.fs` and yields `WorkspaceDiscovery` from
`workspaces-effect`.

**Service interface:**

```typescript
export class Lockfile extends Context.Tag("Lockfile")<Lockfile, {
 readonly capture: (workspaceRoot?: string) =>
  Effect.Effect<LockfileObject | null, LockfileError>;
 readonly compare: (before, after, workspaceRoot?) =>
  Effect.Effect<ReadonlyArray<LockfileChange>, LockfileError, WorkspaceDiscovery>;
}>() {}
```

**Key behavior — `compareCatalogs`:** for each catalog change, the comparator
walks every importer that consumes the catalog entry and emits **one
`LockfileChange` record per (catalog change, consuming importer, dep
section) triple**. Each record carries the precise `type` field
(`dependency` / `devDependency` / `optionalDependency` / `peerDependency`),
so downstream `Changesets` gating can use `type` alone as the trigger
signal. Catalog refs in `devDependencies` are returned with `type:
"devDependency"` and treated by `Changesets` as informational only.

`compareImporters` handles non-catalog specifier changes (including
removals), reading dep section from the `after` snapshot to type each entry.

**Exported helpers** (used by `program.ts` and `Changesets`):

- `captureLockfileState(workspaceRoot?)` - Standalone capture function
- `compareLockfiles(before, after, workspaceRoot?)` - Standalone compare
  function (signature requires `WorkspaceDiscovery` in its environment)
- `groupChangesByPackage(changes)` - Group lockfile changes by affected package

### src/services/changesets.ts - Changesets

Create changeset files for affected packages after dependency updates.
Depends on `WorkspaceDiscovery` (from `workspaces-effect`),
`PublishabilityDetector` (from `workspaces-effect`), and `ChangesetConfig`.

**Service interface:**

```typescript
export class Changesets extends Context.Tag("Changesets")<Changesets, {
 readonly create: (
  workspaceRoot: string,
  lockfileChanges: ReadonlyArray<LockfileChange>,
  regularUpdates?: ReadonlyArray<DependencyUpdateResult>,
  peerUpdates?: ReadonlyArray<DependencyUpdateResult>,
 ) => Effect.Effect<ReadonlyArray<ChangesetFile>, ChangesetError | FileSystemError>;
}>() {}
```

`workspaceRoot` is the **first** parameter. `regularUpdates` carries the
dependency/devDependency/optionalDependency updates from the multi-section
RegularDeps scan.

**Gating rules:**

- Skips entirely if no `.changeset/` directory exists at `workspaceRoot`.
- For each workspace package, builds per-package `triggerRows` and `devRows`:
  - `dependency`, `optionalDependency`, and `peerDependency` lockfile
    changes are **triggers**; `devDependency` lockfile changes are
    informational only.
  - Peer-sync `peerUpdates` are always triggers (with `type:
    "peerDependency"`).
  - `regularUpdates` are routed by `update.type` against the same
    `TRIGGER_TYPES` set used for lockfile changes:
    `dependency`/`optionalDependency`/`peerDependency` go to
    `triggerRows`; `devDependency` goes to `devRows`. `updateToRow`
    honors `from === null` for the "added" action and uses `update.type`
    directly when no override is provided.
- A changeset is emitted for a package only when it has at least one
  trigger row, the package is **not changeset-ignored**, AND the package is
  **versionable**:
  - **Ignore gate:** `ChangesetConfig.isIgnored(pkg.name, workspaceRoot)` is
    checked first (before the publishability check). A package listed in
    `.changeset/config.json`'s `ignore` array is skipped entirely — the
    ignore list wins even when `privatePackages.version: true`, so an ignored
    package is never versioned.
  - `versionable = publishable || versionPrivate`, where:
    - `publishable` = `PublishabilityDetector.detect(...)` returns at least
      one target (silk rules, vanilla rules, or none-mode noop, depending on
      `ChangesetConfig.mode`).
    - `versionPrivate` = `ChangesetConfig.versionPrivate(workspaceRoot)`
      (i.e. `.changeset/config.json` has `privatePackages.version: true`).
- Empty changesets are not written.
- Each emitted changeset's body is a single Markdown table covering both
  trigger and informational rows, deduplicated by `(dependency, type)`.

**Exported helper:**

- `hasChangesets(workspaceRoot?)` — checks for the existence of
  `.changeset/` (used for early skip / no-op messaging).

### src/services/runtime-upgrade.ts - RuntimeUpgrade

Upgrade `devEngines.runtime` entries (node/deno/bun) in the root `package.json`
via `runtime-resolver`. Depends on `NodeResolver`, `DenoResolver`, and
`BunResolver` Tags from `runtime-resolver`. Mirrors `PnpmUpgrade`; resolver
failures are caught and skipped per-runtime, never fatal.

**Service interface:**

```typescript
export class RuntimeUpgrade extends Context.Tag("RuntimeUpgrade")<
 RuntimeUpgrade,
 {
  readonly upgrade: (
   config: RuntimeUpgradeConfig,
   workspaceRoot?: string,
  ) => Effect.Effect<readonly RuntimeUpgradeResult[], FileSystemError>;
 }
>() {}
```

**Types:**

- `RuntimeName` — `"node" | "deno" | "bun"`.
- `RuntimeUpgradeConfig` — `{ node: string; deno: string; bun: string }` where each field
  is `"false"`, `"auto"`, or an explicit semver range string.
- `RuntimeUpgradeResult` — `{ runtime: RuntimeName; from: string | null; to: string; added: boolean }`.

**Resolution algorithm (per runtime):**

1. If the mode is `"false"`, return `null` (skip).
2. Look up the existing `devEngines.runtime` entry via `findRuntimeEntry`.
3. **`auto` mode:** if no entry exists or it is a static pin (`isStaticVersion`), skip with a
   warning. Otherwise use the existing version string as the target range and its leading
   operator (`parseRuntimeOperator`) as the output operator.
4. **Explicit range mode:** use the user-typed value as the target range. The output operator
   follows the **existing** entry (`parseRuntimeOperator(entry.version)`) so its pattern is
   preserved — an exact pin stays exact, a caret stays caret — even when the input range used a
   different operator. Only when **adding** a brand-new entry (no existing entry) does the output
   operator fall back to the one the user typed in the range.
5. Call `resolver.resolve({ semverRange: targetRange })` and get `latest`. On any error
   (`VersionNotFoundError` or network failure), log a warning and skip.
6. Re-decorate: `operator + latest` via `redecorateVersion`. If `newVersion === from`, skip (already
   current).
7. Call `upsertRuntimeEntry(pkgJson, runtime, newVersion)` to write the new version into the
   package JSON object in memory. Track whether an entry was added vs modified.
8. After processing all runtimes, write back `package.json` (preserving indentation via
   `detectIndent`) only if at least one update succeeded.

**Shape handling (via `upsertRuntimeEntry`):**

- Existing array entry: version is updated in place, all other fields preserved.
- Existing single-object entry: version is updated in place, shape stays as object.
- New entry into existing array: new object appended, mirroring a sibling's `onFail` (or `"ignore"`
  if none).
- New entry when `runtime` field is absent: created as a single-element array.
- New entry when `runtime` field is a single object: promoted to a two-element array.

**EOL note:** `runtime-resolver`'s bundled cache and live API both exclude end-of-life major lines.
A resolution targeting an EOL line returns `VersionNotFoundError` and is skipped with a warning.
This means `auto` on a `^20`-ranged entry (once Node 20 is EOL) will no-op.

### src/services/report.ts - Report

PR management and report generation. Depends on `PullRequest` library
service. Uses `GithubMarkdown` from the library to assemble PR bodies and
summaries.

**Service interface:**

```typescript
export class Report extends Context.Tag("Report")<Report, {
 readonly createOrUpdatePR: (branch, updates, changesets, autoMerge?) =>
  Effect.Effect<PullRequestResult, PullRequestError>;
 readonly generatePRBody: (updates, changesets) => string;
 readonly generateSummary: (updates, changesets, pr, dryRun) => string;
 readonly generateCommitMessage: (updates, appSlug?) => string;
}>() {}
```

PR creation failures propagate through the Effect error channel as
`PullRequestError` rather than returning a sentinel result.

## Layer Composition (src/layers/app.ts)

`makeAppLayer(dryRun, { runtimeLive })` wires all library and domain layers.
`dryRun` controls the `DryRun` service; `runtimeLive` (default: `false`) selects
how the `NodeResolver`, `DenoResolver` and `BunResolver` Tags consumed by
`RuntimeUpgradeLive` are built (see `makeRuntimeResolvers` in `src/layers/app.ts`):
the offline path provides resolvers over the bundled `Offline*CacheLive` (no
network or auth), the live path provides them over `Auto*CacheLive` backed by
version fetchers and a `GitHubClientLive` (auth from `GitHubAutoAuth`) that fall
back to the bundled cache on any fetch failure. The `GitHubClient` layer used by
the rest of the action is built from `GitHubToken.client()`, which reads the
installation-token envelope the pre phase persisted to `ActionState` — there is
no bare `GitHubClientLive` and no `process.env.GITHUB_TOKEN` bridge. `ActionState`
is provided locally (backed by `NodeContext.layer`'s FileSystem) so the layer is
self-contained, and `Layer.orDie` turns a missing/unreadable token into a fatal
defect, keeping the resulting `githubClient` at `R = never` for the `withCheckRun`
callback.

```typescript
export const makeAppLayer = (
 dryRun: boolean,
 options: { runtimeLive: boolean } = { runtimeLive: false },
) => {
 const actionState = ActionStateLive.pipe(Layer.provide(NodeContext.layer));
 const githubClient = GitHubToken.client().pipe(Layer.provide(actionState), Layer.orDie);

 const ghGraphql = GitHubGraphQLLive.pipe(Layer.provide(githubClient));
 const npmRegistry = NpmRegistryLive.pipe(Layer.provide(CommandRunnerLive));
 const gitBranch = GitBranchLive.pipe(Layer.provide(githubClient));
 const gitCommit = GitCommitLive.pipe(Layer.provide(githubClient));
 const prLayer = PullRequestLive.pipe(Layer.provide(Layer.merge(githubClient, ghGraphql)));

 // Platform layer (FileSystem, Path) for workspaces-effect's WorkspaceDiscovery.
 const platform = NodeContext.layer;
 const workspaceRoot = WorkspaceRootLive.pipe(Layer.provide(platform));
 const workspaceDiscovery = WorkspaceDiscoveryLive.pipe(
  Layer.provide(Layer.merge(workspaceRoot, platform)),
 );

 // ChangesetConfigLive (silk-effects, FileSystem-backed via its reader) and
 // PublishabilityDetectorAdaptiveLive both require a platform FileSystem;
 // provide the existing `platform` (NodeContext.layer) to both.
 const changesetConfig = ChangesetConfigLive.pipe(Layer.provide(platform));
 // PublishabilityDetectorAdaptiveLive overrides PublishabilityDetector and
 // reads ChangesetConfig.mode per-call to dispatch to silk/vanilla/noop.
 const publishabilityDetector = PublishabilityDetectorAdaptiveLive.pipe(
  Layer.provide(Layer.merge(changesetConfig, platform)),
 );

 const libraryLayers = Layer.mergeAll(
  githubClient, gitBranch, gitCommit,
  CheckRunLive.pipe(Layer.provide(githubClient)),
  prLayer, npmRegistry, CommandRunnerLive, DryRunLive(dryRun),
 );

 // NodeResolver/DenoResolver/BunResolver, built offline (bundled cache) or
 // live (Auto*CacheLive over fetchers + GitHubClientLive). See
 // makeRuntimeResolvers for the live wiring.
 const runtimeResolvers = makeRuntimeResolvers(options.runtimeLive);

 const domainLayers = Layer.mergeAll(
  workspaceDiscovery,
  changesetConfig,
  publishabilityDetector,
  ChangesetsLive.pipe(Layer.provide(Layer.mergeAll(workspaceDiscovery, publishabilityDetector, changesetConfig))),
  BranchManagerLive.pipe(Layer.provide(Layer.mergeAll(gitBranch, gitCommit, CommandRunnerLive))),
  PnpmUpgradeLive.pipe(Layer.provide(CommandRunnerLive)),
  ConfigDepsLive.pipe(Layer.provide(npmRegistry)),
  RegularDepsLive.pipe(Layer.provide(Layer.merge(npmRegistry, workspaceDiscovery))),
  ReportLive.pipe(Layer.provide(prLayer)),
  RuntimeUpgradeLive.pipe(Layer.provide(runtimeResolvers)),
 );

 return Layer.provideMerge(domainLayers, libraryLayers);
};
```

`WorkspaceDiscoveryLive` and `WorkspaceRootLive` come from
`workspaces-effect`; `NodeContext.layer` (from `@effect/platform-node`)
satisfies their FileSystem/Path requirements.

`ChangesetConfigLive` and `PublishabilityDetectorAdaptiveLive` (both re-exported from `@savvy-web/silk-effects`) are FileSystem-based — they read `.changeset/config.json` and package manifests via `@effect/platform` FileSystem rather than `node:fs`, so the same `platform` (`NodeContext.layer`) is provided to both. `ChangesetConfigLive` carries its own `ChangesetConfigReaderLive` (composed in the shim), leaving only the FileSystem requirement for `makeAppLayer` to satisfy.

## Pure Helpers (src/utils/)

### src/utils/deps.ts

- `parseConfigEntry(entry)` - Parse config dependency entry (version + optional hash)
- `matchesPattern(depName, pattern)` - Glob matching via `path.matchesGlob`
- `parseSpecifier(specifier)` - Parse version specifier; returns `null` for `catalog:`/`workspace:`

### src/utils/input.ts

- `parseMultiValueInput(raw)` — Normalize a multi-value GitHub Action input
  string. Accepts JSON arrays, newline-separated lists (with optional `*`
  bullets and `#` comments), or comma-separated values.

### src/utils/markdown.ts

- `npmUrl(packageName)` - Generate npmjs.com URL for a package
- `cleanVersion(version)` - Strip prefix characters from version string

### src/utils/pnpm.ts

- `parsePnpmVersion(raw, stripPnpmPrefix?)` - Parse version from `packageManager` or `devEngines`
- `formatPnpmVersion(version, hasCaret)` - Format version with optional caret
- `detectIndent(content)` - Detect JSON file indentation (reused by `RegularDeps` and `PeerSync`)

### src/utils/runtime.ts

Pure helpers for reading and rewriting `devEngines.runtime` entries. No Effect
service dependencies — mirrors `src/utils/pnpm.ts`.

- `parseRuntimeOperator(raw)` — Extract the leading range operator (`^`, `~`, `>=`, etc.)
  from a version string; returns `""` for a bare version with no operator.
- `isStaticVersion(raw)` — True when `raw` is a static exact version (`X.Y.Z`, optionally with
  prerelease/build) and carries no range operator, wildcard (`x`/`*`), OR-set (`||`), or partial
  form. Used to make `auto` a no-op on pinned versions.
- `redecorateVersion(resolved, operator)` — Re-attach an operator to a resolved exact version
  (e.g. `"^" + "24.16.0"` → `"^24.16.0"`).
- `findRuntimeEntry(devEngines, runtime)` — Find the `devEngines.runtime` entry for `runtime`
  (accepts object or array shape), or `null` if absent.
- `upsertRuntimeEntry(pkgJson, runtime, version)` — Set the version for `runtime` inside
  `pkgJson.devEngines.runtime`, mutating `pkgJson` in place. Handles all shape variants (existing
  array entry, existing single-object entry, new entry into array, promote single-object to array,
  create array when absent). Returns `{ added: boolean }`.

### src/utils/semver.ts

- `resolveLatestInRange(versions, current)` - Find highest stable version satisfying `^current`
