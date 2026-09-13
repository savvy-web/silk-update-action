---
type: Project
title: silk-update-action
description: What this project is, its boundaries, and its non-goals.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: cd0d834551f9b1dd94489426558eedd62fec560ac36c40778144d4c7aed0f15a
sources:
  - id: action-yml
    resource: ../action.yml
  - id: package-json
    resource: ../package.json
---

# silk-update-action

## Purpose

`silk-update-action` is a GitHub Action that automates dependency updates in a
pnpm, bun, or npm workspace: pnpm config dependencies, regular and peer
dependencies, the package manager itself, and `devEngines.runtime` entries
(node/deno/bun).[^action-yml] It exists to fill a gap Dependabot does not
cover — pnpm's [config dependencies](https://pnpm.io/config-dependencies)
feature, which centralizes version management in a monorepo via
`pnpm-workspace.yaml` — and to reproduce the same workflow for
[bun's catalogs](https://bun.sh/docs/install/catalogs) where pnpm's mechanism
has no equivalent. It also keeps peer dependency ranges consistent across
workspace packages after a dependency bump.[^package-json]

The action runs as three phases (`pre` / `main` / `post`) around a GitHub App
token lifecycle: `pre` provisions a short-lived installation token with a
fail-fast permission check, `main` performs the update work inside a GitHub
check run, and `post` reports duration and revokes the token — always,
even when `main` fails. A GitHub App is used rather than a personal access
token because tokens expire in an hour, permissions are fine-grained, commits
are verified via the Git Data API without SSH/GPG keys, and this is how
GitHub's own bots behave.

The package manager is detected once per run and every dispatch point —
config dependencies, install, package-manager upgrade, workspace
formatting — routes on that single value, rather than re-detecting or
assuming one. All domain logic is built on Effect (services with
`Context.Service` + `Layer`) so that per-item failures (a registry lookup, a
runtime resolver, an auto-merge attempt) can degrade and accumulate instead of
aborting the whole run: updating ten dependencies where two registry queries
fail should still produce nine successful updates and a PR, not a failed job.
Dependency-changeset generation is delegated to `@savvy-web/silk-effects`'
`Changesets.DepsRegen` rather than reimplemented, so the gating rules
(publishable vs. ignored) live in one place shared across silk actions. A
dedicated branch is force-reset from the source ref on every run instead of
rebased, because the branch only ever holds automated updates and a clean
reset needs no conflict resolution.

The whole run is also published as one machine-readable JSON document (the
`result` output) alongside the four scalar outputs, so a consuming workflow
can act on exactly what happened without re-parsing log lines or a PR body.

## Boundaries

This project owns: detecting the workspace's package manager; resolving and
writing dependency version bumps (config, regular, peer, package-manager
self-upgrade, runtime); regenerating the lockfile; branch, commit, PR, and
check-run lifecycle; and reporting (PR body, job summary, structured output).

It deliberately leaves to others: the changeset gating and consolidation
logic (owned by `@savvy-web/silk-effects`'s `DepsRegen`), the release-age gate
assembly and peer-dependency-rules discovery (owned by
`@effected/workspaces`' `WorkspaceCatalogs`), and the GitHub API surface
itself (owned by `@effected/github` / `@effected/github-actions`). See the
[silk-update-action module](modules/silk-update-action.md) for how those
pieces are composed.

## Non-goals

- **Not a Dependabot replacement.** It is complementary — Dependabot still
  covers what it already covers; this action fills the config-dependency gap.
- **No yarn support.** Yarn is detected upstream by the workspace detector but
  rejected here with a typed input error, because nothing in the
  config-dependency, install, or upgrade paths is wired or tested for it.
- **No config-dependency reproduction for npm.** npm has no `catalog:`
  protocol to merge into, so config-dependency updates are skipped under npm
  with a warning rather than simulated.
- **No automatic PR merging.** Auto-merge can be *enabled* as a GitHub
  setting the action requests, but merging itself still requires human (or
  branch-protection) approval — this action never bypasses review.
- **No breaking-change detection.** It relies on semver ranges and whatever
  test/build commands the caller configures via the `run` input; it does not
  analyze changelogs or diffs for breaking behavior.

[^action-yml]: `action.yml`
[^package-json]: `package.json`
