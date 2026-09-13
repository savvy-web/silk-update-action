---
type: Convention
title: Mirror src/ under __test__/unit/ and keep helpers out of reserved directories
description: Every unit suite lives under __test__/unit/ mirroring src/, never co-located; utils/, fixtures/ and snapshots/ are reserved for non-test helpers at any depth, enforced by this repo's own guard rather than the runner.
status: draft
stale_after: 2027-03-12T00:00:00Z
tags:
  - testing
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: f4bd3d7702d6faf598f4ff4f0a37ecf8e51dccdf8024502ee9e144c337112204
sources:
  - id: test-collection-test
    resource: ../../__test__/unit/test-collection.test.ts
  - id: doubles-test
    resource: ../../__test__/unit/doubles.test.ts
  - id: action-doubles
    resource: ../../__test__/utils/action-doubles.ts
  - id: vitest-config
    resource: ../../vitest.config.ts
---

# Mirror src/ under __test__/unit/ and keep helpers out of reserved directories

Place every unit suite under `__test__/unit/`, mirroring the path of the
`src/` module it tests — never as a `.test.ts` sibling of the source file.
Tests for `src/utils/*.ts` live under `__test__/unit/utilities/`, not
`__test__/unit/utils/` — the latter is a reserved directory name (see
below), so a suite placed there is silently never collected.

Treat `fixtures`, `snapshots` and `utils` as reserved directory names __at
any depth__ under `__test__` — never place a `*.test.ts` inside one, even
nested several levels down (e.g. `__test__/unit/steps/fixtures/…`). Put
shared helper modules (in-memory doubles, fixture data) as plain `.ts`
files in `__test__/utils/`, and pin their own behavior from a discovered
suite elsewhere — `__test__/unit/doubles.test.ts` exercises the doubles in
`__test__/utils/action-doubles.ts` from outside the reserved
directory.[^doubles-test][^action-doubles]

Name real-IO suites `*.int.test.ts` under `__test__/integration/`, script
subprocess commands with `@effected/commands`' public `ScriptedSpawner`
fixture rather than a hand-rolled spawner, and never mock `@actions/*` —
the kit implements the Actions protocol natively, so nothing here needs a
stand-in for it. Use `it.effect` only where it removes real ceremony (a few
suites do); leave every real-IO suite and most ordinary suites on plain
`vitest`, since `it.effect` would only obscure filesystem or git setup and
teardown there.

## Why

The installed test-collection plugin (`@vitest-agent/plugin`) excludes
only the __direct child__ of `__test__` named `utils`, `fixtures` or
`snapshots` — not the same name at a deeper nesting. This repository's own
convention is stricter than that: it treats the reserved names as excluded
at __any__ depth, which is fail-safe (it can only over-exclude, never
silently admit a test the runner would drop) and holds even if the plugin's
own rule changes in either direction.

The stricter rule is enforced by this repository's own guard —
`__test__/unit/test-collection.test.ts` — rather than by the runner, and
that distinction matters: nothing in the installed plugin will catch a
violation of the any-depth rule, only this repo's own test does. The stakes
for getting it wrong are real, not decorative: a suite silently excluded
from collection shrinks the total test count while every other signal stays
green, because the coverage gate is aggregate rather than per-file. Five
suites covering `src/utils/` once sat in the reserved `__test__/unit/utils/`
directory and stopped being collected; the total silently fell from 580
tests to 478 while the run kept reporting a pass.

## How to check

- Run `__test__/unit/test-collection.test.ts`; it walks `__test__`,
  asserts no `*.test.ts` crosses a reserved segment at any depth, and
  asserts it actually found something to check (so it cannot pass
  vacuously). Plant a `*.test.ts` under `__test__/unit/utils/` to confirm
  the guard fails and names the offending path.[^test-collection-test]
- Cross-check with `pnpm exec vitest list --filesOnly` against
  `find __test__ -name '*.test.ts'` — a mismatch means a suite the runner
  is not collecting, which the guard above should also have caught.
- Confirm `vitest.config.ts` still loads `@vitest-agent/plugin` via
  `AgentPlugin.discover()` for `projects`/`tags`, and that the plugin's own
  exclusion behavior (direct-child-only) is not being relied on in place
  of this repo's stricter guard.[^vitest-config]

See [tests are not co-located](../decisions/tests-not-colocated.md) for the
decision this convention implements, and
[an uncollected test suite looks like a pass](../gotchas/uncollected-test-suite.md)
for the failure mode this guards against.

[^test-collection-test]: `../../__test__/unit/test-collection.test.ts`
[^doubles-test]: `../../__test__/unit/doubles.test.ts`
[^action-doubles]: `../../__test__/utils/action-doubles.ts`
[^vitest-config]: `../../vitest.config.ts`
