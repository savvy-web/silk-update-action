---
type: Decision
title: A first-party computed dynamic import stays local, guarded by a build-time assertion
description: The one dynamic import this action itself performs — loading a config dependency's extracted tarball entry — cannot be declared to the bundler's nativeDynamicImports list, so it carries an inline webpackIgnore comment instead, verified against the built dist/main.js after every build.
status: draft
tags:
  - bundle
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 7f724017e17a17b3b97a08618a4fdf09bdd2f04e0e348854bdfc60c0c7567390
sources:
  - id: action-config
    resource: ../../action.config.ts
  - id: module-catalogs
    resource: ../../src/services/module-catalogs.ts
  - id: assert-native-dynamic-import
    resource: ../../scripts/assert-native-dynamic-import.mjs
  - id: effected-242
    resource: "https://github.com/spencerbeggs/effected/issues/242"
---

# A first-party computed dynamic import stays local, guarded by a build-time assertion

## Context

This action ships as a bundled `dist/{pre,main,post}.js`, and the bundler
(`@savvy-web/github-action-builder`, over rspack) needs to know in advance
about any `await import(expr)` whose argument is not a static string
literal — otherwise it compiles the call into a context module (a
build-time directory glob keyed by a runtime-computed path), which throws
`Cannot find module 'file:///…'` at runtime even though the target file
genuinely exists on disk.[^action-config] `action.config.ts`'s
`build.nativeDynamicImports` option is the declared list of packages that
need this treatment, and it works by matching resolved paths under
`node_modules/<name>/`.[^action-config]

Two distinct computed-import call sites are reachable from this action's
bundle, and only one of them belongs on that list. The third-party one is
`@changesets/apply-release-plan`'s dynamic load of a configured changelog
module, listed in `nativeDynamicImports` because it resolves under
`node_modules`.[^action-config] `@effected/workspaces`' `ConfigDependencyHooks`
loader has the identical pattern and is also reachable (via
`WorkspaceCatalogs`), but is deliberately **not** listed: as of
`@effected/workspaces@0.13.0` it carries its own inline
`/* webpackIgnore: true */` comment (upstream
spencerbeggs/effected#242[^effected-242]), so rspack already leaves that
import native, and registering it in `nativeDynamicImports` anyway makes
the builder's ignore-loader throw and fails the build outright.[^action-config]

The third call site is this action's own:
`src/services/module-catalogs.ts` computes the path to a config
dependency's extracted tarball entry at runtime — from a temp directory
`@effected/npm`'s `PackageTarball.extract` produced — and imports it to read
the `catalogs` export.[^module-catalogs] That path never resolves under
`node_modules/<name>/`, so `nativeDynamicImports`' matching rule cannot
target it structurally, listed or not.[^module-catalogs][^action-config]

## Decision

The `module-catalogs.ts` call site carries its own inline
`/* webpackIgnore: true */` magic comment directly on the `import()` call,
the same fix the builder applies for the packages named in
`nativeDynamicImports`, written by hand because there is no third-party
module path to match against for a first-party computed import.[^module-catalogs]

Because a context-module rewrite here only breaks in the **built** bundle —
vitest runs the TypeScript source directly, so nothing in the unit or
integration suites, typecheck, or lint can see this class of failure —
`build:prod` runs `scripts/assert-native-dynamic-import.mjs` after every
build to check the shipped `dist/main.js` directly.[^assert-native-dynamic-import]
The script anchors on two things: a stable reachability marker
(`"fetchModuleCatalogs:"`, a string the module emits verbatim, proving the
call site survived minification and tree-shaking at all) and, more
precisely, the call site's own shape — every `pathToFileURL(...)` occurrence
in the bundle must be followed within a short window by a genuine
`await import(<identifier>)`, and none may be followed by rspack's
context-module rewrite pattern (`await l(5252)(t)`,
`__webpack_require__.t(`, or `webpackContext`).[^assert-native-dynamic-import]

## Alternatives rejected

- **Register `src/services/module-catalogs.ts`'s import path in
  `build.nativeDynamicImports`.** Not possible as stated: that option's
  matching only covers resolved `node_modules/<name>/` paths, so it
  structurally cannot target first-party source under `src/`.
- **Register `@effected/workspaces`' `ConfigDependencyHooks` loader in
  `build.nativeDynamicImports` "to be safe".** Actively wrong: the builder's
  ignore-loader throws when handed that file, so listing it fails the build
  rather than merely being redundant with the upstream fix already in place.
- **Anchor the build-time guard on the warning text `module-catalogs.ts`
  logs near the call site.** Tried and abandoned: that text sits roughly a
  hundred source lines from the actual call site — adjacent once minified,
  but thousands of characters away in an unminified `build:prod` bundle,
  where the guard then failed a build that was perfectly correct. The guard
  now anchors on the call site's own shape instead, which is a property of
  the code rather than of nearby prose.

## Consequences

- Deleting the inline `webpackIgnore` comment fails the build via
  `assert-native-dynamic-import.mjs`, by design — the failure mode it exists
  to catch is invisible everywhere except the shipped artifact.
- The guard's reachability anchor is a stable *prefix* of a log string
  (`"fetchModuleCatalogs:"`), not the full sentence, specifically so that
  rewording the surrounding warning text does not spuriously fail the build
  — see
  [a build guard anchored on prose reports the wrong cause](../gotchas/context-module-only-breaks-in-prod.md).
- If `@effected/workspaces`' `ConfigDependencyHooks` loader ever regresses
  and a "Critical dependency" warning naming that file reappears, the fix is
  upstream, not a new entry in `nativeDynamicImports` — that path is known to
  fail the build if attempted.

[^action-config]: `action.config.ts`
[^module-catalogs]: `src/services/module-catalogs.ts`
[^assert-native-dynamic-import]: `scripts/assert-native-dynamic-import.mjs`
[^effected-242]: <https://github.com/spencerbeggs/effected/issues/242>
