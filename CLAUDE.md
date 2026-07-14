# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Status

This is a **GitHub Action** for updating pnpm config dependencies, regular
dependencies, and `devEngines.runtime` entries (node/deno/bun). It runs as
**three phases** (pre/main/post): `src/pre.ts` provisions the GitHub App token
via `GitHubToken.provision`, `src/main.ts` is a thin `Action.run(program)`
wrapper, and `src/post.ts` reports duration and revokes the token. The actual
Effect program and helpers (`runCommands`, `runInstall`) live in
`src/program.ts`; cross-phase state lives in `src/state.ts`. It uses Effect-TS
for typed error handling, service injection, and retry logic. Domain logic is
wrapped as Effect services (`Context.Tag` + `Layer`) in `src/services/`, with
layer composition in `src/layers/app.ts`
(`makeAppLayer(dryRun, { runtimeLive })` — builds `GitHubClient` from
`GitHubToken.client()`, reading the token the pre phase persisted to
`ActionState`; `runtimeLive` selects offline or live resolver layers for
`RuntimeUpgrade`).

For architecture and implementation details, load sections as needed:
-> @./.claude/design/silk-update-action/_index.md

Load the index first, then follow its navigation guide to load specific
sections based on what you are working on. Do not load all sections at once.

Key sections:

- Architecture overview: -> @./02-architecture.md
- Pre/main/post entry points: -> @./04-module-entry-points.md
- Services and utilities: -> @./05-module-library.md
- Effect-TS patterns and services: -> @./06-effect-patterns.md
- GitHub API integration: -> @./07-github-integration.md
- Type definitions: -> @./03-type-definitions.md

Skip for simple bug fixes or test-only changes.

## Commands

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run typecheck         # Type-check via Turbo
pnpm run test              # Run all tests
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with coverage report
```

### Building

```bash
pnpm run build             # Build all packages (dev + prod)
pnpm run build:prod        # Build production/npm output only
```

### Running a Single Test

```bash
# Run a specific test file
pnpm vitest run src/services/regular-deps.test.ts

