---
type: Module
title: silk-update-action
description: The GitHub Action's module structure, three-phase execution, and service/layer composition.
status: draft
kind: action
resource: ../..
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: d4fbe4e490f8b85cef7320a610c915a7e3a2d0085512ec35291496a5db641e46
sources:
  - id: action-yml
    resource: ../../action.yml
  - id: program
    resource: ../../src/program.ts
  - id: pre
    resource: ../../src/pre.ts
  - id: post
    resource: ../../src/post.ts
  - id: state
    resource: ../../src/state.ts
  - id: layers-app
    resource: ../../src/layers/app.ts
  - id: format
    resource: ../../src/format.ts
  - id: schema-inputs
    resource: ../../src/schema/inputs.ts
  - id: schema-outputs
    resource: ../../src/schema/outputs.ts
---

# silk-update-action (module)

A single-package GitHub Action, not a monorepo — no barrel re-exports, direct
imports everywhere. Ships three entry points (`runs.pre` / `runs.main` /
`runs.post` in `action.yml`), each carrying the same
`if (process.env.GITHUB_ACTIONS)` guard so importing a module in a test never
executes the phase.[^action-yml][^pre][^post]

## Structure

```text
src/
├── pre.ts / main.ts / post.ts   # three entry points, GITHUB_ACTIONS-guarded
├── program.ts                   # composition: read inputs -> run steps -> fold outputs -> report
├── format.ts                    # the run's log-rendering surface (pure, no services)
├── state.ts                     # StartTimeState + STATE_KEYS cross-phase state
├── errors/errors.ts             # Schema.TaggedError union — see models/action-errors.md
├── schema/{domain,inputs,outputs}.ts
├── steps/                       # one module per orchestration unit (16)
├── layers/app.ts                # makeAppLayer(dryRun, { runtimeLive })
├── services/                    # Context.Service + Layer domain services, plus tagless helpers
└── utils/                       # pure helpers, no services
```

## The three phases

`pre.ts` provisions the GitHub App installation token
(`GitHubToken.provision`, credentials read via `ActionInput`, a `required`
scope check against `contents`/`pull_requests`/`checks: write`) and saves a
start time to `ActionState`. `main.ts` is a thin
`Action.run(program)` wrapper with **no `{ layer }` passed** — `program`'s own
requirements should be exactly the core services `Action.run` injects, since
`makeAppLayer` provides everything else internally. `post.ts` reports total
duration from the saved start time and revokes the token via
`GitHubToken.dispose()`, guarded so a `post` failure never fails the
workflow.[^pre][^post][^state]

**The `Action.run(program)` call at `main.ts` is not itself checked** — `run`'s
`options` parameter is optional, so any leftover requirement in `program`
typechecks silently and would die on the runner as a defect before a check run
exists. See [the unprovided-service gotcha](../gotchas/unprovided-service-is-not-a-type-error.md)
and [the compile-time layer guard decision](../decisions/compile-time-layer-guard.md)
for what actually closes that hole.

## `program.ts` — composition, not I/O

`program` reads inputs (`readInputs`, `src/schema/inputs.ts`), builds
`makeAppLayer(dryRun, { runtimeLive })`, and hands off to `innerProgram`, which
runs inside one GitHub check run
(`CheckRun.withCheckRun`) and executes the ordered steps below, folding their
results into the five declared outputs (`pr-number`, `pr-url`,
`updates-count`, `has-changes`, `result`) and the `RunResultDocument`
JSON.[^program][^schema-outputs] The output baseline is emitted **before any
work starts** (an empty-run document, not an empty string), so every declared
output has a value on every exit path including a failure inside input
reading itself — see
[the emit-baseline-first decision](../decisions/emit-output-baseline-first.md).

`program.ts` issues no I/O primitive and builds no strings of its own —
log rendering lives in `format.ts`, and each step's own body lives in
`src/steps/`.

## Steps, in run order

Each step module declares its own result type, an explicit requirement
channel, and a tagged error only if it can actually fail. Verified against
the current signatures (grep the step files for an error channel of exactly
`never`): exactly five carry `never` —
`custom-commands`, `regular-dependencies`, `peer-check`, `upgrade-runtimes`,
`upgrade-package-manager` — because each degrades its own failures internally
rather than propagating them. See
[steps own their error channels](../decisions/steps-own-their-error-channels.md).

