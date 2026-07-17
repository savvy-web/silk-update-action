# Project Status

[Back to index](./_index.md)

## Current State

The action is Effect-first and runs as three phases (`pre` / `main` / `post`)
around the `GitHubToken` token lifecycle. It runs on **Effect v4**
(`effect@4.0.0-beta.98`) and the `@effected/*` first-party kit
(`@effected/workspaces`, `@effected/runtimes`, `@effected/semver`,
`@effected/lockfiles`, `@effected/yaml`) — a runtime/toolchain migration that
left `action.yml` inputs/outputs unchanged. All domain logic is wrapped as Effect
services with `Context.Service` (v4; was `Context.Tag`) + `Layer`, plus a few
standalone helper modules (`PeerSync`, `WorkspaceYaml`). Layer composition is
centralized in `src/layers/app.ts`. Workspace enumeration comes from
`@effected/workspaces`, and the dependency-changeset step delegates to
`@savvy-web/silk-effects`' `Changesets.DepsRegen` (which owns publishability
detection and changeset-config reading internally).

**Architecture:**

- **Three-phase entry:** `src/pre.ts` provisions the GitHub App installation
  token (`GitHubToken.provision`, fail-fast scope check) and records a start
  time; `src/main.ts` is a thin wrapper calling `Action.run(program)` (no
  `{ layer }`); `src/post.ts` reports total duration and revokes the token
  (`GitHubToken.dispose`). The testable `program`
  Effect lives in `src/program.ts` along with `runCommands` and `runInstall`
  helpers. Cross-phase state schemas live in `src/state.ts` (`StartTimeState`,
  `STATE_KEYS`).
- **Effect-first services:** Domain services in `src/services/` —
  `BranchManager`, `PnpmUpgrade`, `RuntimeUpgrade`, `ConfigDeps`, `RegularDeps`,
  `Report`, `Lockfile`, `Changesets`. `Changesets` is a thin adapter over
  `@savvy-web/silk-effects`' `Changesets.DepsRegen`; the former
  `services/changeset-config.ts` and `services/publishability.ts` re-export
  shims are deleted, since `ChangesetConfig` and the `PublishabilityDetector`
  overrides are now internal to DepsRegen. Stateless helpers (`PeerSync`,
  `WorkspaceYaml`) export functions without their own service tag. Workspace
  enumeration goes through `WorkspaceDiscovery` from `@effected/workspaces`
  directly (for `RegularDeps`, `PeerSync` and `Lockfile`).
- **Layer composition:** `makeAppLayer(dryRun, { runtimeLive })` in
  `src/layers/app.ts` wires all library and domain layers together. The
  `GitHubClient` is built from `GitHubToken.client()` (over a self-contained
  `ActionStateLive`, `Layer.orDie`), which reads the token envelope `pre`
  persisted to `ActionState` — there is no bare `GitHubClientLive` and no
  `process.env.GITHUB_TOKEN` bridge. `runtimeLive` selects the bundled offline
  vs live `@effected/runtimes` resolver layers consumed by `RuntimeUpgradeLive`.
- **Pure helpers:** `src/utils/` contains stateless functions (`deps.ts`,
  `input.ts`, `markdown.ts`, `pnpm.ts`, `runtime.ts`, `semver.ts`).
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
  `dispose()` (post, never fails the workflow).
  The envelope is persisted to `ActionState` (backed by `GITHUB_STATE`) — no
  `process.env.GITHUB_TOKEN` bridge.
- Branch management with delete-and-recreate strategy via `BranchManager`
  service. The source ref and PR target are configurable via the
  `source-branch` (default `main`) and `target-branch` (default `""` → follow
  source) inputs, with `validateBranches` failing fast on a missing ref before
  the destructive reset.
- Config dependency updates via `ConfigDeps` service (uses `NpmRegistry`).
  Config deps carry no declared range, so it synthesizes a conservative one from
  the current version's major via `configDepUpgradeRange` and resolves the
  highest in-range version with `resolveLatestSatisfying` rather than jumping to
  npm's absolute latest (`>=1.0.0` stays within the major; `<1.0.0` may adopt the
  first stable major but never crosses two majors at once).
- Regular dependency updates via `RegularDeps` service (uses `NpmRegistry`
  and `WorkspaceDiscovery` from `@effected/workspaces`). Resolves the highest
  published version **satisfying the current specifier treated as a range** via
  `resolveLatestSatisfying` rather than npm's absolute `latest` dist-tag, so
  `^4.0.0` stays within major 4, `>=4.0.0` may advance across a major, and an
  exact pin never bumps. Caret-on-zero (`^0.y.z`) is the one exception — it
  resolves within the config-dep range (`>=version <2.0.0`) so a pre-stable dep
  rolls forward across `0.x` and into the first stable `1.x` instead of being
  locked to `0.y.x`. Iterates `dependencies`, `devDependencies`, and
  `optionalDependencies` independently and reports the real section type per
  update — `peerDependencies` are managed by `syncPeers`.
- Peer dependency range syncing via `syncPeers` (`peer-lock` and
  `peer-minor` strategies, powered by `@effected/semver`).
