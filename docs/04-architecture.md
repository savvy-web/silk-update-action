# Architecture overview

How the Silk Update Action works, at the level you need to run it: the three phases it executes, why the token lifecycle is split across them and what the main update workflow does in order.

## Table of contents

- [Design principles](#design-principles)
- [Three-phase execution](#three-phase-execution)
- [Main-phase flow](#main-phase-flow)
- [Verified commits](#verified-commits)

## Design principles

The action is built around four ideas. Changes are visible before they merge: every run produces a pull request with per-package change tables, and check runs report status in the GitHub UI. Individual dependency failures do not abort the run — errors are collected and reported so the rest of the updates still land. Authentication uses a short-lived GitHub App token rather than a long-lived personal access token. And the action complements Dependabot rather than replacing it, filling the gap Dependabot leaves around pnpm config dependencies.

## Three-phase execution

The action runs as three separate phases, declared in its `action.yml` under `runs:` as `pre`, `main` and `post`. GitHub Actions runs each phase as its own process, and the GitHub App token's lifecycle is split across them.

- **Pre** — provisions a GitHub App installation token. It signs in as the App, mints an installation token and runs a fail-fast permission check against the scopes the action needs (`contents: write`, `pull-requests: write` and `checks: write`). If the App is missing a scope, the run fails here, before any dependency is touched, instead of partway through the main phase. The pre step also records a start time and persists the token to cross-phase state so the main step can read it back.
- **Main** — the dependency-update workflow described below. It reads the token the pre step provisioned and uses it for every GitHub API call.
- **Post** — reports the total run duration and revokes the token. The post step always runs, even when the main step fails, so a token is never left live after a failed run. Set the `skip-token-revoke` input to leave revocation to the token's natural one-hour expiry instead. Revocation failures are swallowed so the post step never fails the workflow.

Splitting the token across phases keeps the credential short-lived and bounded to a single run, and it surfaces a misconfigured App immediately. The token is provisioned in pre, used in main and revoked in post — there is no long-lived secret in the environment for the main step to read.

## Main-phase flow

The main phase runs these steps in order. Most steps are conditional on the inputs you supply, and unrelated steps are skipped when their inputs are absent.

1. Manage the dedicated update branch (default `pnpm/config-deps`). If the branch exists it is deleted and recreated from the default branch, so each run starts from a clean baseline and the PR diff shows only the dependency changes.
2. Capture the current `pnpm-lock.yaml` state for later comparison.
3. Upgrade the package manager (pnpm, for now) if `upgrade-package-manager` is non-`false`, bumping the `packageManager` and `devEngines.packageManager` fields when a newer version is available within range.
4. Upgrade the `devEngines.runtime` entries (Node.js, Deno, Bun) when any `upgrade-runtime-*` input is set. See [runtime upgrades](#runtime-upgrades) below.
5. Update config dependencies. The action resolves each one within a conservative range derived from its current major (hash-pinned config deps carry no explicit range) and edits the `configDependencies` entry in `pnpm-workspace.yaml` in place. It does not run `pnpm add --config`, which would promote the dependency into a catalog.
6. Update regular dependencies across `dependencies`, `devDependencies` and `optionalDependencies` in every workspace `package.json`, resolving each within the semver range already declared in `package.json` (so a `^4.0.0` specifier stays on `4.x`) and matching the `dependencies` input patterns (globs supported).
7. Sync peer-dependency ranges for packages listed in `peer-lock` or `peer-minor`, following each package's strategy.
8. Reconcile the lockfile with `pnpm install --frozen-lockfile=false --fix-lockfile`, which writes the lockfile changes while leaving unrelated transitive versions pinned.
9. Format `pnpm-workspace.yaml` so the result matches the repository's lint-staged formatting and does not churn after commit.
10. Run any custom `run` commands sequentially. If a command fails, the action records the failure on the check run and exits without creating a PR.
11. Detect changes by diffing the before and after lockfiles and inspecting `git status`. If nothing changed, the run exits early.
12. Create changesets if the `changesets` input is enabled and the repository has a `.changeset/` directory.
13. Commit the changes through the GitHub API as a verified, signed commit (see below).
14. Create or update the pull request with a per-package summary, optionally enable auto-merge, finalize the check run and write the GitHub Actions job summary.

### Runtime upgrades

The `upgrade-runtime-node`, `upgrade-runtime-deno` and `upgrade-runtime-bun` inputs each accept `false`, `auto` or a semver range, and `runtime-data` selects whether version data comes from the bundled `offline` cache or a `live` fetch. A runtime upgrade rewrites the matching `devEngines.runtime` entry's version. Like a pnpm self-upgrade, it is a tooling-level change: it appears in the PR summary and commit message but never creates a changeset and never triggers `pnpm install`. Version resolution covers only currently-maintained major lines, so a request targeting an end-of-life line is skipped with a warning.

## Verified commits

Commits are created through the GitHub Git Data API rather than a local `git commit`. When the App token is used and no explicit author is set, GitHub attributes the commit to the App and signs it automatically, so the PR shows the "Verified" badge. This needs no SSH or GPG keys on the runner and matches how GitHub's own bots commit.
