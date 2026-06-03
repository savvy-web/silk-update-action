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

- **Library services**: From `@savvy-web/github-action-effects` (`^2.0.0`):
  `CommandRunner`, `GitBranch`, `GitCommit`, `CheckRun`, `GitHubClient`,
  `NpmRegistry`, `PullRequest`, `GithubMarkdown`, `GitHubToken`. `pre.ts` and
  `post.ts` provide `GitHubAppLive ∘ OctokitAuthAppLive ∘ FetchHttpClient.layer`
  for `GitHubToken.provision`/`dispose`.
- **Domain services**: `BranchManager`, `PnpmUpgrade`, `ConfigDeps`,
  `RegularDeps`, `Report`, `Lockfile`, `Changesets`, `RuntimeUpgrade`.
  Workspace enumeration uses `WorkspaceDiscovery` from `workspaces-effect`
  (`^1.0.0`) directly (no local `Workspaces` Tag). Stateless helpers:
  `WorkspaceYaml`, `PeerSync`. `RuntimeUpgrade` depends on `runtime-resolver`'s
  `NodeResolver`, `DenoResolver`, and `BunResolver` services; wired with either
  offline bundled cache layers (`Offline*CacheLive`, the default) or live
  network layers (`Auto*CacheLive`) depending on the `runtime-data` input.
