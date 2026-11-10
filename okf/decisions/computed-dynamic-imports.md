---
type: Decision
title: A computed dynamic import relies on rolldown keeping it native, with no annotation and no post-build guard
description: "effected action build bundles with rolldown, which leaves every import() whose specifier is computed at runtime as a native import, so the action's computed imports carry no magic comment, the build declares no nativeDynamicImports list, and no script re-checks dist/main.js for a rewrite."
status: draft
supersedes: dynamic-import-stays-local.md
tags:
  - bundle
generated:
  by: okfit/claude-code
  at: 2026-11-10T18:07:49Z
sources:
  - id: effected-toml
    resource: ../../effected.toml
  - id: module-catalogs
    resource: ../../src/services/module-catalogs.ts
  - id: package-json
    resource: ../../package.json
  - id: dist-main
    resource: ../../dist/main.js
  - id: effected-bundler
    resource: "npm:@effected/bundler@0.3.0"
integrity:
  generated:
    body: dfe84cfa7850164b
---

# A computed dynamic import relies on rolldown keeping it native, with no annotation and no post-build guard

## Context

This action ships as a bundled `dist/{pre,main,post}.js`, built by
`effected action build` from `@effected/plugin`, which reads the `[action]`
tables of `effected.toml` and bundles with rolldown through
`@effected/bundler`.[^package-json][^effected-toml] Two `import()` calls whose
specifier is computed at runtime are reachable from `dist/main.js`:
`@changesets/apply-release-plan` loading the configured changelog module, and
`src/services/module-catalogs.ts` loading a config dependency's extracted
tarball entry from the temp directory `@effected/npm`'s
`PackageTarball.extract` produced.[^effected-toml][^module-catalogs]

Rolldown has no context-module rewrite: it leaves an `import(expr)` with a
non-literal specifier as a native `import()` in the output, and
`@effected/bundler` enables neither of rolldown's opt-in plugins that would
rewrite one (`dynamicImportVars`, `importGlob`).[^effected-bundler] In the
rebuilt `dist/main.js` both call sites are native — `await import(e)` for the
changelog load and `await import(se(x(e,t)).href)` for the module-catalogs
load — and the bundle contains no `webpackContext` or `__webpack_require__`
reference.[^dist-main] The superseded choice — an inline
`/* webpackIgnore: true */` comment plus a post-build
`assert-native-dynamic-import.mjs` guard — existed because the previous
rspack-based builder did rewrite such calls into context modules that threw
`Cannot find module 'file:///…'` at runtime.

## Decision

Rely on rolldown keeping a computed `import()` native. `effected.toml`'s
`[action.build]` carries no `nativeDynamicImports` key, the module-catalogs
call site carries no magic comment, and `build:prod` is `effected action
build` alone, with no post-build script inspecting the bundle for a
rewrite.[^effected-toml][^module-catalogs][^package-json]

The one thing a call site must keep is a computed specifier: a string-literal
`import("pkg")` is resolved and bundled by rolldown rather than left
native.[^module-catalogs]

## Alternatives rejected

- **Rewrite the post-build guard to match rolldown's output shape.**
  Rejected: the old guard anchored on rspack's call-site shape and failed
  against rolldown's renamed, inlined call site even though the import was
  native. Re-anchoring it would assert something the bundler guarantees by
  construction — rolldown has no rewrite for it to catch — and the guard would
  break again on the next change to minified naming without having caught a
  real fault.
- **Keep the `/* webpackIgnore: true */` comment on the call site.**
  Rejected: it is a webpack and rspack directive and inert under rolldown, so
  it would document a hazard this build does not have.

## Consequences

- A green `pnpm typecheck`, `pnpm lint`, and vitest run still say nothing
  about `dist/main.js`, since vitest runs the TypeScript source; what changed
  is that the build itself no longer has a transformation that could break a
  computed import.[^dist-main]
- If `@effected/bundler` ever enables `dynamicImportVars` or `importGlob`, or
  the action moves to a bundler with a context-module rewrite, this decision
  no longer holds and the computed call sites need re-checking against the
  built `dist/main.js`.[^effected-bundler]
- The subprocess config-dependency loader
  (`layerWithConfigDependenciesSubprocess`) was adopted to avoid the same
  rspack rewrite; it stays for a different reason, recorded in
  [release-age discovery fails open](release-age-fail-open.md).

[^effected-toml]: `effected.toml`
[^module-catalogs]: `src/services/module-catalogs.ts`
[^package-json]: `package.json`
[^dist-main]: `dist/main.js`
[^effected-bundler]: `npm:@effected/bundler@0.3.0`
