---
type: Gotcha
title: An excluded test file is silently never collected — the suite shrinks and stays green
description: A *.test.ts placed under a reserved helper directory name is dropped from the run with no error and no warning; the total drops and the aggregate coverage gate has no way to notice.
status: draft
stale_after: 2027-03-13T00:00:00Z
tags:
  - testing
resource: ../../__test__/unit/test-collection.test.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: c4cde9b5cc307357314646091ee17929d4b112584d624e19cd5997a08119c92e
sources:
  - id: test-collection-test
    resource: ../../__test__/unit/test-collection.test.ts
  - id: vitest-config
    resource: ../../vitest.config.ts
---

# An excluded test file is silently never collected — the suite shrinks and stays green

## What you see

The full suite runs and passes. Nothing in its output — no warning, no
skipped-test line, no non-zero exit — distinguishes a run over every
`*.test.ts` file on disk from a run over a subset of them.

## What you will wrongly conclude

That a green run with a plausible-looking test count means every
`*.test.ts` file under `__test__` was collected and executed.

## What is actually true

The installed `@vitest-agent/plugin` (via `AgentPlugin.discover()`,
`vitest.config.ts`) reserves the directory names `fixtures`, `snapshots`
and `utils` for non-test helpers, and excludes a `*.test.ts` matching one
of those names from collection entirely — silently, with no diagnostic.
A test placed there does not fail; it simply never runs, so the suite's
total shrinks while every other signal (exit code, coverage percentage)
stays green, because the coverage gate is aggregate rather than per-file
(see [a green coverage run is not evidence a module is exercised](aggregate-coverage-gate.md)).

**Exactly this happened once**: five suites covering `src/utils/`
(covering `resolveTargetBranch`, catalog helpers, `buildUpdateSubject`,
the `devEngines.runtime` helpers and the semver range helpers) sat under
a directory literally named `utils`, and the reported total silently fell
from 580 tests to 478 while the run kept reporting a pass.

**The scope of the plugin's own exclusion rule is narrower than it looks,
and this is the part worth being precise about.** Measured by planting a
`probe.test.ts` file and reading `pnpm exec vitest list --filesOnly`
rather than by reading the plugin's source: a probe under
`__test__/unit/steps/fixtures/__probe__/` is **collected**, one under
`__test__/unit/utils/__probe__/` is also **collected**, and only one
placed directly under `__test__/fixtures/__probe__/` is **excluded**. So
the installed plugin excludes only a **direct child of `__test__`**, not
a reserved name at any nesting depth — and a package this repository
previously cited for a broader any-depth rule, `@vitest-agent/sdk`, is
not even installed here (only `cli`, `mcp` and `plugin` are).

That measurement leaves the 580 → 478 incident's actual mechanism
**unexplained, not confirmed**. The five suites lived at
`__test__/unit/utils/` — one level *under* `unit`, not a direct child of
`__test__` — so under the rule as measured today, the installed plugin
would have **collected** them, not excluded them. Either the plugin's
behavior has changed since that incident, or something else caused the
drop; nobody has re-derived which. Do not cite that incident as
confirming evidence for the any-depth exclusion rule — it is evidence
that a silent drop of this shape is possible and costly, not evidence for
which rule produced it.

What *is* verified and load-bearing: this repository's own guard,
`__test__/unit/test-collection.test.ts`, applies the stricter **any-depth**
rule itself, rejecting a `*.test.ts` under a reserved segment at any
nesting rather than only as a direct child of `__test__`.[^test-collection-test]
That is deliberately fail-safe — it can only over-exclude relative to the
installed plugin, never admit something the plugin would have dropped —
and it holds regardless of which way the plugin's own rule points on a
future dependency bump.

## How to check

- Run `pnpm exec vitest list --filesOnly` and count the lines; separately
  run `find __test__ -name '*.test.ts' | wc -l`. A mismatch between the
  two means a file on disk the runner is not collecting.
- Re-derive the plugin's actual exclusion scope by planting a probe file
  rather than reading its source or trusting a prior write-up — the
  behavior is a property of an installed dependency this repository does
  not control and can change on a bump.
- Trust `__test__/unit/test-collection.test.ts` as the operative guard for
  this repository's convention, not the installed plugin's rule; it also
  asserts it found more than 30 files, so it cannot pass vacuously by
  finding nothing to reject.[^test-collection-test]

See [tests are not co-located](../decisions/tests-not-colocated.md) for the
decision this guards, and
[the test-layout convention](../conventions/test-layout.md) for the
convention it enforces.

[^test-collection-test]: `__test__/unit/test-collection.test.ts`
