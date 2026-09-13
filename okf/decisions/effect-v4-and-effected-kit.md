---
type: Decision
title: Build on Effect v4 and the @effected kit, not plain TypeScript or one all-in-one library
description: Why domain logic is Effect services over Context.Service/Layer, and why the action depends on the split @effected/* kit rather than the deleted all-in-one @savvy-web/github-action-effects.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 89c9514ced7aba3af7c11583ea1ce0bdb6358e96d3034e6f69b193bcd1f3348a
sources:
  - id: package-json
    resource: ../../package.json
  - id: layers-app
    resource: ../../src/layers/app.ts
  - id: services-branch
    resource: ../../src/services/branch.ts
---

# Build on Effect v4 and the @effected kit, not plain TypeScript or one all-in-one library

## Context

This action updates config dependencies, regular and peer dependencies, the
package manager itself, and `devEngines.runtime` entries, across pnpm, bun and
npm. A run that fails one dependency's registry lookup, one runtime resolver,
or one auto-merge attempt should not fail the whole job — updating ten
dependencies where two registry queries fail should still produce nine
successful updates and a PR, not a failed check run. The action also spans a
GitHub App token lifecycle across three separate Node processes (`pre` /
`main` / `post`) that must revoke the token even when `main` fails.

## Decision

Domain logic is written as Effect services (`Context.Service` + `Layer`),
declared with `static readonly layer` in the class body rather than a
post-class-assigned `*Live` constant — every service in `src/services/`
follows this, for example `BranchManager`.[^services-branch] All GitHub
Actions, GitHub API, npm registry, command-running and workspace capabilities
come from the first-party `@effected/*` kit (`commands`, `git`, `github`,
`github-actions`, `lockfiles`, `npm`, `package-json`, `runtimes`, `semver`,
`workspaces`, `yaml`), pinned as `catalog:effected`, plus core `effect`
(`catalog:effect`).[^package-json] `@savvy-web/silk-effects` supplies the
changeset-consolidation service.[^package-json]

Effect's typed error channel makes per-item failure handling explicit rather
than implicit: a function's signature states which errors it can produce, the
compiler enforces that callers handle them, and `Effect.catch` /
`Effect.result` let a batch operation accumulate partial failures instead of
aborting. `Context.Service` + `Layer` gives compile-time-verified dependency
injection — each service declares its dependencies in its layer body, and the
compiler ensures they are satisfied — which is what lets a wiring change (a
new service needing a new capability) surface as a type error rather than a
runtime crash, in the ordinary case. (It has one documented hole: an unwired
service in the layer graph is not a type error at `Action.run`'s call site —
see [the requirement-channel gotcha](../gotchas/unprovided-service-is-not-a-type-error.md).)
Resource lifetimes that span process boundaries — the GitHub App token
provisioned in `pre` and revoked in `post` — are modelled with Effect's
resource-management primitives rather than ad hoc cleanup.

The kit is split into focused packages rather than one dependency, replacing a
deleted all-in-one library, `@savvy-web/github-action-effects`. That library
bundled unrelated concerns — the Actions runtime, the GitHub API, the npm
registry, subprocess execution, Markdown rendering — behind one dependency, so
any consumer of one part paid for all of them, including a transitive
`cyclonedx` tree this action once had to teach its bundler to ignore (that
`build.ignore` entry and the cyclonedx dependency chain are gone from
`package.json` and `action.config.ts` today).[^package-json] The mapping from
the deleted surface to its replacement:

| Deleted surface | Replacement |
| --- | --- |
| `Action`, `ActionEnvironment`, `ActionInput`, `ActionOutputs`, `ActionState`, `ActionLogger`, `DryRun`, `GitHubToken` | `@effected/github-actions` |
| `GitHubApp`, `GitHubClient`, `GitHubGraphQL`, `GitBranch`, `GitCommit`, `CheckRun`, `PullRequest`, `AutoMerge` | `@effected/github` |
| `NpmRegistry`, `SemverResolver`-adjacent registry reads | `@effected/npm` |
| `CommandRunner` (a service) | `@effected/commands`'s `Run` free functions over core `ChildProcessSpawner` |
| `GithubMarkdown` | `GitHubMarkdown` (capital H) in `@effected/github-actions` — a rename, not a removal |
| `ActionInputError` | this repo's own `InvalidInputError` |
| `*Live` layer constants | `.layer` / `.layer(...)` statics on the service classes |
| `@savvy-web/github-action-effects/testing` (`ActionStateTest`, `GitHubAppTest`, `ActionOutputsTest`) | `__test__/utils/action-doubles.ts` over each service's `layerTest` |

Splitting also let individual shapes improve where the old library's shape was
worse: one `GitHubError` discriminated by `hasKind` instead of a per-service
error class, `GitBranch.upsert` instead of an exists/delete/create dance,
`Run` free functions instead of a `CommandRunner` service, and `ActionInput`
accessors that actually know the runner's `INPUT_*` name-mangling rather than
resolving nothing under a bare `Config` read.

**Versions belong in `package.json`, not in prose.** `effect` and every
`@effected/*` package are pinned by catalog entry
(`catalog:effect`/`catalog:effected`), and a version literal copied into a doc
goes stale the next time the catalog moves while nobody edits the sentence
that named it. Where a version is worth stating at all, it is stated as
history — a claim about what a release *shipped*, which does not go stale —
for example "`@effected/npm@0.11.0` shipped `CorepackIntegrityHash.fromSri`",
never as a claim about what is currently installed.

## Alternatives rejected

- **Plain TypeScript with Promises/try-catch.** Rejected because per-item
  failure accumulation (continue after 2 of 10 registry lookups fail) would
  need hand-rolled result-collection at every batch site, and the token/check
  run lifecycle spanning three processes would need manual cleanup tracking
  with no compiler check that every exit path actually runs it.
- **Keep `@savvy-web/github-action-effects`.** Rejected on the bundling cost
  (every consumer of one surface paid for the whole library's transitive
  tree) and on shape: the kit's per-package evolution (one `GitHubError`,
  `upsert` semantics, `ActionInput`'s correct `INPUT_*` mangling) only became
  possible once the surfaces were independently versionable.
- **`*Live` constants assigned after the class body.** Considered and
  rejected: a member attached by post-class assignment is tree-shaken out of
  the bundled `dist` by the build's dead-code elimination, and that failure
  appears only in production because the test suite runs the source, not the
  bundle. Every service layer is now declared `static readonly layer` inside
  the class body for this reason.

## Consequences

- Every domain service's dependencies must be resolved inside its layer body,
  not inside a method, or the app-layer compile-time requirement guard cannot
  see them — see
  [adopting a service is a wiring change](../conventions/adopting-a-service-is-a-wiring-change.md).
- A version literal in a design document or a `CLAUDE.md` gotcha is a second
  source of truth that will go stale; the catalog entry is the only one that
  is maintained by construction.
- Splitting one library into many packages that still travel together
  (`catalog:effected`) creates a duplicate-resolution hazard whenever one
  package's declared range falls behind its siblings — see
  [caret pins the minor on 0.x](../gotchas/caret-pins-minor-on-0x.md) and
  [duplicate kit copies and stale transitives](../gotchas/duplicate-kit-copies-and-stale-transitives.md).

[^package-json]: `package.json`
[^services-branch]: `src/services/branch.ts`
