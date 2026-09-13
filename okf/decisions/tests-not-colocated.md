---
type: Decision
title: Keep every unit suite under __test__/unit, mirroring src, never co-located
description: No .test.ts file lives beside its source; the mirror layout has a cost (a reserved-directory footgun that silently drops a suite from collection) but co-location had a worse one — importing a fixture module re-executed its tests.
status: draft
tags:
  - testing
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: d81a3b436b340a3c3e42226987c2e20ad36dd7240cfef39ff972d2b670f0ecf8
sources:
  - id: test-collection-test
    resource: ../../__test__/unit/test-collection.test.ts
  - id: doubles-test
    resource: ../../__test__/unit/doubles.test.ts
  - id: vitest-config
    resource: ../../vitest.config.ts
---

# Keep every unit suite under __test__/unit, mirroring src, never co-located

## Context

Every unit suite lives under `__test__/unit/`, mirroring the `src/`
directory it exercises; there are no `.test.ts` files beside their
sources. `__test__/utils/`, `__test__/unit/**/fixtures/` and
`__test__/unit/**/snapshots/` are reserved for helper modules, never for
suites. `vitest.config.ts` loads `@vitest-agent/plugin`, whose
`AgentPlugin.discover()` supplies the collected `projects` and excludes
files under those reserved directory names as a __direct child of
`__test__`__.[^vitest-config]

That installed exclusion rule is narrower than it first appears, and
getting the scope wrong has already cost a real suite. This repository's
own guard, `__test__/unit/test-collection.test.ts`, walks every
`*.test.ts` under `__test__` and rejects one whose path crosses a
reserved segment (`fixtures`, `snapshots`, `utils`) __at any depth__, not
only as a direct child of `__test__`.[^test-collection-test] That is
deliberately stricter than the installed plugin, whose actual behavior
was only settled by planting a probe `.test.ts` file and observing
`pnpm exec vitest list --filesOnly`: a probe under
`__test__/unit/steps/fixtures/` and one under `__test__/unit/utils/` are
both collected by the plugin, while one directly under
`__test__/fixtures/` is not. So the plugin's exclusion is
direct-child-only; this repository's own convention is any-depth, and
only the local guard enforces the stricter rule.

Co-location was tried and abandoned for a different, sharper reason than
directory naming: while suites lived beside their sources, importing a
`.test.ts` fixture module from another suite __re-executed every test in
that fixture module__, inside the importing file's run. A reported count
of 573 tests included 22 duplicate executions from exactly this pattern
— not 22 distinct tests, but the same 22 assertions counted twice because
two files imported the same fixture-carrying test module.

A related, quieter failure has also occurred under the mirror layout
itself: five suites covering `src/utils/` once lived at
`__test__/unit/utils/`, which matches the reserved segment `utils` and
was therefore silently excluded from collection. The total silently
dropped from 580 to 478 tests and the run stayed green, because the
aggregate coverage gate has no way to notice a suite that was never
collected in the first place. Those suites now live under
`__test__/unit/utilities/` — a directory name chosen specifically to not
collide with the reserved `utils` segment. Shared helper doubles
(`__test__/utils/action-doubles.ts`, `__test__/utils/fixtures.ts`) are
plain `.ts` modules with no `describe`/`it` of their own; their own
behavior is pinned instead by a discovered suite,
`__test__/unit/doubles.test.ts`, which imports them and asserts on their
round-trip and error-shape behavior directly rather than embedding tests
inside the reserved directory.[^doubles-test]

A related layout cleanup also removed a mirror violation of a different
kind: `__test__/unit/main.test.ts` sat in the right directory but named
the wrong module — it actually exercised `Report` and
`src/utils/markdown.ts`, not `src/main.ts`, which has no suite of its
own (it is a four-line guarded `Action.run(program)` wrapper; the
orchestration a reader would look for lives in
`__test__/unit/program.inner.test.ts`). Its 24 tests were redistributed
into `__test__/unit/services/report.test.ts` and a new
`__test__/unit/utilities/markdown.test.ts`, preserving every assertion
and restoring the mirror-matches-source property the misnamed file had
quietly broken.

## Decision

Every unit suite lives under `__test__/unit/`, mirroring `src/` one
level for one level, named for the module it exercises. Nothing under a
reserved directory name (`fixtures`, `snapshots`, `utils`) at __any__
depth may be a `.test.ts` file, enforced locally by
`__test__/unit/test-collection.test.ts` rather than relied upon from the
installed plugin's narrower rule. Shared helper code that several suites
need lives as plain `.ts` under `__test__/utils/`, and its own behavior
is verified by a discovered suite that imports it, not by tests embedded
inside it.

`__test__/unit/test-collection.test.ts` also guards against passing
vacuously: it asserts the file count it found is greater than 30 before
asserting the exclusion list is empty, so a walker that silently found
nothing cannot report success by finding nothing to reject.[^test-collection-test]

## Alternatives rejected

- __Co-locate `*.test.ts` beside its source module.__ Rejected on
  measured evidence, not preference: co-located fixture modules that
  other suites imported were re-executed by every importer, inflating
  the reported test count by real, non-distinct executions (22 out of a
  reported 573).
- __Trust the installed `@vitest-agent/plugin` exclusion rule as the
  sole guard against a suite landing in a reserved directory.__ Rejected
  because the plugin's rule is narrower (direct-child-only) than this
  repository's convention (any-depth), and relying on it alone would
  have let a suite under a nested `utils/` collect silently — the
  opposite of the intended reservation.
- __Name the utilities test directory `utils/` to match `src/utils/`.__
  Rejected precisely because that name is reserved; the suites that
  cover `src/utils/` live at `__test__/unit/utilities/` instead, which
  is the exact fix applied after the 580 → 478 silent drop.

## Consequences

- A test count is only meaningful once collection is independently
  confirmed: `pnpm exec vitest list --filesOnly` against `find __test__
  -name '*.test.ts'` is the check that a reported number reflects every
  file on disk, not merely every file the runner happened to pick up.
- Moving a suite between directories (as with the `main.test.ts` split,
  or the `utils/` → `utilities/` rename) is safe from re-execution
  duplication, because nothing under `__test__/unit/` imports another
  `.test.ts` file — only plain helper modules are shared, and those
  carry no tests of their own.
- The reserved-directory rule is a standing trap for a directory name
  chosen without checking it: `fixtures`, `snapshots` and `utils` are
  all plausible, ordinary names for a subdirectory holding suite support
  code, and every one of them silently drops any `.test.ts` placed
  inside.

See [the reserved-directory footgun this convention exists to
prevent](../gotchas/uncollected-test-suite.md), [the mirror-layout
convention in full](../conventions/test-layout.md), and [the measured
test-suite count and its accounting history](../measurements/test-suite-count.md).

## What would change the answer

If the installed test-collection plugin ever adopted the any-depth
exclusion rule itself, `__test__/unit/test-collection.test.ts` would
become redundant with the runner rather than stricter than it — worth
re-deriving with a fresh probe rather than assuming, since the plugin's
behavior is a property of a dependency this repository does not control.

[^test-collection-test]: `__test__/unit/test-collection.test.ts`
[^doubles-test]: `__test__/unit/doubles.test.ts`
[^vitest-config]: `vitest.config.ts`
</content>
