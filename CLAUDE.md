# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Status

This is a **GitHub Action** that updates config dependencies, regular and peer
dependencies, the package manager itself, and `devEngines.runtime` entries
(node/deno/bun). It runs as **three phases** around a GitHub App token
lifecycle: `src/pre.ts` provisions the token, `src/main.ts` is a thin
`Action.run(program)` wrapper, `src/post.ts` reports duration and revokes the
token. `src/program.ts` composes the run — read inputs, run the steps in
order, fold results into outputs, report — with each step's body in its own
module under `src/steps/`. It runs on **Effect v4** and the **`@effected/*`
kit**: domain logic is wrapped as Effect services (`Context.Service` + `Layer`)
in `src/services/`, wired by `makeAppLayer` in `src/layers/app.ts`. The
**package manager is detected once per run** and every dispatch point routes
on that one value — pnpm, bun and npm are supported; yarn is rejected.

## Documentation

Project knowledge lives in the **`okf/`** knowledge bundle. Load
`okf/index.md` first — it links every concept — then follow the navigation
table below to what your work touches. Do not load the whole bundle at once;
skip it entirely for a simple, self-contained bug fix or test-only change.

| Working on | Read |
| --- | --- |
| Overall architecture, services, steps, data flow | [`okf/modules/silk-update-action.md`](okf/modules/silk-update-action.md) |
| Action inputs | [`okf/interfaces/action-inputs.md`](okf/interfaces/action-inputs.md) |
| Action outputs, the `result` document | [`okf/interfaces/action-outputs.md`](okf/interfaces/action-outputs.md) |
| The `result` JSON Schema: label, identity, rebuild | [`okf/runbooks/rebuild-the-result-schema.md`](okf/runbooks/rebuild-the-result-schema.md), [`okf/conventions/annotate-shared-schemas.md`](okf/conventions/annotate-shared-schemas.md) |
| Wiring or editing a service/layer | [`okf/decisions/compile-time-layer-guard.md`](okf/decisions/compile-time-layer-guard.md), [`okf/conventions/adopting-a-service-is-a-wiring-change.md`](okf/conventions/adopting-a-service-is-a-wiring-change.md), [`okf/gotchas/unprovided-service-is-not-a-type-error.md`](okf/gotchas/unprovided-service-is-not-a-type-error.md) |
| Reading/adding an action input | [`okf/conventions/read-inputs-via-actioninput.md`](okf/conventions/read-inputs-via-actioninput.md) |
| Tests: layout, collection, coverage | [`okf/conventions/test-layout.md`](okf/conventions/test-layout.md), [`okf/gotchas/uncollected-test-suite.md`](okf/gotchas/uncollected-test-suite.md), [`okf/gotchas/aggregate-coverage-gate.md`](okf/gotchas/aggregate-coverage-gate.md) |
| Bumping the `@effected/*` kit or any dependency | [`okf/runbooks/bump-the-effected-kit.md`](okf/runbooks/bump-the-effected-kit.md), [`okf/gotchas/caret-pins-minor-on-0x.md`](okf/gotchas/caret-pins-minor-on-0x.md), [`okf/gotchas/kit-ranges-come-from-a-config-dependency.md`](okf/gotchas/kit-ranges-come-from-a-config-dependency.md), [`okf/gotchas/duplicate-kit-copies-and-stale-transitives.md`](okf/gotchas/duplicate-kit-copies-and-stale-transitives.md) |
| Branching, `dev`, cutting a release | [`okf/runbooks/release-flow.md`](okf/runbooks/release-flow.md), [`okf/conventions/never-rewrite-dev.md`](okf/conventions/never-rewrite-dev.md), [`okf/runbooks/test-a-dev-branch-build.md`](okf/runbooks/test-a-dev-branch-build.md) |
| Linking/overriding a first-party dependency | [`okf/runbooks/dogfood-a-first-party-dependency.md`](okf/runbooks/dogfood-a-first-party-dependency.md) |
| `check-peers` / auto-merge gating | [`okf/decisions/peer-gate-fails-closed.md`](okf/decisions/peer-gate-fails-closed.md) |
| Editing any doc in `okf/` | [`okf/conventions/write-falsifiable-claims.md`](okf/conventions/write-falsifiable-claims.md) |
| "What has shipped broken before" | [`okf/incidents/index.md`](okf/incidents/index.md) |

