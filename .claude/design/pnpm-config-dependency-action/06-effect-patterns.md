# Effect Patterns

[Back to index](./_index.md)

## Service Architecture

Services are organized in two tiers:

1. **Library services** from `@savvy-web/github-action-effects` (infrastructure)
2. **Domain services** defined in `src/services/` (application logic)

### Library Services

**Action plumbing** (provided by `Action.run()` automatically):

- `ActionOutputs` - Set outputs (`set`), mask secrets (`setSecret`), write job
  summary (`summary`), fail the action (`setFailed`)
- `ActionEnvironment` - Provides GitHub Actions environment variables (repo, sha, ref,
  actor, etc.) without depending on `@actions/github`
- `ActionLogger` - Routes `Effect.logDebug` to `core.debug()`, `Effect.logInfo`
  to `core.info()`, etc.

**Token lifecycle (three-phase, 2.0):**

- `GitHubApp` / `GitHubAppLive` - GitHub App auth surface. In 2.0 `GitHubAppLive`
  requires `OctokitAuthAppLive` **and** `HttpClient.HttpClient` (provided via
  `FetchHttpClient.layer`). Used only by `pre.ts` / `post.ts`.
- `GitHubToken` namespace - coordinates one installation token across phases:
  `provision()` (pre, with fail-fast scope check), `client()` (main, builds a
  `GitHubClient` layer), `dispose()` (post). The envelope is persisted to
  `ActionState`, which is backed by the runner's `GITHUB_STATE` so a fresh
  `ActionStateLive` in `main` reads the token `pre` persisted.
- `ActionState` / `ActionStateLive` - cross-phase state store. Requires
  `FileSystem.FileSystem`.

**Infrastructure services** (the `GitHubClient` is built from `GitHubToken.client()`):

- `GitHubClient` - Octokit wrapper with `rest()` and `repo`. In 2.0 this is a
  namespace of layer constructors (`fromEnv` / `fromToken` / `fromApp`), not a
  bare `GitHubClientLive`; this action builds it via `GitHubToken.client()`.
- `GitBranch` / `GitBranchLive` - Branch CRUD: `exists`, `create`, `delete`, `getSha`
- `GitCommit` / `GitCommitLive` - Git Data API: `createTree`, `createCommit`, `updateRef`
- `CheckRun` / `CheckRunLive` - Check run lifecycle: `withCheckRun`, `complete`
- `PullRequest` / `PullRequestLive` - PR CRUD + auto-merge via GraphQL
- `NpmRegistry` / `NpmRegistryLive` - npm registry queries (version, integrity)
- `CommandRunner` / `CommandRunnerLive` - Shell command execution: `exec`, `execCapture`
- `DryRun` / `DryRunLive(flag)` - Dry-run mode flag

### Workspace Services (from workspaces-effect)

Workspace enumeration comes from `workspaces-effect` directly — there is no
local wrapper service:

- `WorkspaceDiscovery` / `WorkspaceDiscoveryLive` — Upstream Effect-native
  workspace enumeration. Provides `listPackages(cwd?)` and
  `importerMap(cwd?)`. Requires `WorkspaceRoot` and `NodeContext.layer`
  (FileSystem/Path).
- `WorkspaceRoot` / `WorkspaceRootLive` — Resolves workspace root from cwd.
- `PublishabilityDetector` Tag (the override default `PublishabilityDetectorLive`
  with vanilla rules). The action overrides this Tag with the silk/adaptive
  detector from `@savvy-web/silk-effects` (see below).

### Silk Services (from @savvy-web/silk-effects)

Publishability rules and changeset-config reading live in `@savvy-web/silk-effects`. Both are FileSystem-based (read via `@effect/platform` FileSystem, not `node:fs`). `src/services/publishability.ts` and `src/services/changeset-config.ts` are thin re-export shims over this library.

- `PublishabilityDetectorAdaptiveLive` (and the simpler `SilkPublishabilityDetectorLive`) — `PublishabilityDetector` Tag overrides. The adaptive variant requires `FileSystem | ChangesetConfig` and dispatches per-call on `ChangesetConfig.mode` (silk / vanilla / none).
- `ChangesetConfig` Tag + `ChangesetConfigLive` — reads `.changeset/config.json`. Requires `ChangesetConfigReader` (→ FileSystem); the shim composes `ChangesetConfigReaderLive` so only a `FileSystem` requirement is left. Exposes `mode`, `versionPrivate`, `ignorePatterns`, `isIgnored` and `fixed`.

### Domain Services (src/services/)

Each domain service uses `Context.Tag` + `Layer`. `ChangesetConfig` and the
publishability overrides are no longer local — they are re-exported from
`@savvy-web/silk-effects` (see above):

- `BranchManager` / `BranchManagerLive` - Depends on `GitBranch`, `GitCommit`, `CommandRunner`
- `PnpmUpgrade` / `PnpmUpgradeLive` - Depends on `CommandRunner`
- `ConfigDeps` / `ConfigDepsLive` - Depends on `NpmRegistry`
- `RegularDeps` / `RegularDepsLive` - Depends on `NpmRegistry`,
  `WorkspaceDiscovery`