| # | step (`src/steps/…`) | what it does | failure posture |
| --- | --- | --- | --- |
| 1 | `detect-package-manager.ts` | resolves workspace root + package manager once; every later dispatch reads this value | fails the run (`InvalidInputError`) — yarn or no workspace root |
| 2 | `configure-status.ts` | pins `core.fileMode=false` on the checkout, once, before any status read | fails the run — a write that didn't take makes every later status read count exec-bit flips as changes |
| 3 | `branch.ts` | validates `source-branch`/`target-branch` exist, then `GitBranch.upsert`s the update branch | fails the run |
| 4 | `lockfile-snapshot.ts` | captures lockfile state (runs twice: `"before"` / `"after"`) | a missing lockfile is a skip, not a failure |
| 5 | `upgrade-package-manager.ts` | self-upgrades the **detected** manager per the `upgrade-package-manager` input | degrades to an outcome; `unsatisfiable` (wrong-manager range) warns |
| 6 | `upgrade-runtimes.ts` | bumps `devEngines.runtime` entries, upgrade-only, never add | degrades per runtime; an EOL major line warns and skips |
| 7 | `config-dependencies.ts` | dispatches on package manager: pnpm edits `pnpm-workspace.yaml`, bun merges catalogs into `package.json`, npm is skipped with a warning | fails on a manifest read/write error |
| 8 | `regular-dependencies.ts` | resolves each dependency within its declared specifier range | degrades per-dependency registry failures internally |
| 9 | `peer-sync.ts` | syncs peer ranges per `peer-lock`/`peer-minor` | fails on a manifest read/write error; reports "not configured" distinctly from "synced nothing" |
| 10 | `install.ts` | regenerates the lockfile (`runInstall`), dispatched on manager | fails the run on a non-zero install |
| 11 | `format-workspace.ts` | pnpm-only: sorts `pnpm-workspace.yaml` | fails on a manifest error; logs the reason when it does not apply |
| 12 | `custom-commands.ts` | runs every `run` input command sequentially, collecting failures | returns failures; does **not** conclude the check run — that stays the composition layer's job |
| 13 | `detect-changes.ts` | reads `git status` via `Git.status` for the change verdict | fails on a git command error |
| 14 | `changesets.ts` | delegates to `@savvy-web/silk-effects`'s `Changesets.DepsRegen` | fails typed (`ChangesetError` + git errors from `ensureBaseHistory`) |
| 15 | `commit-and-pr.ts` | commits via the GitHub API, then upserts the PR | commit propagates; a PR failure degrades to a warning — the commit is already pushed and durable |
| 16 | `peer-check.ts` | gates auto-merge on a proven-clean peer report, read from the **after**-install lockfile | degrades to a warning; the **gate** itself fails closed on any unverifiable input |

`custom-commands` not concluding the check run, and `commit-and-pr` staying one
module rather than two, are both deliberate boundaries — composition owns the
run's verdict, and the commit/PR pair share an ordering constraint (a PR must
describe a commit that exists) that would be easy to violate if split.

## Domain services (`src/services/`)

Every service is a `static layer` declared **in the class body** (a member
attached after the class is tree-shaken out of the bundled `dist` — see
[static-layer-in-class-body](../conventions/static-layer-in-class-body.md)).
No `*Live` constant survives.

| service | requires (own layer body) |
| --- | --- |
| `BranchManager` | `GitBranch`, `GitCommit`, `Git`, `ChildProcessSpawner` |
| `PackageManagerUpgrade` | `NpmRegistry`, `PackageJsonFile` |
| `RuntimeUpgrade` | the three `@effected/runtimes` resolvers, `PackageJsonFile` |
| `ReleaseAge` | `WorkspaceCatalogs`, `NpmRegistry` |
| `ConfigDeps` | `NpmRegistry`, `ReleaseAge` |
| `CatalogConfigDeps` | `NpmRegistry`, `LockfileReader`, `PackageTarball` |
| `RegularDeps` | `NpmRegistry`, `WorkspaceDiscovery`, `ReleaseAge` |
| `Changesets` | `Changesets.DepsRegen` (`@savvy-web/silk-effects`) |
| `Report` | `PullRequest`, `ActionState` (resolves the DCO sign-off once, from the persisted token) |

Tagless standalone helpers (no `Context.Service`, because nothing in `src/`
ever resolved a tag for them): `detectPackageManager`
(`src/services/package-manager.ts`), `syncPeers`
(`src/services/peer-sync.ts`), `fetchModuleCatalogs`
(`src/services/module-catalogs.ts`), and the capture/compare/format functions
in `src/services/lockfile.ts` and `src/services/workspace-yaml.ts`.

## `makeAppLayer` — what it builds, and what it deliberately doesn't

`src/layers/app.ts` exports `makeAppLayer(dryRun, { runtimeLive })`. It builds
the `GitHubClient` from `GitHubToken.clientLayer()` (`Layer.orDie`), `Repo`
from `Repo.layerFromConfig()`, the `@effected/github` resource layers, the
root-bound `@effected/workspaces` layers, `@savvy-web/silk-effects`'
`Changesets.DepsRegenDefault`, the `@effected/runtimes` resolvers (offline
snapshot or live, per `runtimeLive`), and every domain service above, wiring
each one's own dependencies explicitly rather than merging everything and
hoping.

