# Module Entry Points

[Back to index](./_index.md)

The action ships three entry points wired to the `runs` block in `action.yml`:
`pre: dist/pre.js`, `main: dist/main.js`, `post: dist/post.js`. The GitHub App
token lifecycle spans them — `pre` provisions, `main` consumes, `post` revokes.

## src/pre.ts - Pre-Phase Entry

`pre.ts` provisions the GitHub App installation token and records the start
time for `post`'s duration report. `GitHubToken.provision({ permissions })`
reads the `app-client-id` / `app-private-key` inputs, mints the token, performs
a **fail-fast scope check** (a missing App scope fails here in `pre` rather than
mid-run in `main`), resolves the App identity best-effort and persists the token
envelope to `ActionState`. The start time is saved as a `StartTimeState`
(`src/state.ts`).

```typescript
yield* state.save(STATE_KEYS.startTime, new StartTimeState({ startedAt: Date.now() }), StartTimeState);
const token = yield* GitHubToken.provision({
 permissions: { contents: "write", pull_requests: "write", checks: "write" },
});
```

`PreLive` provides `GitHubAppLive` (over `OctokitAuthAppLive` and
`FetchHttpClient.layer`, since `GitHubAppLive` requires `HttpClient.HttpClient`)
merged with `NodeFileSystem.layer`. The module-level run is guarded by
`if (process.env.GITHUB_ACTIONS)` so importing the module in tests does not
execute it.

## src/post.ts - Post-Phase Entry

`post.ts` runs after `main`, even on failure. It reports total duration from the
saved `StartTimeState`, then revokes the token via `GitHubToken.dispose()`. The
whole effect is guarded with `Effect.catchAll` (around `dispose`) plus `Effect.catchAllDefect`
so a post failure never fails the workflow. `PostLive` mirrors `PreLive`.

## src/main.ts - Main-Phase Entry

`main.ts` is intentionally tiny: it calls `Action.run(program)` on the program
imported from `./program.ts`. No `{ layer }` is needed — `program`'s only
requirements are the core services `Action.run` injects (`ActionEnvironment`,
`ActionOutputs`, config provider); `GitHubClient` and the domain services are
provided internally by `appLayer`.

```typescript
import { Action } from "@savvy-web/github-action-effects";
import { program } from "./program.js";

/* v8 ignore next */
Action.run(program);
```

The module-level call is annotated with `/* v8 ignore next */` so coverage is
attributed to `program.ts`. Tests import `program` and `runCommands` directly
from `./program.js` without ever evaluating `main.ts`.

## src/state.ts - Cross-Phase State

`pre`, `main` and `post` run as separate Node processes. GitHub Actions persists
state between them as `STATE_*` env vars; `ActionState.save/get` encode/decode
each value through its Schema. `state.ts` defines `StartTimeState` (a
`Schema.Class` holding `startedAt: number`) and `STATE_KEYS`. The token envelope
itself is **not** modelled here — `GitHubToken.provision` persists it under its
own internal key.

## src/program.ts - The Effect Program

**Responsibility:** Orchestrate the complete dependency update workflow for the
`main` phase, including check runs and all update steps. Token provisioning and
revocation live in `pre.ts` / `post.ts`, not here.

### Input Parsing

Inputs are parsed using Effect's `Config.*` API:

```typescript
const branch = yield* Config.string("branch").pipe(Config.withDefault("pnpm/config-deps"));
const sourceBranch = yield* Config.string("source-branch").pipe(Config.withDefault("main"));
const rawTargetBranch = yield* Config.string("target-branch").pipe(Config.withDefault(""));
// Empty target-branch follows source-branch (resolveTargetBranch in src/utils/branch.ts).
const targetBranch = resolveTargetBranch(rawTargetBranch, sourceBranch);
const rawConfigDeps = yield* Config.string("config-dependencies").pipe(Config.withDefault(""));
const configDependencies = parseMultiValueInput(rawConfigDeps);
const rawDeps = yield* Config.string("dependencies").pipe(Config.withDefault(""));
const dependencies = parseMultiValueInput(rawDeps);
const rawPeerLock = yield* Config.string("peer-lock").pipe(Config.withDefault(""));
const peerLock = parseMultiValueInput(rawPeerLock);
const rawPeerMinor = yield* Config.string("peer-minor").pipe(Config.withDefault(""));
const peerMinor = parseMultiValueInput(rawPeerMinor);
const rawRun = yield* Config.string("run").pipe(Config.withDefault(""));
const run = parseMultiValueInput(rawRun);
// upgrade-package-manager is a string: "false" | "true" | "auto" | a semver range.
const upgradePackageManager = yield* Config.string("upgrade-package-manager").pipe(Config.withDefault("true"));
const changesets = yield* Config.boolean("changesets").pipe(Config.withDefault(true));
const autoMerge = yield* Config.string("auto-merge").pipe(Config.withDefault(""));
const dryRun = yield* Config.boolean("dry-run").pipe(Config.withDefault(false));
const timeout = yield* Config.integer("timeout").pipe(Config.withDefault(180));
// upgrade-runtime-{node,deno,bun} default "false"; runtime-data default "offline".
const rawRuntimeNode = yield* Config.string("upgrade-runtime-node").pipe(Config.withDefault("false"));
const rawRuntimeDeno = yield* Config.string("upgrade-runtime-deno").pipe(Config.withDefault("false"));
const rawRuntimeBun = yield* Config.string("upgrade-runtime-bun").pipe(Config.withDefault("false"));
const runtimeData = yield* Config.string("runtime-data").pipe(Config.withDefault("offline"));
const runtimeLive = runtimeData === "live";

// upgrade-package-manager and each upgrade-runtime-* value must be one of the input's
// allowed keywords or a parseable semver range — explicit ranges are validated
// via the standalone parseRange from semver-effect.
const anyRuntime = rawRuntimeNode !== "false" || rawRuntimeDeno !== "false" || rawRuntimeBun !== "false";

// Cross-validate: at least one update type must be active
if (configDependencies.length === 0 && dependencies.length === 0 && upgradePackageManager === "false" && !anyRuntime) {
 return yield* Effect.fail(new ActionInputError({ /* ... */ }));
}

// peer-lock and peer-minor must not overlap
const peerOverlap = peerLock.filter((p) => peerMinor.includes(p));
if (peerOverlap.length > 0) {
 return yield* Effect.fail(new ActionInputError({ /* ... */ }));
}
```

