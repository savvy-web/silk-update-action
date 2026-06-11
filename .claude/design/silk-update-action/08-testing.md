# Testing Strategy

[Back to index](./_index.md)

## Unit Testing

**Test Framework:** Vitest with v8 coverage, forks pool for Effect-TS compatibility.

Each `.ts` under `src/` has a co-located `.test.ts` sibling. Notable suites:

- **Entry points** (`main.test.ts`, `main.effect.test.ts`, `pre.test.ts`,
  `post.test.ts`) — orchestration with injected service fakes, input parsing
  and validation, dry-run behavior, and the token lifecycle. The `pre` / `post`
  suites drive the real `GitHubToken.provision` / `dispose` flow against the
  library's in-memory `@savvy-web/github-action-effects/testing` layers
  (`ActionStateTest`, `GitHubAppTest`, `ActionOutputsTest`), covering scope
  provisioning, start-time persistence, duration reporting and
  `skip-token-revoke` short-circuiting.
- **Schemas and errors** (`schemas/domain.test.ts`, `errors/errors.test.ts`) —
  schema validation for the domain types and error construction, `_tag`
  matching and the `isRetryable` / `getErrorMessage` helpers.
- **Dependency services** (`config-deps.test.ts`, `regular-deps.test.ts`,
  `peer-sync.test.ts`, `pnpm-upgrade.test.ts`, `runtime-upgrade.test.ts`) —
  npm-registry querying, range-respecting resolution (RegularDeps resolving
  within the current specifier's range, ConfigDeps within the synthesized
  major range, neither jumping to absolute `latest`), multi-section RegularDeps
  scanning with accurate per-section `type` reporting, `peer-lock`/`peer-minor`
  range computation, pnpm self-upgrade, and per-runtime `devEngines.runtime`
  rewriting (including `auto` no-op on static pins, missing-entry insertion,
  shape promotion and per-runtime resolver-failure resilience).
- **Lockfile and changesets** (`lockfile.test.ts`, `changesets.test.ts`) —
  catalog and importer comparison emitting per-importer, per-section triples;
  trigger-vs-informational classification, `regularUpdates` routing by
  `update.type`, the versionable cascade and empty-changeset suppression.
- **Reporting and formatting** (`report.test.ts`, `workspace-yaml.test.ts`) — PR
  creation/update, commit-message and summary generation, and YAML sorting/round
  -tripping.
- **Pure helpers** (`utils/input.test.ts`, `utils/runtime.test.ts`,
  `utils/semver.test.ts`, `utils/fixtures.test.ts`, `services/branch.test.ts`) —
  multi-value input parsing, `devEngines.runtime` helper functions,
  `configDepUpgradeRange` / range-resolution helpers, shared fixtures, and branch
  lifecycle via the `GitBranch` / `GitCommit` library services.

`changeset-config.ts` and `publishability.ts` are re-export shims with no unit
suites of their own — mode detection, `versionPrivate`/`isIgnored`/`fixed`
plumbing and the silk publishability rules are tested in `@savvy-web/silk-effects`
and exercised here indirectly through `changeset-emission.int.test.ts` (below),
which doubles as an upstream-drift canary. Workspace discovery is exercised via
`__test__/integration/workspaces.int.test.ts`, which runs `WorkspaceDiscoveryLive`
against real fixtures.

## Test Patterns

**Importing the program directly:** The `program` Effect lives in
`src/program.ts`, separated from the module-level `Action.run` call in
`src/main.ts`. Tests import `program` and `runCommands` from
`./program.js` without ever evaluating `main.ts`, so no `vi.mock()` of the
library is needed just to suppress module-level execution. (Tests still mock
specific library services via `Layer.succeed` to inject fakes.) `pre` and
`post` are exported from `src/pre.ts` / `src/post.ts` the same way — guarded by
`if (process.env.GITHUB_ACTIONS)` so importing them in tests is side-effect-free.