# Run tests matching a pattern
pnpm vitest run --testNamePattern="parsePnpmVersion"
```

## Architecture

### Repository Structure

- **Type**: Single-package GitHub Action (not a multi-package monorepo)
- **Entry points**: three phases — `src/pre.ts` (provision token + record start
  time), `src/main.ts` (thin `Action.run(program)` wrapper), `src/post.ts`
  (report duration + revoke token). `src/program.ts` holds the testable Effect
  program plus `runCommands` and `runInstall` helpers
- **Cross-phase state**: `src/state.ts` (`StartTimeState`, `STATE_KEYS`)
- **Services**: `src/services/` (domain services with `Context.Tag` + `Layer`)
- **Schemas**: `src/schemas/domain.ts` (Effect Schema definitions)
- **Errors**: `src/errors/errors.ts` (Schema.TaggedError definitions)
- **Layers**: `src/layers/app.ts` (`makeAppLayer(dryRun)` wires all layers;
  builds `GitHubClient` from `GitHubToken.client()` via a self-contained
  `ActionStateLive ∘ NodeContext.layer` + `Layer.orDie`)
- **Utils**: `src/utils/` (pure helpers: deps, input, markdown, pnpm, runtime, semver)
- **Shared Configs**: `lib/configs/`
- **Build**: Turbo for caching; `typecheck` depends on `build`

### Effect-TS Patterns

- **Library services**: From `@savvy-web/github-action-effects` (`^2.4.0`): `CommandRunner`, `GitBranch`, `GitCommit`, `CheckRun`, `GitHubClient`, `NpmRegistry`, `PullRequest`, `GithubMarkdown`, `GitHubToken`. `pre.ts` and `post.ts` provide `GitHubAppLive ∘ OctokitAuthAppLive ∘ FetchHttpClient.layer` for `GitHubToken.provision`/`dispose`.
- **Domain services**: `BranchManager`, `PnpmUpgrade`, `ConfigDeps`, `RegularDeps`, `Report`, `Lockfile`, `Changesets`, `RuntimeUpgrade`. Workspace enumeration uses `WorkspaceDiscovery` from `workspaces-effect` (`^2.0.3`) directly (no local `Workspaces` Tag), still consumed by `RegularDeps`, `PeerSync`, and `Lockfile`. Stateless helpers: `WorkspaceYaml`, `PeerSync`. `PnpmUpgrade`, `ConfigDeps`, and `RegularDeps` all query npm via the `NpmRegistry` service. `RuntimeUpgrade` depends on `runtime-resolver`'s `NodeResolver`, `DenoResolver`, and `BunResolver` services; wired with either offline bundled cache layers (`Offline*CacheLive`, the default) or live network layers (`Auto*CacheLive`) depending on the `runtime-data` input.
- **Changesets adapter**: `services/changesets.ts` is a thin adapter over `Changesets.DepsRegen` from `@savvy-web/silk-effects`, which is the source of truth for dependency changesets. silk-effects 3 swapped its embedded changesets engine to the @changesets v3 `next` prereleases (hence the `@changesets/config@4` `$schema` in `.changeset/config.json`); the consumed DepsRegen surface is unchanged. Since silk-effects 3.2.1, `DepsRegen.plan` refreshes workspace discovery at plan time, so the changeset step sees manifests edited earlier in the run (fixes the silent zero-changeset bug). `create(workspaceRoot, base)` runs `depsRegen.plan({ cwd, base }) → execute` and maps written files to `ChangesetFile[]`. All gating (versionable-minus-ignored: publishable OR `privatePackages.version`, minus the `ignore` list) lives upstream in DepsRegen — this repo no longer carries `changeset-config.ts` / `publishability.ts` shims or its own predicate. `makeAppLayer` wires it as `SilkChangesets.DepsRegenDefault.pipe(Layer.provide(platform))`; `DepsRegenDefault` bundles PointInTimeWorkspace, ConfigInspector, WorkspaceDiscovery, silk's adaptive `PublishabilityDetector`, and `ChangesetConfig` internally, leaving only platform services (FileSystem/Path/CommandExecutor via `NodeContext.layer`) to satisfy.
- **Errors**: `Schema.TaggedError` (`PnpmError`, `GitHubApiError`, `FileSystemError`)
- **Entry**: `Action.run(program)` from `main.ts` (no `{ layer }` — `program`
  needs only the core services `Action.run` injects); inputs parsed via Effect
  `Config.*` API inside `program.ts`.
- **Token**: provisioned in `pre.ts` via `GitHubToken.provision(...)` (fail-fast
  permission verification for `contents`/`pull_requests`/`checks: write`),
  persisted to `ActionState`, read back inside `makeAppLayer` via
  `GitHubToken.client()`, and revoked in `post.ts` via `GitHubToken.dispose()`.
  `program.ts` does not parse app credentials and has no token bridge.
- **Tests**: Mock services via Effect `Layer.succeed`; tests import the
  `program` Effect directly from `program.ts` to avoid the module-level
  `Action.run` call in `main.ts`. The library implements the GitHub Actions
  protocol natively, so `vi.mock("@actions/core")` is no longer needed.

### Dogfooding First-Party Dependencies

We author every first-party dependency in the table below, so a bug or missing API in one can be fixed **in its own repo** and dogfooded through this action before publishing. The action is a **bundled** artifact — `pnpm build` inlines every dependency into `dist/{main,pre,post}.js` — so once a local library build is linked and this repo is rebuilt, the change is baked into the committed `dist`. A consumer workflow running this action at `@dev` runs that committed `dist`, **not** `node_modules`.

| Package | Repo | Local checkout | Link mechanism |
| ------- | ---- | -------------- | -------------- |
| `@savvy-web/github-action-effects` | `savvy-web/github-action-effects` | `../github-action-effects` | direct → `pnpm link` |
| `@savvy-web/github-action-builder` | `savvy-web/github-action-builder` | `../github-action-builder` | direct (build tool) → `pnpm link` |
| `@savvy-web/silk-effects` | `savvy-web/systems` (monorepo, `packages/silk-effects`) | `../systems` (pkg: `../systems/packages/silk-effects`) | direct → `pnpm link` |
| `runtime-resolver` | `spencerbeggs/runtime-resolver` | `../../spencerbeggs/runtime-resolver` | direct → `pnpm link` |
| `semver-effect` | `spencerbeggs/semver-effect` | `../../spencerbeggs/semver-effect` | direct + transitive → override |
| `workspaces-effect` | `spencerbeggs/workspaces-effect` | `../../spencerbeggs/workspaces-effect` | direct + transitive → override |
| `jsonc-effect` | `spencerbeggs/jsonc-effect` | `../../spencerbeggs/jsonc-effect` | transitive (via silk-effects) → override |
| `yaml-effect` | `spencerbeggs/yaml-effect` | `../../spencerbeggs/yaml-effect` | transitive (via silk-effects) → override |

`@savvy-web/silk-effects` itself depends on `workspaces-effect`, `semver-effect`, `jsonc-effect`, and `yaml-effect`, and `runtime-resolver` also depends on `semver-effect`. So `workspaces-effect` and `semver-effect` resolve **both directly and transitively** (they need the override), `jsonc-effect` / `yaml-effect` are transitive-only (override too), and the rest are direct-only (`pnpm link`) — the **Link mechanism** column records which is which. (`json-schema-effect` is a sibling repo used by other actions but is **not** a dependency of this one.)

**Two ways to link a local library build:**

- **Direct-only dependency → `pnpm link`.** e.g. `pnpm link ../github-action-effects` symlinks `node_modules/@savvy-web/github-action-effects` to the local build. Verify the linked `package.json` via `node:fs` (NOT `require(...package.json)` — the `exports` map does not expose `./package.json`), or `pnpm why <pkg>`.
- **Also a transitive dependency → `pnpm-workspace.yaml` override.** A bare `pnpm link` redirects only the direct import, leaving the transitive copy (e.g. `workspaces-effect` pulled in by `silk-effects`) on the registry version and bundling **two** copies. A `link:` override forces every resolution to one local copy:

  ```yaml
  # pnpm-workspace.yaml
  overrides:
    workspaces-effect: "link:../../spencerbeggs/workspaces-effect/dist/dev/pkg"
  ```

  then `pnpm install`. `dist/dev/pkg` is the rslib-builder link target (`publishConfig.directory` + `linkDirectory: true`). Effect resolves services by the tag's string id, so the one provided layer is shared even across duplicate copies — but the override keeps the bundle to a single copy. Verify every resolution points at the link: `find node_modules -name workspaces-effect`.

**Procedure (either mechanism):**

1. **Build the library:** in its repo run `pnpm ci:build` (produces the `dist/dev/pkg` link target plus `dist/npm` / `dist/github`).
2. **Link it** (link or override) and `pnpm install`.
3. **Keep the declared range correct** in this repo's `package.json` for the eventual unlinked install — the link/override overrides resolution only while in place.
4. **Iterate:** edit library source → `pnpm ci:build` there → `pnpm typecheck` + `pnpm test` here → `pnpm build` here (bundles the linked lib into `dist/`) → commit the full state (`src` + `dist` + changeset + the `pnpm-workspace.yaml` override + `pnpm-lock.yaml`) → push `dev`.
5. **Library edits ship separately:** they land on the library's own branch and release with its next published version — call them out.
6. **Exercise the dev build:** flip a consumer workflow from the released tag to `@dev` so it runs the committed `dist` from this repo's `dev` branch (see *Testing dev-branch builds* below). Trigger it (`workflow_dispatch` or its normal event), then `gh run list` / `gh run watch`, diagnose, fix, rebuild, re-push `dev`.
7. **Final step, only AFTER the dogfooded version publishes:** remove the link/override, pin the published range, `pnpm install`.

**Committing while a link/override is active:** commit the **full dogfood state** to `dev` — `src` + rebuilt `dist` + changeset **and** the `pnpm-workspace.yaml` override + `pnpm-lock.yaml`. The override holds a machine-specific link path, so `dev` only installs cleanly with the sibling repos checked out at the paths in the table above; that is the accepted dogfooding trade-off, and the cleanup in step 7 reverts it. No CI runs on a plain `dev` push, so the committed `dev` source may reference an unpublished library API until it publishes — expected during dogfooding. Commits must be GPG-signed with the GitHub-verified key for `C. Spencer Beggs <spencer@savvyweb.systems>` or the signature ruleset rejects them.

**Currently active:** nothing is linked — `pnpm-workspace.yaml` has no `overrides` block and every first-party dep resolves to its published registry version (`@savvy-web/silk-effects@^3.2.1`, `workspaces-effect@^2.0.3`, `semver-effect@^0.3.1`, `runtime-resolver@^0.3.22`, `@savvy-web/github-action-effects@^2.4.0`, all unlinked). The stale-discovery fix (DepsRegen silently writing zero changesets) shipped in `workspaces-effect@2.0.3` / `@savvy-web/silk-effects@3.2.1` and is bundled into the committed `dist`.

## Development & Release Cycle

### The `dev` branch convention

All in-progress feature work lands on a long-lived **`dev`** branch, never directly on `main`. `main` always reflects the last released state.

The shared release workflow at `savvy-web/.github/.github/workflows/release.yml` has a matching **`dev` branch**. A consumer repo's calling workflow normally pins `@main`; switching it to `@dev` exercises in-progress workflow changes before they reach `main`.

### Testing dev-branch builds

Because the action ships as a bundled `dist`, testing dev work means pointing a consumer workflow at a `@dev` ref. There are **two independent switch points**:

- **This action's dev `dist`** — a workflow that *uses* the action pins it by tag. `.github/workflows/silk-update.yml` in this repo runs `uses: savvy-web/silk-update-action@v4`; change `@v3` → `@dev` to run the committed dev-branch `dist` (including any locally-linked library changes baked into it) against this very repo. The same flip works in any other repo whose caller invokes this action.
- **The shared release workflow** — `.github/workflows/release.yml` is a thin caller: `uses: savvy-web/.github/.github/workflows/release.yml@main`; change `@main` → `@dev` to exercise the shared workflow's dev branch.

Flip the relevant switch, run the workflow (`workflow_dispatch` or its normal trigger), watch with `gh run watch`, then revert the switch (`@dev` → `@v2` / `@main`) once the released version is cut. `release-sync.yml` (below) hard-resets `dev` to `main` on each release, so `dev` is disposable between cycles.

### Flow: `dev` → `main` → release

1. Feature work accumulates on `dev`; merge it into `main` when ready. Dependency-update PRs reach `main` via `promote-deps-to-main.yml` (below) instead of a manual merge.
2. The push to `main` triggers **Phase 1** — changeset detection creates/updates `changeset-release/main` and the release PR.
3. Pushes to the release branch trigger **Phase 2** validation (build, publish dry-runs, release-notes preview, sticky comment).
4. Merging the release PR triggers **Phase 3** — publishing, Git tags, and a published GitHub release.
5. The published release fires `release-sync.yml` (below), which closes the loop by resetting `dev` back to `main`.

### `release-sync.yml` — post-release housekeeping

Triggered by `release: [published]` (and `workflow_dispatch` with a `tag` input + `dry-run` for rehearsal). Runs as the GitHub App bot so its pushes can bypass protection and won't recurse (no workflow triggers on tag/`dev` pushes). On a **stable SemVer 2.0.0 release `>= 1.0.0`** (bare `MAJOR.MINOR.PATCH` — no leading `v`, no `-prerelease`, no `+build`) it:

1. Moves (or creates) the **`v<major>`** alias tag (e.g. `v1`) at the released commit.
2. **Hard-resets `dev` to `main` HEAD** — a genuine clobber, so any `dev` commit not yet in `main` is discarded. This is safe by design: `dev` work always lands in `main` before a release.

Each push is guarded: if the remote `v<major>` tag or `dev` already points at its target commit, that push is skipped, so no ref-update events fire for listeners when there is nothing to change. Sub-`1.0.0`, prerelease, build-metadata, and non-SemVer tags are ignored (no-op).

### `promote-deps-to-main.yml` — open the dependency-update release loop

Entry point to the release loop (mirror of `release-sync.yml`, which closes it). `silk-update.yml` must run the action with `source-branch: dev` so its `pnpm/config-deps` PR is cut from and `auto-merge: squash`-merged into `dev`; that merge is what fires this workflow.

Triggers on `pull_request: [closed]` with `branches: [dev]`, gated by `if: github.event.pull_request.merged == true && github.event.pull_request.head.ref == 'pnpm/config-deps'` (plus a `workflow_dispatch` manual path). On a merged config-deps PR it opens a `dev -> main` PR.

It mints a GitHub App token via `actions/create-github-app-token@v3` (`client-id: vars.APP_CLIENT_ID`, `private-key: secrets.APP_PRIVATE_KEY`, `owner: github.repository_owner`). The app token (not the default `GITHUB_TOKEN`) is what lets the created PR trigger required status checks and cloud reviewers / the action's smoke tests.

The `dev -> main` PR is left open for review — **not** auto-merged; merging it starts the normal release cycle. Idempotent (no-op when a `dev -> main` PR is already open, since it auto-tracks new `dev` commits) and non-recursive (its PR has base `main`, head `dev`, which never matches the trigger gate).

### Code Quality

- **Biome**: Unified linting and formatting (tabs for indentation)
- **Commitlint**: Conventional commits with DCO signoff
- **Husky Hooks**:
  - `pre-commit`: Runs lint-staged
  - `commit-msg`: Validates commit message format
  - `pre-push`: Runs tests for affected packages

### TypeScript Configuration

- Composite builds with project references
- Strict mode enabled
- ES2022/ES2023 targets
- Import extensions required (`.js` for ESM)

### Testing

- **Framework**: Vitest with v8 coverage
- **Pool**: Uses forks (not threads) for Effect-TS compatibility
- **Config**: `vitest.config.ts` supports project-based filtering via
  `--project` flag
- **Coverage gate (what it actually enforces)**: `vitest.config.ts` sets
  `thresholds: AgentPlugin.COVERAGE_LEVELS.strict.thresholds`, which despite the
  name resolves to **aggregate** (whole-run) minimums of
  `{ lines: 80, functions: 80, branches: 75, statements: 80 }` — **not** a
  per-file gate, and nowhere near 100%. The separate `coverageTargets`
  (90/90/85/90) are *aspirational* and are reported, not enforced. Consequence:
  a single file — even a large orchestration module — can have **zero** test
  execution and the gate still passes, because the rest of the suite carries the
  aggregate. Do not treat a green `test:coverage` as evidence that a given
  module is exercised; verify by fault injection (throw inside the code path and
  confirm a test fails). This is exactly how `program.ts`'s `innerProgram` went
  untested for so long.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins
- Separate type imports: `import type { Foo } from './bar.js'`

### Commits

All commits require:

1. Conventional commit format (feat, fix, chore, etc.)
2. DCO signoff: `Signed-off-by: Name <email>`
3. No markdown in commit body (commitlint `silk/body-no-markdown` rule)

### Publishing

Packages publish to both GitHub Packages and npm with provenance.

## Gotchas

- Biome enforces **tabs** for indentation (not spaces)
- GraphQL API required for auto-merge (no REST endpoint exists)
- `PullRequest` type includes `nodeId` for GraphQL API calls
- `@actions/core`/`@actions/github` are never imported directly; the head SHA
  comes from `ActionEnvironment` (`env.github.sha`) in `program.ts`
- Action input is `app-client-id` (not `app-id`); `post.ts` always revokes the
  token
- `source-branch` (default `main`) is the cut-from ref and default PR target;
  `target-branch` (empty → follows `source-branch`, via `resolveTargetBranch`)
  is the PR base. Both are validated by `BranchManager.validateBranches` early
  in `program.ts` — before the destructive branch delete-and-recreate
- `Changesets.create(workspaceRoot, base)` delegates to `Changesets.DepsRegen`
  (from `@savvy-web/silk-effects`), which recomputes the cumulative dependency
  diff from `merge-base(base) → worktree` and writes **one** consolidated
  `## Dependencies` changeset per in-scope package (deleting stale pure-dep
  changesets, leaving mixed ones untouched). Gating
  (versionable-minus-ignored) lives entirely upstream in DepsRegen — this repo
  no longer computes it, and the per-run `changes`/`regularUpdates`/`peerUpdates`
  drive only reporting, not the changeset step
