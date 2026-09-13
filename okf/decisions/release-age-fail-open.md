---
type: Decision
title: Release-age gate discovery fails open
description: A gate that cannot be assembled degrades to no gate with a warning, because pnpm re-enforces minimumReleaseAge at install regardless.
status: draft
tags:
  - deps
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 2646783829a024d3945de0e180bddce9ef274b07ed4a8e77dd3fa694234af324
sources:
  - id: release-age-service
    resource: ../../src/services/release-age.ts
  - id: layers-app
    resource: ../../src/layers/app.ts
  - id: release-age-int-test
    resource: ../../__test__/integration/release-age.int.test.ts
  - id: effected-292
    resource: "https://github.com/spencerbeggs/effected/issues/292"
---

# Release-age gate discovery fails open

## Context

pnpm's `minimumReleaseAge` / `minimumReleaseAgeExclude` settings reject a
version published inside a cutoff window at install
(`ERR_PNPM_NO_MATURE_MATCHING_VERSION`). This action mirrors that gate at
*resolution* time, before it proposes a version, so it never suggests
something pnpm would refuse at the point of installing it.

Discovering the effective gate is not this action's own logic:
`WorkspaceCatalogs.releaseAgeGate()` (`@effected/workspaces`) combines the
inline `pnpm-workspace.yaml` keys with the settings any config-dependency
pnpmfile hook injects at `updateConfig`, strictest source wins. Replaying the
hooks matters because `pnpm config get` does not reflect what a config
dependency contributes — a repository receiving its release-age policy
through a plugin can only be read by actually running that plugin's hook.

The hook replay must run in a **subprocess**
(`layerWithConfigDependenciesSubprocess`, not the in-process
`layerWithConfigDependencies`): the in-process variant loads each pnpmfile
with a computed dynamic `import()`, which this action's bundler compiles into
a context module and breaks in the shipped `dist`. The subprocess variant
passes a static script over argv, so nothing computed enters the bundle
graph, and it also keeps arbitrary config-dependency code out of the action's
own process.[^layers-app]

## Decision

`ReleaseAge.layer` wraps `WorkspaceCatalogs.releaseAgeGate()` in a single
`Effect.catch` and degrades a discovery failure to the inert zero gate with a
warning, rather than propagating the kit's typed failure.[^release-age-service]
The kit itself fails *typed* (a `CatalogAssemblyFailure`), which is the
correct contract for a general-purpose library — but this action is not a
library call site with a caller free to decide a policy; it is the one place
that policy has to be decided, and the fail-open answer is deliberate: the
worst case of a missing gate is exactly the *pre-gate* behavior this action
had before adopting the gate at all, and pnpm re-enforces
`minimumReleaseAge` at install regardless. Aborting a dependency-update run
because one workspace file could not be assembled would be strictly worse
than proceeding without the gate.

Two bounds the subprocess variant imposes are accepted as the cost of
running the replay off-process: the child gets 30 seconds, so a pnpmfile
that loops fails typed rather than hanging the memoized assemble pass (a
subprocess is killable; an in-process synchronous hook call is not), and its
captured stdout is read under a ~16 MiB ceiling, above which the read fails
typed as too large.

## Alternatives rejected

- **Fail typed and abort the run.** Rejected because a broken or slow
  config-dependency plugin would then take down every dependency-update run
  in every consumer, for a gate that only ever *narrows* what this action
  proposes — pnpm's own enforcement at install is the actual backstop.
- **The in-process hook loader.** Blocked outright, not merely disfavored:
  its computed `import()` breaks in the bundled `dist`, which is why this
  adoption waited on the kit shipping the subprocess variant at all.
- **Re-implement discovery locally instead of adopting
  `WorkspaceCatalogs`.** This action used to do exactly this (a local
  `npm view … time --json` shell-out plus a hand-rolled hook replay with a
  sentinel-scanning parser). It is not the shape currently shipped; discovery
  now belongs to the kit specifically so this action does not carry its own
  copy of hook-replay machinery.

## Consequences

- A workspace whose config-dependency plugin genuinely fails during the hook
  replay gets no release-age gate for that run, silently in the sense that
  the run still succeeds — visibly in the sense that a warning names the
  failure. A reader has to read the log to know the gate was inert.
- The subprocess replay reads its child's stdout for a JSON payload by
  scanning for the last non-empty line, which is a documented upstream
  limitation, not something this action's wrapper can see or repair — see
  [hook logging after the payload](../limitations/hook-logging-after-payload.md)
  and the known gap below.
- `release-age.int.test.ts` exercises both halves of the split
  deliberately: that the kit's own surface fails typed on a throwing
  pnpmfile, and separately that `ReleaseAge.layer` turns that into the inert
  gate.[^release-age-int-test] Asserting only the outcome would still pass if
  the wrapper were ever deleted and the typed failure allowed to propagate
  unchanged.

## What would change the answer

A hook that writes valid JSON *after* its actual payload — for example
inside a `process.on("exit", …)` handler — can still break the subprocess
parse today, because the framing reads the last non-empty line of stdout
rather than a delimited payload (tracked upstream as
`spencerbeggs/effected#292`[^effected-292]). This action's fail-open wrapper
converts that failure into "no gate" exactly as it would any other assembly
failure, which is correct given the posture above but means a chatty
pnpmfile that logs at exit, rather than during execution, can silently lose
its own release-age settings for a run. A hook that logs *during* execution —
the ordinary shape, and the one a real historical regression was about — is
unaffected and is exercised directly in the integration
suite.[^release-age-int-test] If the kit's framing moves to a delimited or
newline-terminated payload, this limitation closes without this repository
changing anything.

[^release-age-service]: `src/services/release-age.ts`
[^layers-app]: `src/layers/app.ts`
[^release-age-int-test]: `__test__/integration/release-age.int.test.ts`
[^effected-292]: <https://github.com/spencerbeggs/effected/issues/292>