- pnpm self-upgrade via `PnpmUpgrade` service, driven by the `upgrade-package-manager`
  input (`false` | `true` | `auto` | a semver range, default `"true"`). The
  input is named generically for consistency with `upgrade-runtime-*` and to
  leave room for upgrading other package managers later — it currently upgrades
  pnpm only (the `PnpmUpgrade` service is the only implementation).
  `true`/`auto` resolve the latest within the current major (favoring the
  `devEngines.packageManager` reference over the `packageManager` field); an
  explicit range may cross majors and adds a `packageManager` field when none
  exists. The service edits `package.json` directly — writing both
  `packageManager` and `devEngines.packageManager.version` as a hash-pinned
  `version+sha512.<hex>` string derived from the npm registry integrity — rather
  than running `corepack use` (which errors when both fields are present); the
  subsequent `runInstall` performs the corepack switch.
- `devEngines.runtime` upgrades via `RuntimeUpgrade` service (node/deno/bun),
  driven by the `upgrade-runtime-node/deno/bun` inputs (`false` | `auto` | a
  semver range) and `runtime-data` (`offline` bundled cache vs `live`). Resolves
  versions via `@effected/runtimes` within currently-maintained (non-EOL) majors;
  `auto` no-ops on a static pin or already-current value. **Upgrade only, never
  add:** a runtime with no existing `devEngines.runtime` entry is skipped with a
  warning in every mode. **Always exact:** the range only selects which line to
  resolve; the bare resolved version is written with no operator (an existing
  `^24.0.0` becomes e.g. `24.9.1`), because `silk-runtime-action` downstream does
  not support ranges. Runtime
  bumps fold into `allUpdates` for reporting/commit/PR only — they never produce
  a changeset (DepsRegen scopes changesets to dependency diffs) and never trigger
  `runInstall` (unlike the pnpm bump, which does trigger `runInstall` to perform
  the corepack switch).
- Lockfile regeneration via `runInstall`: `pnpm clean --lockfile` then
  `pnpm install --frozen-lockfile=false`. The action changes the pnpm version,
  config and dependency ranges, so the lockfile is regenerated from a clean
  slate rather than repaired in place with `--fix-lockfile` (which would not
  re-run resolution under the new inputs and could commit a stale graph).
  Advancing transitives is expected, not noise. `pnpm clean --lockfile`
  requires pnpm 11+.
- Workspace YAML formatting via `WorkspaceYaml` helpers.
- Custom command execution via `runCommands` (`sh -c`) with error collection.
- Lockfile comparison via `Lockfile` service. Catalog comparison emits one
  `LockfileChange` per (catalog change, consuming importer, dep section)
  triple, carrying the precise `type` field. These records drive change
  detection / reporting; they no longer feed the changeset step.
- Changeset creation via the `Changesets` service, a thin adapter over
  `@savvy-web/silk-effects`' `Changesets.DepsRegen`. `create(cwd, base)` calls
  `depsRegen.plan({ cwd, base }) → execute(plan)` and maps the written files
  back to `ChangesetFile[]` for reporting. Content comes from DepsRegen's
  cumulative `merge-base(base) → worktree` git diff (`base` = resolved
  `target-branch`, the release baseline): it writes one consolidated dependency
  changeset per in-scope package, deletes stale pure-dependency changesets
  (idempotent across re-fires), drops devDependency rows and leaves mixed
  changesets (Dependencies table + prose) untouched. Requires a `fetch-depth: 0`
  checkout; `program.ts` runs `BranchManager.ensureBaseHistory(base)` first as a
  shallow-checkout safety net.
- All changeset gating (versionable-minus-ignored: publishable OR
  `privatePackages.version`, minus the changeset `ignore` list) plus
  publishability detection and changeset-config reading now live **upstream in
  DepsRegen** (`@savvy-web/silk-effects`, FileSystem-based). The action no
  longer carries its own ignore gate, versionable cascade or
  trigger/informational classification, and no longer imports `ChangesetConfig`
  or the `PublishabilityDetector` overrides directly.
- Verified commits via `BranchManager.commitChanges()` (GitHub API,
  `GitCommit.commitFiles`).
- PR creation/update via `Report` service (uses `PullRequest` library service).
- Auto-merge support via `PullRequest` service (GraphQL API).
- Check run lifecycle via `CheckRun.withCheckRun()`.
- PR creation failures propagate as `PullRequestError` through the Effect error
  channel rather than returning a sentinel result.
- Dry-run mode for testing.

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

Effect makes this pattern easy with `Effect.all`, `Effect.result` (v4; was
`Effect.either`), and custom error types.

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

**Dependency injection:** `Context.Service` (v4; was `Context.Tag`) + `Layer`
provides compile-time verified dependency injection. Each service declares its
dependencies in its Layer, and the compiler ensures all dependencies are
satisfied.

**Testability:** Mock any service by providing `Layer.succeed(Tag, mockImpl)`.
No need for complex mocking frameworks or module mocking.

**Composition:** `makeAppLayer` in `src/layers/app.ts` wires all layers in one place.
Adding a new service means defining its Tag, implementing its Layer, and adding it
to `makeAppLayer`.

### Why Three-Phase (Pre/Main/Post)?

The `@savvy-web/github-action-effects` library is built around a three-phase
token lifecycle and steers single-token actions to the `GitHubToken` namespace.
Using it:

- **Keeps the client construction idiomatic.** `GitHubToken.client()` reads the
  envelope `pre` persisted, so there is no bare `GitHubClientLive` and no
  `process.env.GITHUB_TOKEN` bridge.
- **Revokes the token even when `main` fails.** `post` always runs and disposes
  the token (guarded so it never fails the workflow). Tokens also expire after
  1 hour regardless.
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