- DepsRegen diffs `merge-base(target-branch) → worktree`, so the changeset step
  needs local history for the base ref: the workflow checkout must use
  `fetch-depth: 0`, and `BranchManager.ensureBaseHistory(target-branch)` runs as
  a preflight (best-effort fetch/unshallow) before `Changesets.create`
- `action.config.ts` declares pre/main/post entries, `build.ignore`s cyclonedx optional plugins (xmlbuilder2/libxmljs2/ajv-formats-draft2019), and lists `build.nativeDynamicImports` (`@changesets/apply-release-plan`, `workspaces-effect`) so rspack preserves their fully dynamic `await import()` in the bundle instead of miscompiling it into a context module — rationale in `@./.claude/design/silk-update-action/01-dependencies.md` and the `action.config.ts` comment
- `upgrade-package-manager` is a **string** input (`false` | `true` | `auto` | a semver range), validated like the `upgrade-runtime-*` inputs — not a boolean. Default `"true"`. It currently upgrades **pnpm only** (support for other package managers is planned); the implementing service is still `PnpmUpgrade`. This input was renamed from `update-pnpm` in the v2 rebrand. `true`/`auto` resolve the latest pnpm within the **current major** (favoring the `devEngines.packageManager` version); an explicit range (e.g. `^11`) may cross majors and can add a `packageManager` field when none exists. `PnpmUpgrade` queries pnpm versions and integrity via the `NpmRegistry` service — **not** a raw `npm view` shell-out, which hit EACCES against the root-owned `~/.npm` cache on GitHub macOS runners (the integrity fetch is best-effort; on failure the version is written without a hash). `PnpmUpgrade` no longer runs `corepack use` — it edits root `package.json` directly, writing the resolved version with the corepack-canonical `+sha512.<hex>` hash (derived from the npm registry integrity via `corepackHashFromIntegrity` in `src/utils/pnpm.ts`) into **both** `packageManager` and `devEngines.packageManager.version`. The corepack switch happens via the existing `runInstall`, which now **regenerates** the lockfile (`pnpm clean --lockfile` then `pnpm install --frozen-lockfile=false`) rather than `--fix-lockfile`: the action changes all three pnpm resolution inputs (pnpm version, config deps + `pnpm-plugin-silk` hooks, dependency ranges), and `--fix-lockfile` only repairs entries without re-resolving, so it could commit an inconsistent lockfile (e.g. an unfilled peer → `ERR_MODULE_NOT_FOUND`). `pnpm clean` needs **pnpm 11+** and runs a consumer's own `clean`/`purge` script over the built-in if one exists. Unlike the runtime bump, the pnpm bump **does** trigger `runInstall` (gated on `configUpdatesFromPnpm.length > 0`); like the runtime bump it never creates a changeset.
- Runtime engine bumps (`upgrade-runtime-*`) edit root `package.json`
  `devEngines.runtime` and flow into the PR/commit/summary, but never create a
  changeset and never trigger `pnpm install` (unlike the pnpm bump, which does
  trigger install). They **upgrade only, never add**: with no existing
  `devEngines.runtime` entry for that runtime there is nothing to upgrade, so it
  is skipped with a warning — in **every** mode (`auto` and an explicit semver
  range alike). `auto` is additionally a no-op on a static pin. A range (the
  existing entry's own version under `auto`, or the user-typed input range) only
  selects **which line to resolve** — the written value is **always the bare
  resolved version, exact, with no range operator** (an existing `^24.0.0` is
  rewritten as e.g. `24.9.1`). Operator preservation was dropped deliberately:
  `silk-runtime-action`, the next pipeline step, does not support range
  operators in `devEngines.runtime`. `runtime-data: live` opts into network
  resolution (Auto cache, falls back to bundled). Note that `runtime-resolver`
  only resolves versions within currently-maintained (non end-of-life) runtime
  major lines — if the existing entry or target range points to an EOL line, the
  resolution will fail and the runtime bump is skipped with a warning. This
  applies to both offline and live data sources.
