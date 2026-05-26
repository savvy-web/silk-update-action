# Execution phases

The action runs as three phases — `pre`, `main` and `post` — declared in its `action.yml` under `runs:`. The pre phase provisions the GitHub App token, the main phase does the dependency-update work and the post phase reports duration and revokes the token. This document walks through each phase in order.

## Table of contents

- [Pre phase](#pre-phase)
- [Main phase](#main-phase)
  - [Parse inputs](#parse-inputs)
  - [Branch management](#branch-management)
  - [Capture lockfile state (before)](#capture-lockfile-state-before)
  - [Upgrade pnpm](#upgrade-pnpm)
  - [Upgrade runtimes](#upgrade-runtimes)
  - [Update config dependencies](#update-config-dependencies)
  - [Update workspace dependencies](#update-workspace-dependencies)
  - [Sync peer dependencies](#sync-peer-dependencies)
  - [Reconcile lockfile and install](#reconcile-lockfile-and-install)
  - [Format pnpm-workspace.yaml](#format-pnpm-workspaceyaml)
  - [Run custom commands](#run-custom-commands)
  - [Capture lockfile state (after)](#capture-lockfile-state-after)
  - [Detect changes](#detect-changes)
  - [Create changesets](#create-changesets)
  - [Commit and push](#commit-and-push)
  - [Create or update PR](#create-or-update-pr)
- [Post phase](#post-phase)

## Pre phase

The pre phase provisions the GitHub App installation token before any updates run.

- Reads the `app-client-id` and `app-private-key` inputs and mints an installation token for the App
- Runs a fail-fast permission check against the scopes the action needs (`contents: write`, `pull-requests: write` and `checks: write`). A missing scope fails the run here, in the pre phase, rather than partway through the main phase
- Records a start time so the post phase can report total duration
- Persists the token to cross-phase state so the main phase can read it back

## Main phase

The main phase reads the token the pre phase provisioned and runs the dependency-update workflow. The steps below run in order, and steps tied to an absent input are skipped.

### Parse inputs

- Parses and validates all action inputs
- Validates that at least one update type is active — `config-dependencies`, `dependencies`, `update-pnpm` or an `upgrade-runtime-*` input
- Validates that `peer-lock` and `peer-minor` do not list the same package
- Warns if a `peer-lock` or `peer-minor` entry does not match any `dependencies` pattern
- Creates a GitHub check run for status visibility in the UI

### Branch management

- Checks whether the update branch already exists
- If the branch does not exist, creates it from the default branch using the GitHub API, then fetches and checks it out locally
- If the branch exists, deletes it and recreates it from the default branch to ensure a clean baseline
- This reset strategy guarantees the PR always shows only the dependency changes against the current default branch

### Capture lockfile state (before)

- Reads the current `pnpm-lock.yaml`
- Stores the lockfile in memory for later comparison

### Upgrade pnpm

- Runs when the `update-pnpm` input is `true` (the default)
- Detects the current pnpm version from `packageManager` in `package.json`
- Checks for the latest available pnpm version within range
- Updates the `packageManager` and `devEngines` fields when a newer version is available
- Records the version change for the PR summary and commit message; it does not create a changeset

### Upgrade runtimes

- Runs when any of `upgrade-runtime-node`, `upgrade-runtime-deno` or `upgrade-runtime-bun` is set to `auto` or a semver range
- Resolves the latest version for the matching `devEngines.runtime` entry and rewrites its `version`, preserving the entry's operator
- Uses the `runtime-data` source — `offline` reads the bundled cache, `live` fetches the latest data and falls back to the cache on failure
- Resolution covers only currently-maintained major lines; a request targeting an end-of-life line is skipped with a warning
- Like a pnpm self-upgrade, a runtime bump appears in the PR summary and commit message but never creates a changeset and never triggers `pnpm install`

### Update config dependencies

- Iterates over each config dependency listed in the `config-dependencies` input
- Queries the npm registry directly for the latest version and edits the `configDependencies` entry in `pnpm-workspace.yaml` in place
- Editing in place avoids `pnpm add --config`, which would promote the dependency into a catalog
- Uses error accumulation: if one dependency fails to update, the others still proceed, and failures are logged as warnings

### Update workspace dependencies

- Iterates over each dependency pattern in the `dependencies` input
- Matches against `dependencies`, `devDependencies` and `optionalDependencies` in every workspace `package.json` (`peerDependencies` are excluded — those are managed by `peer-lock` and `peer-minor`)
- A dependency listed in multiple sections of one `package.json` is updated in each section independently and produces one update record per section
- Queries the npm registry directly for latest versions, which avoids `pnpm up --latest` promoting dependencies into catalogs when `catalogMode: strict` is enabled
- Supports glob patterns such as `@savvy-web/*`
- Uses error accumulation: individual failures do not block other updates

### Sync peer dependencies

- For each workspace dependency update matching a `peer-lock` or `peer-minor` entry, finds the corresponding `peerDependencies` range, computes the new range and writes the updated `package.json`
- `peer-lock` syncs the peer range on every version bump
- `peer-minor` syncs the peer range only on minor or major bumps and floors the patch to `.0`
- Preserves the existing prefix (`^`, `~`, `>=` and so on)
- Skips with a warning when no peer entry exists for the package

### Reconcile lockfile and install

- Runs only when there are config dependencies, regular dependencies or peer-sync rewrites to process
- Runs `pnpm install --frozen-lockfile=false --fix-lockfile`: `--frozen-lockfile=false` opts out of CI's default refusal to write lockfile changes, and `--fix-lockfile` reconciles the lockfile against the modified manifests while leaving unrelated transitives at their pinned versions
- Avoids deleting `node_modules` or `pnpm-lock.yaml`, which keeps installs fast and keeps unrelated lockfile churn out of the PR diff

### Format pnpm-workspace.yaml

- Reads and parses `pnpm-workspace.yaml`
- Sorts array values alphabetically (`packages`, `onlyBuiltDependencies`, `publicHoistPattern`)
- Sorts top-level keys alphabetically with `packages` kept first
- Writes back with consistent formatting (2-space indent, no line wrapping, double quotes) so lint-staged does not change the file after commit

### Run custom commands

- Executes commands from the `run` input sequentially via `sh -c`
- Attempts all commands regardless of individual failures
- If any command fails, updates the check run with a failure conclusion, includes the failure details in the summary, exits without creating a PR or committing, and outputs `has-changes: false` and `updates-count: 0`

### Capture lockfile state (after)

- Reads the updated `pnpm-lock.yaml` after all dependency changes
- Stores the updated lockfile for comparison

### Detect changes

Change detection uses two complementary methods.

Lockfile comparison diffs the before and after lockfiles. Catalog comparison detects shared version updates (`catalog:default`, `catalog:silk` and so on) and scans importers to find which packages use each changed catalog entry. Importer comparison detects direct, non-catalog dependency version changes per package.

A `git status --porcelain` check detects any modified, staged or untracked files. If both the lockfile comparison and git status show no changes, the action exits early with a neutral check-run conclusion.

### Create changesets

- Skips entirely if the `changesets` input is `false`
- Checks whether a `.changeset/` directory exists
- For each affected workspace package, applies two gates before writing a changeset. The trigger gate requires at least one consumer-facing change — a `dependency`, `optionalDependency` or `peerDependency` lockfile change, or a peer-sync rewrite; `devDependency`-only changes are informational and do not by themselves produce a changeset. The versionable gate requires the package to be publishable or marked via the `versionPrivate` config
- When both gates pass, writes a `patch` changeset whose table covers all changes for the package — triggers and informational dev rows — using specific type values: `dependency`, `optionalDependency`, `peerDependency`, `devDependency`
- Empty changesets are not written, and config-only changes do not produce a changeset

### Commit and push

Commits are created through the GitHub Git Data API rather than a local `git commit`.

- Collects the changed files from git status
- Builds a tree of blob entries from their contents
- Creates a commit with a conventional commit message and DCO signoff, and no explicit author so GitHub verifies it
- Updates the branch ref to the new commit, then fetches and checks out the updated branch locally

In dry-run mode this step is skipped entirely.

### Create or update PR

- Searches for an existing open PR from the update branch to the default branch
- Updates the title and body of an existing PR, or creates a new one
- The PR body includes per-package tables with dependency, type, action, from and to columns, plus changeset details in expandable sections
- If `auto-merge` is set, enables auto-merge on the PR via the GitHub GraphQL API; failures are logged as warnings without failing the action
- Sets the `pr-number`, `pr-url`, `updates-count` and `has-changes` outputs
- Writes a GitHub Actions job summary with the same information

In dry-run mode this step is skipped and a PR body preview is included in the job summary instead.

## Post phase

The post phase runs after the main phase, even when the main phase fails.

- Reports the total run duration from the start time the pre phase recorded
- Revokes the installation token so it is not left live after the run
- Honors `skip-token-revoke`: when set, revocation is skipped and the token is left to expire on its own (installation tokens last one hour)
- Guards revocation so a failure here never fails the workflow