`parseMultiValueInput` (in `src/utils/input.ts`) accepts JSON arrays,
newline-separated lists (with optional `*` bullets and `#` comments), or
comma-separated strings. The `runtime-data` input (`offline` | `live`) selects
which `runtime-resolver` cache layers `makeAppLayer` wires.

### Layer Composition

There is no token plumbing in `program.ts`. The installation token was
provisioned in `pre` and its envelope persisted to `ActionState`; `program`
reads `headSha` from `ActionEnvironment`, builds the per-run layer and runs
`innerProgram` under the resolved log-level minimum (debug when the runner's
step-debug flag is on, info otherwise) and the timeout:

```typescript
const env = yield* ActionEnvironment;
const headSha = (yield* env.github).sha;

const appLayer = makeAppLayer(dryRun, { runtimeLive });
yield* innerProgram(inputs, dryRun, headSha, appLayer)
 .pipe(Logger.withMinimumLogLevel(effectLogLevel))
 .pipe(Effect.timeoutFail({
  duration: Duration.seconds(timeout),
  onTimeout: () => new Error(`Action timed out after ${timeout} seconds`),
 }));
```

`makeAppLayer(dryRun, { runtimeLive })` builds the `GitHubClient` from
`GitHubToken.client()` (see `src/layers/app.ts`), which reads the token envelope
from `ActionState` — no `process.env.GITHUB_TOKEN` bridge. `program.ts` does no
token plumbing of its own. `runtimeLive` (derived from `runtime-data === "live"`)
selects the `runtime-resolver` cache layers.

### Program Structure

The module exports:

- `program` — the main Effect (input parsing, layer composition, timeout).
- `innerProgram(inputs, dryRun, headSha, appLayer)` — the orchestration body.
  Provides `appLayer` at two levels (outer + inside the `withCheckRun`
  callback) because the callback signature requires `R = never`. Inside
  `withCheckRun` it calls `BranchManager.validateBranches(sourceBranch,
  targetBranch)` **before** `BranchManager.manage(branch, sourceBranch)`, so a
  missing ref fails fast before the destructive delete-and-recreate. The
  resolved `targetBranch` is threaded into `Report.createOrUpdatePR(branch,
  base, ...)` as the PR base, and into `Changesets.create(process.cwd(),
  targetBranch)` as the diff baseline. When `changesets` is enabled it first
  runs `BranchManager.ensureBaseHistory(targetBranch)` so the DepsRegen
  `merge-base(target) → worktree` diff can resolve on a shallow checkout.
- `runCommands(commands)` — execute custom commands sequentially via
  `CommandRunner` (`sh -c "<cmd>"`); returns `{ successful, failed }`.
- `runInstall()` — regenerates the lockfile via `CommandRunner.exec`:
  `pnpm clean --lockfile` then `pnpm install --frozen-lockfile=false`. It does
  not `--fix-lockfile` — the action changes the pnpm version, config and ranges,
  so resolution is re-run from scratch rather than repairing the existing
  lockfile (see the `runInstall` doc comment in `src/program.ts` for the full
  rationale and the pnpm 11+ / consumer-`clean`-script caveats).

`innerProgram` requires all domain services (`BranchManager`, `PnpmUpgrade`,
`RuntimeUpgrade`, `ConfigDeps`, `RegularDeps`, `Changesets`, `Report`) and
helper functions (`captureLockfileState`, `compareLockfiles`, `syncPeers`,
`formatWorkspaceYaml`) plus library services (`ActionOutputs`, `CheckRun`,
`CommandRunner`) and `WorkspaceDiscovery` (from `workspaces-effect`) in its
context.

The module-level call in `main.ts` uses `Action.run(program)` which handles all
error formatting via `formatCause` automatically.

Timeout is applied inside `program` via `Effect.timeoutFail` using the
configurable `timeout` input (default: 180 seconds).

### Key Exported Functions

- `program` — Main Effect (exported for testability).
- `runCommands(commands)` — Execute custom commands sequentially via
  `CommandRunner`.
- `runInstall()` — Regenerate the lockfile: `pnpm clean --lockfile` then `pnpm install --frozen-lockfile=false`.

Report-related functions (PR creation, commit messages, summaries) live in the
`Report` service in `src/services/report.ts`.

### Required GitHub App Permissions

Passed to `GitHubToken.provision({ permissions })` in `pre.ts` for a fail-fast
scope check:

- `contents: write` - Push commits and branches
- `pull_requests: write` - Create and update PRs
- `checks: write` - Create and update check runs