**Keep the bundle current.** When a change touches a documented decision,
convention, or gotcha, update the concept file (or add a new one) in the same
change, then run `pnpm exec okfit validate .` and `pnpm exec okfit sync`.
Never hand-edit `okf/index.md` or `okf/log.md` — sync regenerates them.
Decisions carry `status: draft` until a human runs `okfit verify` on them;
don't set that field yourself.

## Commands

```bash
pnpm run lint / lint:fix           # Biome check / auto-fix
pnpm run typecheck                 # tsc via Turbo
pnpm run test / test:watch         # Vitest
pnpm run test:coverage             # Coverage (aggregate gate — see okf/gotchas/aggregate-coverage-gate.md)
pnpm run build / build:prod        # Bundle via github-action-builder
pnpm run schema:build              # Regenerate schemas/<label>/output.json via schemastore CLI
pnpm run schema:check              # Drift guard (runs before vitest in ci:test)
pnpm run lint:md                   # markdownlint-cli2 (docs + this file)

pnpm vitest run __test__/unit/services/regular-deps.test.ts   # single file
pnpm vitest run --testNamePattern="buildUpdateSubject"        # by name
```

## Conventions

- `.js` extensions on relative imports (ESM); `node:` protocol for built-ins;
  separate `import type`
- Biome enforces **tabs**, not spaces
- Commits: conventional format, DCO signoff, no markdown in the body
  (commitlint `silk/body-no-markdown`)

## Sharpest hazards

A one-line map of the mistakes most likely to recur, each pointing at its
concept for the full mechanism and evidence:

- `Action.run(program)` typechecks even when a service is left unprovided —
  there is no "you forgot a layer" error, ever. See
  [unprovided-service-is-not-a-type-error](okf/gotchas/unprovided-service-is-not-a-type-error.md).
- Read every action input through `ActionInput.*`, never bare `Config` — a
  bare `Config` read resolves nothing under the runner and silently takes its
  default. See
  [read-inputs-via-actioninput](okf/conventions/read-inputs-via-actioninput.md).
- It's `Schema.TaggedError`, not `Schema.TaggedErrorClass` — the error list an
  advance produces is dominated by call sites, but the fix is almost always at
  the declaration. See
  [tagged-error-rename-presents-as-call-site-errors](okf/gotchas/tagged-error-rename-presents-as-call-site-errors.md).
- A caret pins the minor on a `0.x` dependency, and this repo's `@effected/*`
  ranges come from a config dependency, not `package.json` — `pnpm add` cannot
  bump them. See
  [caret-pins-minor-on-0x](okf/gotchas/caret-pins-minor-on-0x.md) and
  [kit-ranges-come-from-a-config-dependency](okf/gotchas/kit-ranges-come-from-a-config-dependency.md).
- `dev` is the feature branch and other repos' CI is pinned to it — never
  squash, force-push, or rebase it. See
  [never-rewrite-dev](okf/conventions/never-rewrite-dev.md).
- Tests for `src/utils/` live in `__test__/unit/utilities/`, not
  `__test__/unit/utils/` — `utils` is a reserved, silently-excluded directory
  name. See [uncollected-test-suite](okf/gotchas/uncollected-test-suite.md).
- The schema label in `src/schema/hosted.ts` (`SCHEMA_VERSION`) is the
  action's NEXT major, not its version; that module is the only place the
  hosting URL is spelled, and `pnpm schema:check` is the whole drift guard —
  there is no generator script or drift test. See
  [rebuild-the-result-schema](okf/runbooks/rebuild-the-result-schema.md).
- A stated test count is evidence to re-derive (`pnpm vitest run`), never to
  carry forward — coverage is an aggregate gate, so a whole module can run zero
  times while the suite stays green. See
  [aggregate-coverage-gate](okf/gotchas/aggregate-coverage-gate.md).