It deliberately does **not** build `FileSystem`, `Path`, `HttpClient`, or
`ChildProcessSpawner` — those are members of `ActionServices` that
`Action.run`'s runtime already provides, so `NpmRegistry.layer`,
`PackageJsonFile.layer`, `PackageTarball.layer`, and the workspace layers are
all built "bare", left requiring them at the app layer's boundary. Building a
private copy would bundle a second Node platform / fetch client into `dist`.
See [platform stays in the requirement channel](../decisions/platform-stays-in-requirement-channel.md).

`WorkspaceCatalogs` is exposed in `domainLayers`, not merely provided inward to
`ReleaseAge` — a fix for a shipped incident where `steps/peer-check.ts`
resolved it in a step body (not a layer body) and the app layer never merged
it into what it returned. See
[workspacecatalogs-not-merged](../incidents/workspacecatalogs-not-merged.md).

Nothing in the production call path checks that everything left in
`makeAppLayer`'s requirement channel actually is an `ActionServices` member —
that is a compile-time assertion in the test suite, not a call-site rule; see
[the compile-time layer guard decision](../decisions/compile-time-layer-guard.md).

## The rendering surface (`src/format.ts`)

Every human-readable string the run produces — other than a step's own inline
skip reason — is built here, pure and service-free: `runContextLines`,
`resultLines`, the catalog-delta tally pair (`formatCatalogCounts` /
`formatCatalogCountsCompact`, worded for two different audiences from the same
data), `INSTALL_LABEL`, and `describePmEvidence` (explicitly *not* a source of
truth — a best-effort re-derivation of the detector's signal, for one log
line only). `src/services/report.ts` is the sibling rendering module for a
different sink — the PR body, job summary, and commit message, as a service
over `PullRequest` rather than a pure module. See
[format and report stay separate](../decisions/format-and-report-stay-separate.md).

## Pure helpers (`src/utils/`)

`branch.ts` (`resolveTargetBranch`), `catalogs.ts` (catalog-map merge
helpers), `commit-signoff.ts` (`resolveSignoff` — the DCO trailer from the
persisted App token), `commit-subject.ts` (`buildUpdateSubject` — the PR
title / commit subject, derived from the run's contents rather than a static
string), `deps.ts`, `markdown.ts` (`bold`/`rule` — the two builders
`GitHubMarkdown` doesn't ship), `peers.ts` (`decidePeerGate` — the pure
auto-merge gate predicate), `pnpm.ts` (`detectIndent` only), `runtime.ts`
(`locateRuntimeEntry` — entry + JSONC `versionPath`, never a live object to
mutate), `semver.ts` (range resolution helpers).

## PR description shape

`Report.generatePRBody` composes a `## Dependency Updates` summary line, then
one table per update category present in the run (Config Dependencies,
Regular Dependencies, Catalog Changes for a bun compat-mode run, Changesets),
built through the kit's `GitHubMarkdown` writer. Which sections exist and in
what order is this module's policy — the kit ships no report-shaping
construct of its own.

## Related

- [Interfaces: action inputs](../interfaces/action-inputs.md),
  [action outputs](../interfaces/action-outputs.md)
- [DataModels: domain schemas](../models/domain-schemas.md),
  [action errors](../models/action-errors.md)
- Decisions: [effect-v4-and-effected-kit](../decisions/effect-v4-and-effected-kit.md),
  [detect-package-manager-once](../decisions/detect-package-manager-once.md),
  [regenerate-lockfile-not-repair](../decisions/regenerate-lockfile-not-repair.md),
  [peer-gate-fails-closed](../decisions/peer-gate-fails-closed.md),
  [refresh-catalogs-before-peer-check](../decisions/refresh-catalogs-before-peer-check.md)
- Conventions: [static-layer-in-class-body](../conventions/static-layer-in-class-body.md),
  [workspace-root-is-required](../conventions/workspace-root-is-required.md),
  [no-export-without-construction-site](../conventions/no-export-without-construction-site.md)
- Limitations: [yarn-is-rejected](../limitations/yarn-is-rejected.md),
  [npm-has-no-config-dependencies](../limitations/npm-has-no-config-dependencies.md)

[^action-yml]: `action.yml`
[^pre]: `src/pre.ts`
[^post]: `src/post.ts`
[^state]: `src/state.ts`
[^program]: `src/program.ts`
[^schema-outputs]: `src/schema/outputs.ts`
