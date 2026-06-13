# Configuration

Complete reference for all action inputs, outputs and usage patterns.

## Table of contents

- [Inputs](#inputs)
- [Outputs](#outputs)
- [Authentication](#authentication)
- [Dependency selection](#dependency-selection)
- [Post-update commands](#post-update-commands)
- [Branch management](#branch-management)
- [Changeset integration](#changeset-integration)
- [Advanced patterns](#advanced-patterns)

## Inputs

### Required inputs

#### `app-client-id`

The client ID of your GitHub App. Found on the GitHub App settings page. This is the App's client ID, not its numeric App ID.

#### `app-private-key`

The private key for your GitHub App in PEM format. Generate this from the GitHub
App settings page and store it as a repository secret.

### Optional inputs

#### `config-dependencies`

Config dependencies to update, one per line. These correspond to entries in your
`pnpm-workspace.yaml` `configDependencies` section. Each line must be an exact
package name (no glob patterns).

```yaml
config-dependencies: |
  typescript
  @biomejs/biome
```

#### `dependencies`

Workspace dependencies to update, one per line. Matches against the
`dependencies`, `devDependencies` and `optionalDependencies` fields in all
workspace `package.json` files. Supports glob patterns.

```yaml
dependencies: |
  vitest
  @savvy-web/*
```

`peerDependencies` are intentionally not matched here — peer ranges are
managed by the [`peer-lock`](#peer-lock) and [`peer-minor`](#peer-minor) inputs
instead.

If a package lists the same dependency in multiple sections (for example, both
`dependencies` and `devDependencies`), each section is updated independently
and reported as a separate row in the PR summary.

At least one of `config-dependencies`, `dependencies`, a non-`false`
`upgrade-package-manager`, or an `upgrade-runtime-*` input must be active.

#### `peer-lock`

Package names whose `peerDependencies` range syncs on every version bump (patch
and minor). Must be explicit package names (no globs). Each package must also
match a `dependencies` pattern.

```yaml
peer-lock: |
  vitest-agent-reporter
```

When `vitest-agent-reporter` updates from `1.0.0` to `1.0.3`, the peer range
updates from `^1.0.0` to `^1.0.3`. The existing prefix (`^`, `~`, `>=`, etc.)
is preserved.

#### `peer-minor`

Package names whose `peerDependencies` range syncs only on minor or major
version bumps. Patch-only bumps leave the peer range unchanged. Must be explicit
package names (no globs). Each package must also match a `dependencies` pattern.

```yaml
peer-minor: |
  vitest
  @vitest/coverage-v8
```

When `vitest` updates from `3.1.0` to `3.2.5`, the peer range updates to
`^3.2.0` (patch floored to `.0`). When `vitest` updates from `3.1.0` to
`3.1.2`, the peer range stays at `^3.1.0`.

**Validation:**

- A package cannot appear in both `peer-lock` and `peer-minor` (the action
  fails with an error)
- If a `peer-lock` or `peer-minor` entry does not match any `dependencies`
  pattern, a warning is logged

#### `branch`

The branch name used for the dependency update PR. Default: `pnpm/config-deps`.

The action creates this branch from `main` if it does not exist, or resets it to
`main` before applying updates.

```yaml
branch: deps/weekly-update
```

#### `run`

Shell commands to run after dependency updates, one per line. All commands are
executed sequentially. If any command fails, the action stops and does not create
a PR.

```yaml
run: |
  pnpm lint:fix
  pnpm test
  pnpm build
```

#### `upgrade-package-manager`

Upgrades the project's package manager declared in the `packageManager` and
`devEngines.packageManager` fields of the root `package.json`. **Currently
supports pnpm only** — support for other package managers is planned. Values:
`false` (skip), `true`/`auto` (latest within the current major, favoring the
`devEngines` version), or a semver range (e.g. `^11`, which may cross majors and
adds a `packageManager` field when none exists). The version change is tracked
as a config dependency update. Default: `true`.

```yaml
upgrade-package-manager: false # Disable automatic package-manager upgrades
```

#### `upgrade-runtime-node`

Upgrade the Node.js entry in `devEngines.runtime`. Three modes:

- `false` (default) — skip; Node.js runtime is not touched
- `auto` — resolve the latest version within the existing entry's range and
  re-decorate with its operator; no-op if the entry is a static exact pin, if
  no entry exists, or if the resolved version already matches the current value;
  never adds a missing entry
- A semver range (e.g. `^22`) — resolve the latest version satisfying the given
  range, then write it back **preserving the existing entry's operator** (an
  exact pin like `24.11.0` stays exact, a caret stays caret) regardless of the
  operator in the range you pass — the range only selects which line to move to.
  Adds a new entry if one is missing, using the range's own operator in that case

```yaml
upgrade-runtime-node: auto
```

> **EOL note:** Version resolution only covers currently-maintained (non
> end-of-life) major lines. If the existing entry or an explicit range targets
> an EOL line (e.g. `^20` after Node 20 reaches EOL), resolution fails and the
> runtime bump is skipped with a warning. This applies to both offline and live
> data sources.

#### `upgrade-runtime-deno`

Upgrade the Deno entry in `devEngines.runtime`. Accepts the same values as
`upgrade-runtime-node` (`false`, `auto`, or a semver range such as `^2`).
Default: `false`.

```yaml
upgrade-runtime-deno: auto
```

#### `upgrade-runtime-bun`

Upgrade the Bun entry in `devEngines.runtime`. Accepts the same values as
`upgrade-runtime-node` (`false`, `auto`, or a semver range such as `^1`).
Default: `false`.

```yaml
upgrade-runtime-bun: ^1
```

#### `runtime-data`

Data source used by the runtime version resolver. Default: `offline`.

- `offline` — use only the bundled `runtime-resolver` cache; no network access
  or authentication required
- `live` — fetch the latest runtime data from the network, falling back to the
  bundled cache on failure

```yaml
runtime-data: live
```

**Example — auto-upgrade Node.js and Deno using the existing ranges:**

If your root `package.json` contains:

```json
{
  "devEngines": {
    "runtime": [
      { "name": "node", "version": "^24.0.0", "onFail": "ignore" },
      { "name": "deno", "version": "^2.0.0", "onFail": "ignore" }
    ]
  }
}
```

With this configuration:

```yaml
upgrade-runtime-node: auto
upgrade-runtime-deno: auto
```

The action resolves the latest Node.js `^24` and Deno `^2` versions (within
maintained lines) and rewrites the `version` fields to e.g. `^24.16.0` and
`^2.1.0`, preserving the `^` operator and the `onFail` field. The bump is
included in the PR summary and commit message. It does not trigger a changeset
and does not run `pnpm install`.

#### `changesets`

When set to `true` and a `.changeset/` directory exists, the action creates
changesets for affected packages after dependency updates. Set to `false` to
skip changeset creation entirely, which is useful for repositories that do not
use the changeset release workflow. Default: `true`.

```yaml
changesets: false # Skip changeset creation
```

#### `dry-run`

When set to `true`, the action detects changes and reports them in the GitHub
Actions summary but does not commit, push or create a PR. Useful for testing
configuration. Default: `false`.

#### `log-level`

Controls logging verbosity. Default: `auto`.

- `auto` — debug when `ACTIONS_STEP_DEBUG` is enabled, info otherwise
- `info` — buffered outcome summaries only
- `verbose` — unbuffered operation milestones
- `debug` — full command output and internal state (lockfile structure, git status, parsed inputs)

#### `auto-merge`

Enables GitHub's auto-merge on the dependency update PR after it is created.
Accepted values are `merge`, `squash` and `rebase`, matching the merge
strategy. Leave empty (the default) to disable auto-merge.

**Prerequisites:**

- The repository must have "Allow auto-merge" enabled in **Settings > General**
- Branch protection rules with required status checks must be configured on the
  base branch

If auto-merge cannot be enabled (e.g. missing prerequisites), the action logs a
warning and continues — it does not fail the workflow.

```yaml
auto-merge: squash # Enable auto-merge with squash strategy
```

## Outputs

### `pr-number`

The pull request number, if a PR was created or updated. Empty if no PR was
created (no changes detected, or dry-run mode).

### `pr-url`

The pull request URL. Empty if no PR was created.

### `updates-count`

The number of dependencies that were updated (string).

### `has-changes`

Whether any dependency changes were detected (`"true"` or `"false"`).

### Using outputs

```yaml
- uses: savvy-web/silk-update-action@v3
  id: update-deps
  with:
    app-client-id: ${{ vars.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
    config-dependencies: |
      typescript

- name: Comment on PR
  if: steps.update-deps.outputs.has-changes == 'true'
  run: |
    echo "PR created: ${{ steps.update-deps.outputs.pr-url }}"
    echo "Updates: ${{ steps.update-deps.outputs.updates-count }}"
```

## Authentication

The action authenticates as a GitHub App, and the token's lifecycle spans the three phases. The pre phase exchanges the App credentials for a short-lived installation token. The main phase uses that token for every GitHub API call. The post phase revokes it.

The token is masked in workflow logs, so it does not appear in build output even when a step echoes its environment.

## Dependency selection

### Config dependencies

[Config dependencies](https://pnpm.io/config-dependencies) are declared in
`pnpm-workspace.yaml` and provide workspace-level tooling. They are hash-pinned
with no explicit range, so the action upgrades each one within a conservative
range derived from its current major. A config dependency at `>=1.0.0` stays
within its current major; one below `1.0.0` may advance across the `0.x` line
and adopt the first stable major (`1.x`), but never crosses two majors at once.
The action edits the `configDependencies` entry in `pnpm-workspace.yaml` in
place, which avoids the catalog promotion that `pnpm add --config` would
introduce.

```yaml
# pnpm-workspace.yaml
configDependencies:
  typescript: 5.4.0
  "@biomejs/biome": 1.6.1
```

### Workspace dependencies

Workspace dependencies are matched against the `dependencies`,
`devDependencies` and `optionalDependencies` fields in all `package.json`
files. `peerDependencies` are intentionally excluded — peer ranges are
managed by the `peer-lock` and `peer-minor` inputs.

The action resolves each dependency within the semver range already declared in
`package.json`, rather than jumping to npm's absolute latest. A `^4.0.0`
specifier resolves to the highest `4.x` and will not cross to `5.x`; a `~3.0.0`
specifier stays within `3.0.x`; a wider range like `>=4.0.0` may advance across
a major. An exact pin (e.g. `4.0.0`, no operator) is a single-version range and
is left untouched. A caret on a pre-1.0 version is the one exception to plain
caret semantics: `^0.5.2` rolls forward across the `0.x` line and adopts the
first stable `1.x` (resolving within `>=0.5.2 <2.0.0`) rather than being trapped
in `0.5.x` by npm's caret-on-zero rule, mirroring how config dependencies advance
out of `0.x`. A tilde on a pre-1.0 version is unaffected. Prereleases are excluded. Querying the npm registry directly
this way also avoids `pnpm up --latest`, which promotes deps to catalogs when
`catalogMode: strict` is enabled. Glob patterns follow Node's `path.matchesGlob`:

| Pattern | Matches |
| --- | --- |
| `vitest` | Exact package `vitest` |
| `@effect/*` | All packages in the `@effect` scope |
| `@savvy-web/*` | All packages in the `@savvy-web` scope |

### Peer dependency syncing

Peer dependency ranges can be automatically synced when the corresponding
workspace dependency updates. This is controlled by the `peer-lock` and
`peer-minor` inputs.

Published packages list peer dependencies to declare compatibility. When you update a dependency like `vitest`, the peer range should reflect the version you tested against. A `devDependency` change alone does not warrant a release, since dev dependencies are stripped from published packages — but a peer range change is consumer-facing and produces a patch changeset.

**Strategies:**

| Strategy | Behavior | Example |
| --- | --- | --- |
| `peer-lock` | Sync on every bump | `1.0.0` to `1.0.3` updates peer to `^1.0.3` |
| `peer-minor` | Sync on minor+ only | `3.1.0` to `3.1.2` leaves peer at `^3.1.0`; `3.1.0` to `3.2.0` updates to `^3.2.0` |

Version resolution follows semver naturally. If the workspace dependency
specifier is `^3.1.0`, the action resolves the highest version satisfying that
range — the highest `3.x`, never crossing into `4.x`. The peer range then syncs
to the resolved version per the chosen strategy.

## Post-update commands

Commands specified in the `run` input execute after all dependency updates and
`pnpm install`. Use them to fix formatting, run tests or rebuild.

- Commands run sequentially in the order listed
- All commands are attempted even if earlier ones fail
- If any command fails, the action reports the failure, updates the check run with an error status and exits without creating a PR
- Commands are executed via `sh -c`, so shell features are available

## Branch management

The action manages a dedicated branch for dependency updates:

1. If the branch does not exist, it is created from `main`
2. If the branch exists, it is deleted and recreated from `main` to ensure a
   clean state
3. Changes are committed via the GitHub API (not `git commit`) to produce
   verified/signed commits
4. The branch ref is updated directly using the Git Data API

This approach ensures the PR always shows a clean diff against `main` with only
the dependency changes.

## Changeset integration

If your repository has a `.changeset/` directory and the `changesets` input is
`true` (the default), the action creates changesets based on consumer-facing
changes. A workspace package gets a `patch` changeset only when **both** gates
pass:

1. **Trigger gate** — at least one consumer-facing change must apply to the
   package:
   - `peerDependency` range update (from `peer-lock` or `peer-minor` syncing)
   - `dependency` or `optionalDependency` change detected in the lockfile

   `devDependency`-only changes are informational rows in the changeset table
   when a sibling trigger exists, but never trigger a changeset on their own
   (dev dependencies are stripped from published packages).

   `devEngines.runtime` upgrades (from `upgrade-runtime-*`) and package-manager
   self-upgrades (from `upgrade-package-manager`) are tooling-level changes that appear in the PR summary
   and commit message but never create a changeset and never run `pnpm install`.

2. **Versionable gate** — the package must be versionable:
   - **Publishable** packages (detected by `workspaces-effect`'s
     `PublishabilityDetector` — non-private, or with a `publishConfig`
     targeting a registry), or
   - Private packages opted in via the `versionPrivate` changeset config

   Private packages that are not versionable are skipped silently.

Changeset tables include all changes for a package — both triggers and
informational dev rows — using specific type values: `dependency`,
`optionalDependency`, `peerDependency`, `devDependency`. Empty changesets are
not written; config-only updates (`pnpm-workspace.yaml` `configDependencies`)
do not produce a changeset.

## Advanced patterns

### Separate config and regular updates

Run the action twice in the same workflow with different branches:

```yaml
- uses: savvy-web/silk-update-action@v3
  with:
    app-client-id: ${{ vars.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
    branch: deps/config
    config-dependencies: |
      typescript
      @biomejs/biome

- uses: savvy-web/silk-update-action@v3
  with:
    app-client-id: ${{ vars.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
    branch: deps/regular
    dependencies: |
      effect
      @effect/*
```

### Auto-merge with squash

Automatically merge the dependency PR once status checks pass:

```yaml
- uses: savvy-web/silk-update-action@v3
  with:
    app-client-id: ${{ vars.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
    config-dependencies: |
      typescript
    auto-merge: squash
```

### Conditional updates

Use outputs to gate subsequent steps:

```yaml
- uses: savvy-web/silk-update-action@v3
  id: deps
  with:
    app-client-id: ${{ vars.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
    dependencies: |
      effect

- name: Notify Slack
  if: steps.deps.outputs.has-changes == 'true'
  uses: slackapi/slack-github-action@v2
  with:
    payload: |
      {"text": "Dependency PR created: ${{ steps.deps.outputs.pr-url }}"}
```
