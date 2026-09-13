---
type: Gotcha
title: A miscompiled computed dynamic import passes every check except the built bundle
description: rspack rewriting a runtime-computed import() into a webpack context module typechecks, lints, and passes the whole vitest suite, because vitest runs the TypeScript source rather than dist/main.js — the failure exists only in the artifact nothing but a build-time script inspects.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - bundle
  - ci
resource: ../../action.config.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: f9b9081d1d38767112841d76ede189eea3e42feceb0288670e27cb4c4391ef68
sources:
  - id: action-config
    resource: ../../action.config.ts
  - id: assert-script
    resource: ../../scripts/assert-native-dynamic-import.mjs
  - id: module-catalogs
    resource: ../../src/services/module-catalogs.ts
---

# A miscompiled computed dynamic import passes every check except the built bundle

## What you see

`pnpm typecheck` is clean, `pnpm lint` is clean, and the full vitest suite
passes — including any test that exercises `fetchModuleCatalogs` in
`src/services/module-catalogs.ts`, which loads a config dependency's
extracted tarball entry via a runtime-computed `import()`.[^module-catalogs]
Nothing in that green signal says whether the shipped action can actually
load a config dependency's plugin.

## What you will wrongly conclude

That a green typecheck, lint, and test run is sufficient evidence the build
is correct, and that `build.nativeDynamicImports` in `action.config.ts` is
either unnecessary here or interchangeable with an inline comment at the
call site.

## What is actually true

`src/services/module-catalogs.ts`'s `import()` argument is a path computed at
runtime — the directory `@effected/npm`'s `PackageTarball.extract` produced —
not a static string literal, and it never resolves under
`node_modules/<name>/`, so the bundler's `nativeDynamicImports` list cannot
target it structurally even if you list it: that option only matches
resolved paths under `node_modules`.[^action-config] Left undeclared to any
mechanism, rspack compiles a computed `import()` into a **context module** — a
build-time directory glob keyed by the runtime value — which throws `Cannot
find module 'file:///…'` **at runtime**, on the real bundled artifact, even
though the target file genuinely exists on disk.[^assert-script]

That failure is invisible to every check except the built bundle. `vitest`
runs the TypeScript source directly, not `dist/main.js`, so a context-module
regression in the bundler's handling of this call site produces **zero**
failing tests. Typecheck and lint operate on source too. The only thing that
can see the miscompilation is a script that reads the actual bundled output
and looks for the difference between a genuine `await import(<identifier>)`
and rspack's numbered context-module call
(`await l(5252)(t)`).[^assert-script] `scripts/assert-native-dynamic-import.mjs`
is that script, run on every `build:prod` invocation (`pnpm build`,
`pnpm build:prod`, `pnpm ci:build`, and CI's build step all route through
it).[^assert-script]

The guard itself has already needed correcting once, in a way worth knowing
before trusting it: it originally anchored its "is this module even still
reachable" check on the **full text of a warning string** emitted nearby in
the same module. Rewording that warning during an unrelated adoption failed
the build with `could not find module-catalogs in dist/main.js` — the module
was fine, only a sentence near it had changed. The anchor is now a short,
stable prefix (`fetchModuleCatalogs:`) rather than the whole message, because
prose is the one part of a module guaranteed to change without the module's
behavior changing.[^assert-script]

## How to check

- Never treat `pnpm typecheck` / `pnpm lint` / `pnpm test` passing as evidence
  about this call site — none of them touch `dist/main.js`.
- Run `pnpm build:prod` (or any command that invokes it) and confirm
  `scripts/assert-native-dynamic-import.mjs` prints its success line rather
  than failing; that script is the only signal that inspects the artifact
  itself.
- If the guard ever fails with "could not find module-catalogs", the module
  is probably fine and the `ANCHOR` string in the script is stale relative to
  a wording change in `src/services/module-catalogs.ts` — update the anchor
  to a short, stable substring rather than the whole sentence.
- See
  [a first-party computed dynamic import stays local](../decisions/dynamic-import-stays-local.md)
  for why this call site cannot be declared to `nativeDynamicImports` and
  instead carries its own inline `webpackIgnore` comment.

[^action-config]: `../../action.config.ts`
[^assert-script]: `../../scripts/assert-native-dynamic-import.mjs`
[^module-catalogs]: `../../src/services/module-catalogs.ts`