- **Silk-effects shims**: `services/changeset-config.ts` and
  `services/publishability.ts` are thin re-export shims over
  `@savvy-web/silk-effects` (`^0.4.0`) — the `ChangesetConfig` Tag (now with
  `mode`, `versionPrivate`, `ignorePatterns`, `isIgnored`, `fixed`) and the
  `PublishabilityDetector` Layer overrides live upstream. Both are
  FileSystem-backed, so `makeAppLayer` provides `platform`
  (`NodeContext.layer`) to each.
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
| `@savvy-web/silk-effects` | `savvy-web/silk-effect` | clone as needed | direct → `pnpm link` |
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
    workspaces-effect: "link:../../spencerbeggs/workspaces-effect/dist/dev"
  ```

  then `pnpm install`. `dist/dev` is the rslib-builder link target (`publishConfig.directory` + `linkDirectory: true`). Effect resolves services by the tag's string id, so the one provided layer is shared even across duplicate copies — but the override keeps the bundle to a single copy. Verify every resolution points at the link: `find node_modules -name workspaces-effect`.

**Procedure (either mechanism):**

1. **Build the library:** in its repo run `pnpm ci:build` (produces `dist/dev` link target plus `dist/npm` / `dist/github`).
2. **Link it** (link or override) and `pnpm install`.
3. **Keep the declared range correct** in this repo's `package.json` for the eventual unlinked install — the link/override overrides resolution only while in place.
4. **Iterate:** edit library source → `pnpm ci:build` there → `pnpm typecheck` + `pnpm test` here → `pnpm build` here (bundles the linked lib into `dist/`) → commit the full state (`src` + `dist` + changeset + the `pnpm-workspace.yaml` override + `pnpm-lock.yaml`) → push `dev`.
5. **Library edits ship separately:** they land on the library's own branch and release with its next published version — call them out.
6. **Exercise the dev build:** flip a consumer workflow from the released tag to `@dev` so it runs the committed `dist` from this repo's `dev` branch (see *Testing dev-branch builds* below). Trigger it (`workflow_dispatch` or its normal event), then `gh run list` / `gh run watch`, diagnose, fix, rebuild, re-push `dev`.
7. **Final step, only AFTER the dogfooded version publishes:** remove the link/override, pin the published range, `pnpm install`.

**Committing while a link/override is active:** commit the **full dogfood state** to `dev` — `src` + rebuilt `dist` + changeset **and** the `pnpm-workspace.yaml` override + `pnpm-lock.yaml`. The override holds a machine-specific link path, so `dev` only installs cleanly with the sibling repos checked out at the paths in the table above; that is the accepted dogfooding trade-off, and the cleanup in step 7 reverts it. No CI runs on a plain `dev` push, so the committed `dev` source may reference an unpublished library API until it publishes — expected during dogfooding. Commits must be GPG-signed with the GitHub-verified key for `C. Spencer Beggs <spencer@savvyweb.systems>` or the signature ruleset rejects them.

**Currently active:** nothing is linked — `pnpm-workspace.yaml` has no `overrides` block and every first-party dep resolves to its registry version (`workspaces-effect@1.1.0` already ships `WorkspaceDiscovery.refresh()`; `runtime-resolver@^0.3.10`, `semver-effect@^0.2.1`, `@savvy-web/github-action-effects@^2.0.0`, and `@savvy-web/silk-effects@^0.4.1` are all unlinked).

## Development & Release Cycle

### The `dev` branch convention

All in-progress feature work lands on a long-lived **`dev`** branch, never directly on `main`. `main` always reflects the last released state.

The shared release workflow at `savvy-web/.github/.github/workflows/release.yml` has a matching **`dev` branch**. A consumer repo's calling workflow normally pins `@main`; switching it to `@dev` exercises in-progress workflow changes before they reach `main`.

### Testing dev-branch builds

Because the action ships as a bundled `dist`, testing dev work means pointing a consumer workflow at a `@dev` ref. There are **two independent switch points**:

- **This action's dev `dist`** — a workflow that *uses* the action pins it by tag. `.github/workflows/pnpm-update.yml` in this repo runs `uses: savvy-web/silk-update-action@v1`; change `@v1` → `@dev` to run the committed dev-branch `dist` (including any locally-linked library changes baked into it) against this very repo. The same flip works in any other repo whose caller invokes this action.
- **The shared release workflow** — `.github/workflows/release.yml` is a thin caller: `uses: savvy-web/.github/.github/workflows/release.yml@main`; change `@main` → `@dev` to exercise the shared workflow's dev branch.

Flip the relevant switch, run the workflow (`workflow_dispatch` or its normal trigger), watch with `gh run watch`, then revert the switch (`@dev` → `@v1` / `@main`) once the released version is cut. `release-sync.yml` (below) hard-resets `dev` to `main` on each release, so `dev` is disposable between cycles.

### Flow: `dev` → `main` → release

1. Feature work accumulates on `dev`; merge it into `main` when ready.
2. The push to `main` triggers **Phase 1** — changeset detection creates/updates `changeset-release/main` and the release PR.
3. Pushes to the release branch trigger **Phase 2** validation (build, publish dry-runs, release-notes preview, sticky comment).
4. Merging the release PR triggers **Phase 3** — publishing, Git tags, and a published GitHub release.
5. The published release fires `release-sync.yml` (below), which closes the loop by resetting `dev` back to `main`.

### `release-sync.yml` — post-release housekeeping

Triggered by `release: [published]` (and `workflow_dispatch` with a `tag` input + `dry-run` for rehearsal). Runs as the GitHub App bot so its pushes can bypass protection and won't recurse (no workflow triggers on tag/`dev` pushes). On a **stable SemVer 2.0.0 release `>= 1.0.0`** (bare `MAJOR.MINOR.PATCH` — no leading `v`, no `-prerelease`, no `+build`) it:

1. Moves (or creates) the **`v<major>`** alias tag (e.g. `v1`) at the released commit.
2. **Hard-resets `dev` to `main` HEAD** — a genuine clobber, so any `dev` commit not yet in `main` is discarded. This is safe by design: `dev` work always lands in `main` before a release.

Each push is guarded: if the remote `v<major>` tag or `dev` already points at its target commit, that push is skipped, so no ref-update events fire for listeners when there is nothing to change. Sub-`1.0.0`, prerelease, build-metadata, and non-SemVer tags are ignored (no-op).

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
- Action input is `app-client-id` (not `app-id`); `skip-token-revoke` controls
  whether `post.ts` revokes the token
- `Changesets.create` ignore-gates the versionable cascade: a changeset-ignored
  package (`ChangesetConfig.isIgnored`) is skipped before the publishability
  check, so it is never versioned even when `privatePackages.version` is set
- `action.config.ts` declares pre/main/post entries and `build.ignore`s
  cyclonedx optional plugins (xmlbuilder2/libxmljs2/ajv-formats-draft2019)
- `upgrade-package-manager` is a **string** input (`false` | `true` | `auto` | a semver
  range), validated like the `upgrade-runtime-*` inputs — not a boolean.
  Default `"true"`. It currently upgrades **pnpm only** (support for other
  package managers is planned); the implementing service is still `PnpmUpgrade`.
  This input was renamed from `update-pnpm` in the v2 rebrand. `true`/`auto`
  resolve the latest pnpm within the **current
  major** (favoring the `devEngines.packageManager` version); an explicit range
  (e.g. `^11`) may cross majors and can add a `packageManager` field when none
  exists. `PnpmUpgrade` no longer runs `corepack use` — it edits root
  `package.json` directly, writing the resolved version with the corepack-
  canonical `+sha512.<hex>` hash (derived from the npm registry integrity via
  `corepackHashFromIntegrity` in `src/utils/pnpm.ts`) into **both**
  `packageManager` and `devEngines.packageManager.version`. The corepack switch
  happens via the existing `runInstall`
  (`pnpm install --frozen-lockfile=false --fix-lockfile`), which reads the
  rewritten fields. Unlike the runtime bump, the pnpm bump **does** trigger
  `runInstall` (gated on `configUpdatesFromPnpm.length > 0`); like the runtime
  bump it never creates a changeset.
- Runtime engine bumps (`upgrade-runtime-*`) edit root `package.json`
  `devEngines.runtime` and flow into the PR/commit/summary, but never create a
  changeset and never trigger `pnpm install` (unlike the pnpm bump, which does
  trigger install). `auto` is
  modify-only (no-op on static pins and no-op when no entry exists); an explicit
  semver range can add a missing entry. An explicit range only selects which
  line to resolve — the written value **preserves the existing entry's operator**
  (an exact pin stays exact, a caret stays caret); the range's own operator is
  used only when adding a brand-new entry. `runtime-data: live` opts into network
  resolution (Auto cache, falls back to bundled). Note that `runtime-resolver`
  only resolves versions within currently-maintained (non end-of-life) runtime
  major lines — if the existing entry or target range points to an EOL line, the
  resolution will fail and the runtime bump is skipped with a warning. This
  applies to both offline and live data sources.