**Library test layers:** The phase tests use the in-memory layers shipped
under `@savvy-web/github-action-effects/testing` (`ActionStateTest`,
`GitHubAppTest`, `ActionOutputsTest`) rather than `Layer.succeed` stubs, so the
real `GitHubToken.provision` / `dispose` flow runs against a shared
`ActionState`. Config inputs are injected with `Effect.withConfigProvider` over
a `ConfigProvider.fromMap`.

**Mock service layers:** Domain service tests create mock library services via
`Layer.succeed()`:

```typescript
const mockNpmRegistry = Layer.succeed(NpmRegistry, {
 getLatestVersion: vi.fn((pkg) =>
  Effect.succeed({ version: "1.2.3", integrity: "sha512-..." }),
 ),
});
```

Domain service tests provide the mock library layer to the service's Live layer:

```typescript
const testLayer = ConfigDepsLive.pipe(Layer.provide(mockNpmRegistry));
```

**No `@actions/core` mocking required:** The library implements the GitHub Actions
protocol natively without `@actions/*` package dependencies, so no test file
mocks `@actions/core`.

## Coverage

**Coverage Exclusions:**

`src/services/pnpm-upgrade.ts` is excluded from per-file coverage thresholds in
`vitest.config.ts` due to v8 function counting issues with Effect error callback
patterns. The module is still tested thoroughly via `pnpm-upgrade.test.ts`.

## Integration Testing

**In-Repo Integration Suites (`__test__/integration/`):**

Each suite builds its own `discoveryLayer` from `NodeContext.layer` directly:

```typescript
const platform = NodeContext.layer;
const discoveryLayer = WorkspaceDiscoveryLive.pipe(
 Layer.provide(Layer.merge(WorkspaceRootLive.pipe(Layer.provide(platform)), platform)),
);
```

- `workspaces.int.test.ts` — Verifies `WorkspaceDiscovery.listPackages` and
  `importerMap` against real single-leaf and multi-leaf fixtures.
- `lockfile-compare.int.test.ts` — Exercises `compareLockfiles` against
  paired `pnpm-lock.before.yaml` / `pnpm-lock.after.yaml` fixtures
  covering catalog and importer change shapes.
- `changeset-emission.int.test.ts` — Exercises the full
  `Changesets.create` gating cascade against fixtures with varying
  publishability and `versionPrivate` settings. Because the silk publishability
  rules and `ChangesetConfig` live in `@savvy-web/silk-effects`, this suite
  doubles as an upstream-drift canary — it wires the real silk
  `ChangesetConfigLive` / `PublishabilityDetectorAdaptiveLive` (over
  `NodeContext.layer`) and asserts end-to-end emission behavior. The
  `silk-ignored-versionable` fixture covers the ignore gate: an
  `ignore`-listed leaf is gated out despite `privatePackages.version: true`,
  while a non-ignored sibling still emits a changeset.
- `runtime-upgrade.int.test.ts` — Runs `RuntimeUpgrade.upgrade` against the
  real `Offline*CacheLive` layers from `runtime-resolver` (no network) over a
  temp `package.json`. Acts as an upstream-drift canary for the bundled cache:
  it asserts `auto` resolves a real version within an existing range and writes
  it back. Because the bundled cache only carries currently-maintained majors,
  the fixture pins `^24.0.0` (the lowest major present) rather than an EOL line.

The `RuntimeUpgrade` service and the pure `src/utils/runtime.ts` helpers have
their own co-located unit suites (`runtime-upgrade.test.ts`, `runtime.test.ts`)
covering shape promotion, `auto` no-op on static pins, missing-entry insertion
and per-runtime resolver-failure resilience.

**External Integration Test Scenarios (live GitHub repo, future work):**

1. **Full Workflow** - End-to-end test of entire action
2. **No Changes** - Verify early exit when already up-to-date
3. **Partial Failures** - Some updates succeed, some fail
4. **Branch Reset** - Handle existing branch deletion and recreation
5. **Changeset Creation** - Verify correct changeset files generated
