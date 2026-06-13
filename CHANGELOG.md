# silk-update-action

## 3.2.0

### Features

* [`a09bff1`](https://github.com/savvy-web/silk-update-action/commit/a09bff17389ebe2a6aa5c459f4441780b4a03364) Two new optional inputs let you control which branches the action operates against. With both unset, behavior is unchanged — the update branch is cut from `main` and the PR targets `main`.

### Bug Fixes

* [`a09bff1`](https://github.com/savvy-web/silk-update-action/commit/a09bff17389ebe2a6aa5c459f4441780b4a03364) `runInstall()` — the lockfile-reconciliation step that runs after pnpm, config dependency, runtime, and regular/peer range updates — now fully regenerates the lockfile instead of patching it. It runs `pnpm clean --lockfile` followed by `pnpm install --frozen-lockfile=false`, replacing the previous `pnpm install --frozen-lockfile=false --fix-lockfile`.

`--fix-lockfile` only repaired broken entries against the existing lockfile and did not re-run resolution under the changed pnpm version, config, and dependency ranges. This could commit an internally inconsistent `pnpm-lock.yaml` — most visibly when an upstream peer range changed (for example, a transitive raising its required `@effect/cluster` peer) and the new required peer was left unfilled, causing a downstream command to fail with `ERR_MODULE_NOT_FOUND`.

Regenerating the lockfile from scratch guarantees the committed `pnpm-lock.yaml` is correct and installable for the resolved pnpm version, config dependencies, and declared ranges.

* Expect larger `pnpm-lock.yaml` diffs in update PRs than before. Because the action obeys declared ranges, lockfile regeneration will advance transitive dependencies within their ranges. This is intentional — the previous behavior was silently suppressing those advancements.
* Requires pnpm 11+ for `pnpm clean`. If your root `package.json` defines a `clean` or `purge` script, pnpm will run that instead of the built-in lockfile cleanup; rename those scripts if they conflict.

### Dependencies

* | [`bd4a09e`](https://github.com/savvy-web/silk-update-action/commit/bd4a09ed693c2b06e84228bc7e88442aa17fb0af) | Dependency    | Type    | Action  | From    | To |
  | :----------------------------------------------------------------------------------------------------------- | :------------ | :------ | :------ | :------ | -- |
  | runtime-resolver                                                                                             | dependency    | updated | ^0.3.12 | ^0.3.13 |    |
  | @savvy-web/silk                                                                                              | devDependency | updated | ^0.5.0  | ^1.0.0  |    |

### `source-branch` and `target-branch` inputs

`source-branch` (default `main`) is the branch the dedicated dependency-update branch is created from and reset to on each run. The pull request targets this branch unless `target-branch` overrides it.

`target-branch` (default empty) is the branch the pull request merges into. Leave it unset to follow `source-branch`; set it only when you want to cut the update from one branch but merge the PR into a different one.

```yaml
- uses: savvy-web/silk-update-action@v3
  with:
    # Cut the update branch from dev, PR into main
    source-branch: dev
    target-branch: main
```

Both refs are validated before the action performs its destructive delete-and-recreate of the update branch. If either ref does not exist, the action fails fast with a clear input error rather than mid-run.

## 3.1.0

### Features

* [`c5e91bb`](https://github.com/savvy-web/silk-update-action/commit/c5e91bb737016f06b5067da87edc71f82ad9e7fd) ### Caret-on-zero regular deps roll forward to the first stable major

Regular dependencies declared with a caret on a pre-1.0 version (`^0.y.z`) now
resolve within a widened range (`>=0.y.z <2.0.0`) instead of the literal caret
range (`0.y.x`). This lets a pre-stable dependency advance across `0.x` minor
lines and adopt the first stable `1.x` release when one is available, rather
than being trapped by npm's caret-on-zero semantics.

All other specifier forms are unchanged: tilde (`~0.y.z`), exact pins (`0.y.z`),
comparator ranges (`>=0.y.z`), and caret deps on `>=1.0.0` versions continue to
resolve within the literal specifier.

```yaml
# package.json (before)
"some-lib": "^0.14.0"   # was trapped in 0.14.x

# package.json (after a run with some-lib@1.2.0 published)
"some-lib": "^1.2.0"    # advanced to latest stable major
```

### Dependencies

* | [`3682f03`](https://github.com/savvy-web/silk-update-action/commit/3682f0354464afeebb3dbf27af7df3287016b3c9) | Dependency    | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------------------- | :------------ | :------ | :----- | :----- | -- |
  | @savvy-web/silk-effects                                                                                      | dependency    | updated | ^1.0.1 | ^1.1.0 |    |
  | @savvy-web/github-action-builder                                                                             | devDependency | updated | ^0.7.7 | ^0.7.8 |    |

## 3.0.1

### Bug Fixes

* [`f59107d`](https://github.com/savvy-web/silk-update-action/commit/f59107da57e11bad2b071eca5c6bd434c991303f) ### Version selection now respects declared semver ranges

Previously, both regular and config dependency updates resolved to npm's absolute `latest` tag, ignoring the specifier declared in `package.json` or `pnpm-workspace.yaml`. This caused caret- and tilde-pinned deps to silently cross major boundaries — for example, a `^4.0.0` entry could be bumped to `5.x`.

Version selection now honors the existing specifier:

* **Regular dependencies** (`dependencies` input): resolves the highest published version satisfying the existing `package.json` specifier. A `^4.0.0` entry stays within `4.x`, a `~3.0.0` entry stays within `3.0.x`, and an exact pin (e.g. `4.0.0`) is left untouched. Prereleases are excluded. An unbounded range such as `>=4.0.0` may still advance across majors, matching its declared intent.

* **Config dependencies** (`config-dependencies` input, hash-pinned entries in `pnpm-workspace.yaml`): resolves within a conservative range derived from the current version's major. A `>=1.0.0` dep stays within its major; a pre-stable dep (`0.x`) may advance to the first stable major but never crosses two majors in one step.

## 3.0.0

### Build System

* [`cd35626`](https://github.com/savvy-web/silk-update-action/commit/cd356264c19248eb7d853f29a21b4bada2aa9216) Upgrades to release workflow v2

## 2.0.1

### Dependencies

* | [`eddac0f`](https://github.com/savvy-web/silk-update-action/commit/eddac0f3d778f3c4d2ed67c3cee15f7219995960) | Dependency    | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------------------- | :------------ | :------ | :----- | :----- | -- |
  | @savvy-web/github-action-effects                                                                             | dependency    | updated | ^2.1.0 | ^2.1.1 |    |
  | @savvy-web/silk-effects                                                                                      | dependency    | updated | ^0.6.0 | ^0.6.1 |    |
  | @savvy-web/github-action-builder                                                                             | devDependency | updated | ^0.7.3 | ^0.7.4 |    |
  | @savvy-web/silk                                                                                              | devDependency | updated | ^0.3.0 | ^0.3.1 |    |
  | @savvy-web/vitest                                                                                            | devDependency | updated | ^1.3.2 | ^1.4.0 |    |

## 2.0.0

### Breaking Changes

* [`acbe9c7`](https://github.com/savvy-web/silk-update-action/commit/acbe9c797f33592f0b90c5a7464c8d7db89669bd) ### Input renamed: `update-pnpm` → `upgrade-package-manager`

The pnpm self-upgrade input has been renamed from `update-pnpm` to `upgrade-package-manager` for consistency with the `upgrade-runtime-*` inputs. The old name is no longer recognized — consumers must rename the input in their workflow files.

```yaml
# Before
- uses: savvy-web/silk-update-action@v3
  with:
    update-pnpm: true

# After
- uses: savvy-web/silk-update-action@v3
  with:
    upgrade-package-manager: true
```

The input accepts `false` | `true` | `auto` | a semver range (default `true`). It currently upgrades pnpm only; support for other package managers is planned.

### Features

* [`acbe9c7`](https://github.com/savvy-web/silk-update-action/commit/acbe9c797f33592f0b90c5a7464c8d7db89669bd) ### Direct-edit pnpm upgrade with hash pinning and range support

`PnpmUpgrade` now edits the root `package.json` `packageManager` and `devEngines.packageManager` fields directly instead of running `corepack use` (which errors when both fields are present). The resolved version is written as a corepack-canonical `version+sha512.<hex>` hash derived from the npm registry integrity, so the committed fields are identical to what `corepack use` would produce.

The input also accepts explicit semver ranges (e.g. `^11`) that may cross majors and can add a `packageManager` field when none exists. `true`/`auto` resolve the latest within the current major, favoring the `devEngines.packageManager` version as the reference. The pnpm upgrade now triggers `pnpm install --fix-lockfile` to activate the new version via corepack reading the updated fields.

### Maintenance

* [`acbe9c7`](https://github.com/savvy-web/silk-update-action/commit/acbe9c797f33592f0b90c5a7464c8d7db89669bd) Action and package renamed from `pnpm-config-dependency-action` to `silk-update-action` to align with the Silk Suite. Update `uses:` references accordingly:

```yaml
# Before
uses: savvy-web/pnpm-config-dependency-action@v1

# After
uses: savvy-web/silk-update-action@v3
```

## 1.1.4

### Dependencies

* | [`fe89d45`](https://github.com/savvy-web/silk-update-action/commit/fe89d4521ca4b92df4910dbf08caf8cbedd02760) | Dependency | Type    | Action  | From    | To |
  | :----------------------------------------------------------------------------------------------------------- | :--------- | :------ | :------ | :------ | -- |
  | runtime-resolver                                                                                             | dependency | updated | ^0.3.10 | ^0.3.11 |    |

## 1.1.3

### Dependencies

* | [`19f5115`](https://github.com/savvy-web/silk-update-action/commit/19f5115f3b26207f57fef2d4e0745cb0978ab570) | Dependency    | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------------------- | :------------ | :------ | :----- | :----- | -- |
  | @savvy-web/github-action-effects                                                                             | dependency    | updated | ^2.0.1 | ^2.0.2 |    |
  | @savvy-web/github-action-builder                                                                             | devDependency | updated | ^0.7.1 | ^0.7.2 |    |

## 1.1.2

### Dependencies

* | [`a07cf34`](https://github.com/savvy-web/silk-update-action/commit/a07cf34b708f0054c13473b504635f511cf333fc) | Dependency    | Type    | Action | From    | To |
  | :----------------------------------------------------------------------------------------------------------- | :------------ | :------ | :----- | :------ | -- |
  | @savvy-web/github-action-effects                                                                             | dependency    | updated | ^2.0.0 | ^2.0.1  |    |
  | @savvy-web/silk-effects                                                                                      | dependency    | updated | ^0.4.1 | ^0.5.0  |    |
  | @savvy-web/commitlint                                                                                        | devDependency | updated | ^0.9.1 | ^0.10.0 |    |
  | @savvy-web/lint-staged                                                                                       | devDependency | updated | ^1.1.0 | ^1.2.0  |    |

## 1.1.1

### Bug Fixes

* [`0626369`](https://github.com/savvy-web/silk-update-action/commit/0626369652e3cd1865793cc87e473a4d40dc5fc0) Stops the action from creating an empty commit and opening a spurious pull request when a `run` command leaves the working tree dirty only by an executable-bit change (for example, husky chmod-ing `.husky` hook scripts during `savvy-commit init`).

- Change detection now runs `git status` with `core.fileMode=false`, so file-mode-only changes are ignored and no longer bypass the no-changes early exit
- This matches what the action actually commits — file content via the GitHub API at mode `100644` — so a mode-only diff can no longer produce an empty commit

## 1.1.0

### Features

* [`3eff0ab`](https://github.com/savvy-web/silk-update-action/commit/3eff0abe855961357470ca61a82a02195adba95a) ### devEngines Runtime Upgrade

Adds optional automatic upgrading of `devEngines.runtime` entries (`node`, `deno`, `bun`) in the root `package.json` via a new `RuntimeUpgrade` service backed by the `runtime-resolver` package.

Four new action inputs control the feature:

| Input                  | Default   | Behavior                                                                                                                                                                                                                                                                                     |
| :--------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upgrade-runtime-node` | `false`   | `false` disables; `auto` bumps within the existing range preserving the operator; a semver range (e.g. `^22`) selects which line to resolve but preserves the existing entry's operator on write (an exact pin stays exact), using the range's own operator only when adding a missing entry |
| `upgrade-runtime-deno` | `false`   | Same semantics as `upgrade-runtime-node`                                                                                                                                                                                                                                                     |
| `upgrade-runtime-bun`  | `false`   | Same semantics as `upgrade-runtime-node`                                                                                                                                                                                                                                                     |
| `runtime-data`         | `offline` | `offline` uses the bundled release cache only; `live` fetches current data with fallback to the bundled cache                                                                                                                                                                                |

Resolution is limited to currently-maintained (non-end-of-life) major lines. `auto` mode is a no-op when the field is a static pin or already current. Runtime bumps appear in the PR body, commit message, and Actions summary but never trigger `pnpm install` and never create a changeset — consistent with how pnpm tooling upgrades are handled.

**Example — bump Node.js within its existing range:**

```yaml
- uses: savvy-web/silk-update-action@v3
  with:
    upgrade-runtime-node: auto
```

**Example — move Node.js to a specific major line with live data:**

```yaml
- uses: savvy-web/silk-update-action@v3
  with:
    upgrade-runtime-node: "^22"
    runtime-data: live
```

### Dependencies

* | [`54aa2b0`](https://github.com/savvy-web/silk-update-action/commit/54aa2b00d0ecc505aa1d78be8153cac722d3a575) | Dependency    | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------------------- | :------------ | :------ | :----- | :----- | -- |
  | @savvy-web/silk-effects                                                                                      | dependency    | updated | ^0.4.0 | ^0.4.1 |    |
  | workspaces-effect                                                                                            | dependency    | updated | ^1.0.0 | ^1.1.0 |    |
  | yaml                                                                                                         | dependency    | updated | ^2.8.3 | ^2.9.0 |    |
  | @savvy-web/lint-staged                                                                                       | devDependency | updated | ^1.0.1 | ^1.1.0 |    |

## 1.0.0

### Breaking Changes

* [`1410542`](https://github.com/savvy-web/silk-update-action/commit/1410542223c745e1ddadf03927d562552beb17f4) The `app-id` input has been renamed to `app-client-id`. Update your workflow's `with:` block when upgrading.

### Features

* [`1410542`](https://github.com/savvy-web/silk-update-action/commit/1410542223c745e1ddadf03927d562552beb17f4) Migrate to `@savvy-web/github-action-effects` 2.0 and `workspaces-effect` 1.0, adopting a three-phase (pre/main/post) GitHub App token lifecycle. The installation token is provisioned in a pre step — with up-front verification that the App grants `contents`, `pull-requests`, and `checks` write — and revoked in a post step via the `GitHubToken` namespace, replacing the previous in-process token bridge. A new optional `skip-token-revoke` input skips revocation in the post step (tokens expire after 1 hour regardless).

Adopt `@savvy-web/silk-effects` for publishability detection, replacing the action's local copy of the silk rules. Changeset creation now honors `.changeset/config.json` `ignore`: a package listed there is never given a changeset, even when `privatePackages.version` is enabled.

## 0.12.1

### Bug Fixes

* [`66ebacd`](https://github.com/savvy-web/silk-update-action/commit/66ebacd92c126eb454b45f26a7d5dada28955933) ### Match dependencies across all writable sections

The `dependencies` input now matches against `dependencies`,
`devDependencies`, and `optionalDependencies` of each workspace
package's `package.json`. Previously, only `devDependencies` were
scanned, so deps declared in `dependencies` (e.g. a runtime dep of a
publishable package) or `optionalDependencies` were silently skipped
even when they matched a configured pattern.

`peerDependencies` remain intentionally excluded — peer ranges are
managed by the `peer-lock` and `peer-minor` inputs via `syncPeers`.

A dependency that appears in more than one section of the same
package (e.g. both `dependencies` and `devDependencies`) is now
updated in every section it appears in, with one update record per
section.

### Refactoring

* [`66ebacd`](https://github.com/savvy-web/silk-update-action/commit/66ebacd92c126eb454b45f26a7d5dada28955933) Removed the local `Workspaces` service wrapper now that
  `workspaces-effect@0.5.1` exposes `WorkspaceDiscovery.listPackages(cwd)`
  and `WorkspaceDiscovery.importerMap(cwd)` upstream. Domain services
  yield `WorkspaceDiscovery` directly; `makeAppLayer` wires
  `WorkspaceDiscoveryLive` and `WorkspaceRootLive` with `NodeContext.layer`.
  No user-facing API changes.

### Accurate dependency type reporting

`DependencyUpdateResult.type` now reflects the actual section a dep
was found in (`dependency` / `devDependency` / `optionalDependency`)
instead of always reporting `devDependency`. `Changesets.create`
routes these by `update.type`: `dependency` and `optionalDependency`
trigger changeset emission for the affected workspace package, and
`devDependency` remains informational only. Catalog-resolved peer
changes and peer-sync rewrites continue to trigger as before.

## 0.12.0

### Features

* [`d06ac37`](https://github.com/savvy-web/silk-update-action/commit/d06ac37f48542eb67b8de34082419ffdbeb8eb5c) ### Versionable + trigger-driven changeset emission

Changesets now follow precise rules:

* A workspace package gets a changeset only if it is **versionable** (publishable per silk or vanilla mode rules, OR non-publishable with `privatePackages.version: true` in `.changeset/config.json`).
* A versionable package gets a changeset only when at least one **trigger** fires for it: a `dependencies` / `optionalDependencies` / `peerDependencies` specifier change in its own `package.json`, a peer-sync rewrite of one of its peers, or a non-dev catalog reference resolving to a different version after the run.
* `devDependencies`-only changes never produce a changeset (they appear in the table only when a changeset is being written for other reasons).
* Empty changesets are no longer emitted.

### Bug Fixes

* [`d06ac37`](https://github.com/savvy-web/silk-update-action/commit/d06ac37f48542eb67b8de34082419ffdbeb8eb5c) ### Catalog consumer detection on pnpm v9 lockfiles

`findCatalogConsumers` in the lockfile service now reads catalog specifiers from the importer's flat `specifiers` map (the pnpm v9 lockfile shape) instead of incorrectly looking for a `.specifier` property on the per-dep value (which is just a version string). Previously, catalog changes never surfaced as triggers because consumers were never matched. Catalog reference changes consumed in `dependencies`, `optionalDependencies`, or `peerDependencies` now correctly trigger changesets for the consuming workspace.

* [`ef5b742`](https://github.com/savvy-web/silk-update-action/commit/ef5b7420ca76d66232a1f910622983acfe9cfd41) ### Root-package name resolution

The action now correctly resolves the root workspace package's name when emitting changesets. Previously, dependency changes affecting the root would produce a changeset with the literal frontmatter key `"."` instead of the root's actual `name` field from `package.json`. The root cause was the underlying `workspace-tools` dependency excluding the root package from its package list; replaced with `workspaces-effect` which always includes the root.

* [`cadb1df`](https://github.com/savvy-web/silk-update-action/commit/cadb1dfc766d0112a611ddd80f2766f8ef1e3080) ### Preserve transitive dependencies during install

The action's lockfile-refresh step previously deleted `node_modules` and `pnpm-lock.yaml` before running `pnpm install`, forcing a from-scratch resolve. This had the side effect of bumping transitive dependencies for packages the action was not asked to touch — every run could quietly move unrelated transitives forward to whatever the registry currently resolved them to.

* [`ef5b742`](https://github.com/savvy-web/silk-update-action/commit/ef5b7420ca76d66232a1f910622983acfe9cfd41) Replace `workspace-tools` with `workspaces-effect` for workspace discovery and package metadata, via a new `Workspaces` domain service in `src/services/`.
* Add integration test infrastructure under `__test__/integration/` with two committed mock-workspace fixtures (`single-package-private-root` and `multi-package-public-root`).

The step now runs `pnpm install --frozen-lockfile=false --fix-lockfile` instead. The new command reconciles the lockfile against the just-modified `package.json` and `pnpm-workspace.yaml` files and installs `node_modules` to match, touching only the directly-bumped specifiers and their strict transitives. Unrelated transitives stay at their currently-pinned versions.

The `--frozen-lockfile=false` flag is required because pnpm auto-enables `--frozen-lockfile` in CI (`CI=true` is always set in GitHub Actions), which would otherwise refuse to write the lockfile changes the action just made.

### Maintenance

* [`ef5b742`](https://github.com/savvy-web/silk-update-action/commit/ef5b7420ca76d66232a1f910622983acfe9cfd41) Replace `workspace-tools` with `workspaces-effect` for workspace discovery and package metadata, via a new `Workspaces` domain service in `src/services/`.
* Add integration test infrastructure under `__test__/integration/` with two committed mock-workspace fixtures (`single-package-private-root` and `multi-package-public-root`).

### Per-importer per-section catalog change records

`compareCatalogs` now emits one `LockfileChange` per `(catalog change, consuming importer, dep section)` triple instead of a single aggregated record. Each record carries the accurate `type` field, so changes consumed only in `devDependencies` no longer incorrectly produce changesets for those workspaces.

## 0.11.2

### Other

* [`f7c001d`](https://github.com/savvy-web/silk-update-action/commit/f7c001dd755f341d0210f3bf79623bdad1eec9e5) Upgrades internals for distribution

## 0.11.1

### Bug Fixes

* [`34dbb1f`](https://github.com/savvy-web/silk-update-action/commit/34dbb1f9d4d805e33a485a4da6fb800d4695097e) Pins workspace-tools to 0.41.0 due to breaking upstream issue.

### Dependencies

* | [`1ece353`](https://github.com/savvy-web/silk-update-action/commit/1ece3531032449542e86fc8cb074c3919a9e768b) | Dependency    | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------------------- | :------------ | :------ | :----- | :----- | -- |
  | @savvy-web/commitlint                                                                                        | devDependency | updated | ^0.4.1 | ^0.4.3 |    |
  | @savvy-web/lint-staged                                                                                       | devDependency | updated | ^0.6.2 | ^0.6.4 |    |

## 0.11.0

### Features

* [`4798d16`](https://github.com/savvy-web/silk-update-action/commit/4798d163ba9f2b99550a3412b78b8a0e67f5e92d) Add granular peer dependency sync with `peer-lock` and `peer-minor` inputs.

- `peer-lock`: Sync peerDependency range on every devDependency version bump
- `peer-minor`: Sync peerDependency range only on minor+ bumps (floor patch to .0)
- Narrow `dependencies` input to match `devDependencies` only
- Fix changeset table `Type` column to use specific values (`devDependency`, `peerDependency`, `dependency`, `config`)
- Changesets only trigger on consumer-facing changes (peer range or runtime dependency changes), not devDependency-only updates
- PR body uses per-package tables with Dependency/Type/Action/From/To columns

## 0.10.0

### Features

* [`d7c18a6`](https://github.com/savvy-web/silk-update-action/commit/d7c18a6b5f741b526d7048b37815d5543024816d) Migrate to @savvy-web/github-action-effects v0.11 API, replacing legacy
  `@actions/*` imports and `Action.parseInputs()` with the modern library API.

- Use Effect's `Config.*` API for typed input parsing
- Use `ActionEnvironment` for GitHub context (SHA, repository)
- Use `Redacted` for secure private key handling
- Separate program logic from entry point for clean test imports
- Wire `OctokitAuthAppLive` and `GitHubClientLive` layers for GitHub App auth

## 0.9.0

### Features

* [`14da150`](https://github.com/savvy-web/silk-update-action/commit/14da150ca9e12d8dea62d65c2f9faf7221c0683e) Changeset summaries now use the structured GFM dependency table format from `@savvy-web/changesets`. The `## Dependencies` section renders a five-column table (Dependency, Type, Action, From, To) instead of bullet lists with arrows.

## 0.8.1

### Bug Fixes

* [`17d8b35`](https://github.com/savvy-web/silk-update-action/commit/17d8b358c23b3c2775a52d31f5195b3fc7709ad0) Add `log-level` action input using the standard `@savvy-web/github-action-effects` log-level setup with `auto`, `info`, `verbose`, and `debug` levels

## 0.8.0

### Breaking Changes

* [`035cae1`](https://github.com/savvy-web/silk-update-action/commit/035cae1369b48cc1b3c9151637dbd7ee5902b215) Collapse three-phase execution (pre/main/post) into single-phase architecture
* Remove `skip-token-revoke` and `log-level` inputs from action.yml
* Remove `token` output from action.yml

### Features

* [`035cae1`](https://github.com/savvy-web/silk-update-action/commit/035cae1369b48cc1b3c9151637dbd7ee5902b215) Upgrade @savvy-web/github-action-effects from v0.3.0 to v0.4.0
* Use `GitHubApp.withToken()` bracket pattern for automatic token lifecycle management
* Use `CheckRun.withCheckRun()` bracket pattern for check run lifecycle
* Use `Action.parseInputs()` for declarative, Schema-based input parsing
* Replace custom services (GitHubClient, GitExecutor, PnpmExecutor) with library equivalents (CommandRunner, GitBranch, GitCommit, GitHubClient)
* Use `AutoMerge.enable()` from library for auto-merge support

## 0.7.1

### Dependencies

* [`b538fde`](https://github.com/savvy-web/silk-update-action/commit/b538fde5724a8de53f5e509163f58cfe424b5f3e) @savvy-web/changesets: ^0.1.1 → ^0.4.1
* @savvy-web/commitlint: ^0.3.3 → ^0.4.0
* @savvy-web/github-action-builder: ^0.1.4 → ^0.2.0
* @savvy-web/lint-staged: ^0.4.5 → ^0.5.0
* @savvy-web/vitest: ^0.1.0 → ^0.2.0

## 0.7.0

### Features

* [`babbee1`](https://github.com/savvy-web/silk-update-action/commit/babbee17435d86dbd7f652cffee07e3f088105e4) Replace `pnpm add --config` with direct npm registry queries and YAML editing for config dependency updates, avoiding catalog promotion when `catalogMode: strict` is enabled

## 0.6.0

### Minor Changes

* [`ec30b5a`](https://github.com/savvy-web/silk-update-action/commit/ec30b5a96bcf93602b850d32344f2c0c4a69e2b4) Replace `pnpm up --latest` with direct npm queries for regular dependency updates to avoid promoting dependencies to catalogs when `catalogMode: strict` is enabled

## 0.5.1

### Bug Fixes

* [`c223a90`](https://github.com/savvy-web/silk-update-action/commit/c223a9077669478c82f4c7783cf51cca35cb6f45) Supports @savvy-web/vitest

## 0.5.0

### Bug Fixes

* [`e36fba1`](https://github.com/savvy-web/silk-update-action/commit/e36fba14758a90bd7b98d83b842170d7151f695b) Fix missing dependency detection for catalog resolved version changes.

When a clean install resolves a newer version within the same semver range (e.g., `^2.8.4` stays unchanged but resolves `2.8.6` to `2.8.7`), the action now correctly detects and reports the change. Previously, `compareCatalogs()` only compared the `specifier` field of catalog entries, ignoring the `version` (resolved) field. This caused changes that stayed within the declared semver range to fall through both the catalog and importer comparison paths undetected, resulting in 0 reported changes and an empty PR body.

The fix compares both `specifier` and `version` fields of `ResolvedCatalogEntry`. When only the resolved version changed, the reported from/to values use the concrete resolved versions (e.g., `2.8.6` to `2.8.7`). When the specifier itself changed, existing behavior is preserved (e.g., `^2.8.4` to `^2.9.0`).

## 0.4.0

### Minor Changes

* 85f1c06: Add `changesets` input option (default: `true`) to control whether changesets are created during dependency updates. When set to `false`, the action skips changeset creation, which is useful for repos that don't need the release cycle and just want a dependency update PR.

## 0.3.0

### Minor Changes

* 127b7b6: Add auto-merge support for dependency update PRs. A new `auto-merge` input
  accepts `merge`, `squash`, or `rebase` to enable GitHub's auto-merge via the
  GraphQL API after PR creation. Failures are handled gracefully with a warning
  log, requiring repository-level "Allow auto-merge" and branch protection to
  be configured.

## 0.2.0

### Minor Changes

* eec6269: Add pnpm self-upgrade step that detects pnpm versions from `packageManager` and `devEngines.packageManager` fields in root `package.json`, resolves the latest version within the `^` semver range, and upgrades via `corepack use`. Controlled by the new `update-pnpm` input (default: `true`). The upgrade runs before config dependency updates and is reported alongside them in the PR body.

## 0.1.0

### Minor Changes

* 826309a: Initial release of the Silk Update Action.

  A GitHub Action that automates updates to pnpm config dependencies and regular
  dependencies, filling the gap left by Dependabot's lack of support for pnpm's
  `configDependencies` feature in `pnpm-workspace.yaml`.

  ### Features

  * **Config dependency updates**: Updates config dependencies via `pnpm add --config`,
    tracking version changes with before/after comparison
  * **Regular dependency updates**: Updates regular dependencies via `pnpm up --latest`
    with glob pattern support (e.g., `effect`, `@effect/*`, `@savvy-web/*`)
  * **Custom post-update commands**: Execute commands after dependency updates via the
    `run` input (e.g., `pnpm lint:fix`, `pnpm test`). All commands run sequentially;
    if any fail, the job fails and no PR is created
  * **Changeset integration**: Automatically creates patch changesets for affected
    packages, with empty changesets for root workspace config dependency updates
  * **Verified commits**: Creates signed/verified commits via the GitHub API using
    GitHub App authentication (no SSH or GPG keys required)
  * **Branch management**: Manages a dedicated update branch with automatic creation
    or reset to the default branch on each run
  * **Lockfile diffing**: Compares `pnpm-lock.yaml` snapshots before and after updates
    to detect actual dependency changes, including catalog entry tracing to identify
    affected workspace packages
  * **Detailed PR summaries**: Generates Dependabot-style PR descriptions with
    dependency tables, npm links, and per-package changeset details
  * **GitHub App authentication**: Uses short-lived installation tokens with
    fine-grained permissions for secure automation
  * **Check run integration**: Creates GitHub check runs for visibility into action
    progress and results
  * **Dry-run mode**: Detect changes without committing, pushing, or creating PRs
  * **Debug logging**: Configurable log levels for troubleshooting

  ### Architecture

  Built with Effect-TS for typed error handling, retry logic, and service-based
  dependency injection. Uses a three-phase execution model (pre/main/post) with
  13 orchestration steps in the main phase.