- `Changesets` / `ChangesetsLive` — Depends on `WorkspaceDiscovery`,
  `PublishabilityDetector`, `ChangesetConfig`
- `Report` / `ReportLive` - Depends on `PullRequest`

Stateless concerns (`PeerSync`, `WorkspaceYaml`, `Lockfile` standalone
helpers) export standalone helper functions used directly by `program.ts`.
`syncPeers` requires `WorkspaceDiscovery` in its environment;
`compareLockfiles` requires `WorkspaceDiscovery` in its environment.

### Layer Composition

All `main`-phase layers are wired together in `src/layers/app.ts`:

```typescript
// main.ts — no { layer }; program needs only the core services Action.run injects:
Action.run(program);

// Inside program (program.ts) — no token plumbing:
const appLayer = makeAppLayer(dryRun);
yield* innerProgram(inputs, dryRun, headSha, appLayer);
```

`makeAppLayer(dryRun)` takes only `dryRun`. It builds the `GitHubClient` from
`GitHubToken.client()` (over a self-contained `ActionStateLive`, `Layer.orDie`),
which reads the token envelope `pre` persisted — there is no
`process.env.GITHUB_TOKEN` bridge. The function separates library layers from
domain layers, then uses `Layer.provideMerge` to wire domain layers on top of
library layers. The `pre` / `post` phases wire their own `GitHubAppLive`-based
layers (`PreLive` / `PostLive`).

## Error Handling Strategy

Effect distinguishes between **expected errors** (typed, recoverable) and **unexpected errors** (defects):

**Expected Errors (Typed):**

- `PnpmError` - pnpm command failures
- `GitError` - git operation failures
- `GitHubApiError` - API call failures
- `InvalidInputError` - validation failures
- `FileSystemError` - file read/write failures
- `LockfileError` - lockfile parsing failures

**Strategy by Error Type:**

| Scenario | Strategy | Effect Pattern |
| --- | --- | --- |
| Critical errors | Fail fast | `Effect.fail()` |
| Batch operations | Accumulate | Sequential loop with `Effect.catchAll()` |
| Transient failures | Retry | `Effect.retry(Schedule)` |
| Optional features | Graceful degradation | `Effect.catchAll()` |

## Typed Errors with Schema.TaggedError

```typescript
import { Schema } from "effect";

/** pnpm command execution error */
export class PnpmError extends Schema.TaggedError<PnpmError>()("PnpmError", {
 command: NonEmptyString,
 dependency: Schema.optional(Schema.String),
 exitCode: Schema.Number.pipe(Schema.int()),
 stderr: Schema.String,
}) {
 get message() {
  return `pnpm ${this.command} failed (exit ${this.exitCode}): ${this.stderr}`;
 }
}
```

## Resource Management

### Token Lifecycle via the GitHubToken namespace (three-phase)

The installation token spans the three phases. `pre.ts` provisions it (with a
fail-fast scope check) and persists the envelope to `ActionState`; `main` reads
it back via `GitHubToken.client()`; `post.ts` revokes it via
`GitHubToken.dispose()`. `post` always runs — even when `main` fails — and is
guarded so a revocation failure never fails the workflow.

```typescript
// pre.ts
const token = yield* GitHubToken.provision({
 permissions: { contents: "write", pull_requests: "write", checks: "write" },
});

// post.ts
yield* GitHubToken.dispose().pipe(Effect.catchAll(/* never fail the workflow */));
```

### Check Run Lifecycle via CheckRun.withCheckRun

Check runs are automatically finalized even on failure:

```typescript
const checkRunService = yield* CheckRun;
yield* checkRunService.withCheckRun(name, headSha, (checkRunId) =>
 Effect.gen(function* () {
  // Check run is "in_progress" here
  // Use checkRunService.complete(checkRunId, conclusion, output) to finalize
 }),
);
```

## Running the Effect Program

```typescript
// program.ts
import { Action, ActionEnvironment, ActionInputError } from "@savvy-web/github-action-effects";
import { Config, Duration, Effect } from "effect";
import { makeAppLayer } from "./layers/app.js";

export const program = Effect.gen(function* () {
 const dryRun = yield* Config.boolean("dry-run").pipe(Config.withDefault(false));
 const timeout = yield* Config.integer("timeout").pipe(Config.withDefault(180));
 // ... other Config.* calls (no app-client-id / app-private-key here)

 const env = yield* ActionEnvironment;
 const headSha = (yield* env.github).sha;

 const appLayer = makeAppLayer(dryRun);
 yield* innerProgram(inputs, dryRun, headSha, appLayer).pipe(
  Effect.timeoutFail({
   duration: Duration.seconds(timeout),
   onTimeout: () => new Error(`Action timed out after ${timeout} seconds`),
  }),
 );
});

// main.ts
Action.run(program);
```

**Testing:** The `program` is exported from `program.ts` for testability.
Tests import `program` and `runCommands` directly without going through
`main.ts` (which only contains the module-level `Action.run` call). They
mock `@savvy-web/github-action-effects` via `vi.mock()` and test the
exported `program` Effect with mock service layers. `pre.ts` and `post.ts`
have their own suites (`pre.test.ts`, `post.test.ts`) exercising token
provisioning, duration reporting and `skip-token-revoke` short-circuiting via
the library's test layers.
