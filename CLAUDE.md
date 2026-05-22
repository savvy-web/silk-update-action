# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Status

This is a **GitHub Action** for updating pnpm config dependencies and regular
dependencies. It runs as **three phases** (pre/main/post): `src/pre.ts`
provisions the GitHub App token via `GitHubToken.provision`, `src/main.ts` is a
thin `Action.run(program)` wrapper, and `src/post.ts` reports duration and
revokes the token. The actual Effect program and helpers (`runCommands`,
`runInstall`) live in `src/program.ts`; cross-phase state lives in
`src/state.ts`. It uses Effect-TS for typed error handling, service injection,
and retry logic. Domain logic is wrapped as Effect services (`Context.Tag` +
`Layer`) in `src/services/`, with layer composition in `src/layers/app.ts`
(`makeAppLayer(dryRun)` — builds `GitHubClient` from `GitHubToken.client()`,
reading the token the pre phase persisted to `ActionState`).

For architecture and implementation details, load sections as needed:
-> @./.claude/design/pnpm-config-dependency-action/_index.md

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
- **Utils**: `src/utils/` (pure helpers: deps, input, markdown, pnpm, semver)
- **Shared Configs**: `lib/configs/`
- **Build**: Turbo for caching; `typecheck` depends on `build`

### Effect-TS Patterns

- **Library services**: From `@savvy-web/github-action-effects` (`^2.0.0`):
  `CommandRunner`, `GitBranch`, `GitCommit`, `CheckRun`, `GitHubClient`,
  `NpmRegistry`, `PullRequest`, `GithubMarkdown`, `GitHubToken`. `pre.ts` and
  `post.ts` provide `GitHubAppLive ∘ OctokitAuthAppLive ∘ FetchHttpClient.layer`
  for `GitHubToken.provision`/`dispose`.
- **Domain services**: `BranchManager`, `PnpmUpgrade`, `ConfigDeps`,
  `RegularDeps`, `Report`, `Lockfile`, `Changesets`.
  Workspace enumeration uses `WorkspaceDiscovery` from `workspaces-effect`
  (`^1.0.0`) directly (no local `Workspaces` Tag). Stateless helpers:
  `WorkspaceYaml`, `PeerSync`.
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
