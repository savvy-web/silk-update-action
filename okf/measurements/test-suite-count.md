---
type: Measurement
title: Test suite count and its accounting history
description: The suite's test count across a sequence of changes, with each delta explained rather than merely observed — because an unexplained delta in either direction has twice been evidence of a real problem rather than noise.
status: draft
stale_after: 2026-12-13T00:00:00Z
tags:
  - testing
justifies:
  - ../decisions/tests-not-colocated.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 760ba9873e26cf82e2eb46b232da5a0c90362ef618cedc288c09259dc70b5a67
sources:
  - id: vitest-config
    resource: ../../vitest.config.ts
  - id: test-collection-test
    resource: ../../__test__/unit/test-collection.test.ts
---

# Test suite count and its accounting history

## Inputs

The full unit suite under `__test__/unit/**` and `__test__/integration/**`,
run via `pnpm vitest run`; the file list from `pnpm exec vitest list
--filesOnly`; and the file list from `find __test__ -name '*.test.ts'`.

## Method

`pnpm vitest run` for the pass/fail/file totals; `pnpm exec vitest list
--filesOnly` for the set of files the runner actually collected;
`find __test__ -name '*.test.ts'` for the set of files that exist on disk.
The second pair matters as much as the first: a test count alone cannot show
whether a suite was silently excluded from collection, only whether the
suites that *were* collected passed.

## Numbers

The accounting table below is the recorded history, kept because a test-count
delta in either direction has twice been the actual symptom of a real
problem rather than incidental noise:

| count | context | how it was established |
| --- | --- | --- |
| 580 | historical | recorded, not independently re-verified here |
| 581 | recorded at one point | **never actually measured — wrong when written** |
| 588 | the tree at the same commit the 581 figure claimed | `pnpm vitest run`, 40 files |
| 589 | one layer-guard suite added | `pnpm vitest run`, 41 files |
| 599 | before the peer-check work | `pnpm vitest run`, 42 files |
| 634 | after the peer-check work | `pnpm vitest run`, 44 files |
| 645 | inferred arithmetic, not a fresh measurement | not independently re-run |
| 648 | after the peer-gate false-positive fixes | `pnpm vitest run`, 44 files |
| 643 | after an upstream-adoption pass (net −5) | `pnpm vitest run`, 44 files |
| 643 | after a layout split, **0 net change**, 44 files both before and after | `pnpm vitest run`, 44 files |

**2026-09-13 re-measurement (this pass):**

- `pnpm exec vitest list --filesOnly` → **44** files collected.
- `find __test__ -name '*.test.ts' | wc -l` → **44** files on disk.
- The orchestrator's most recent full run for this session recorded **643
  passed, 0 failed, 44 files** — not re-run here, per instruction, since a
  fresh run was already on record for today.

The file counts match (44 = 44), which is the necessary check for the 643
figure to mean what it claims: every `.test.ts` file on disk was actually
collected, none silently excluded.

## What this rules in and out

- **Rules out:** trusting a test count that "did not move" as evidence that
  nothing happened. The 643 → 643 transition in the table above carries **0**
  net change in both the test count and the file count, and still represents
  real work — a misnamed file (`main.test.ts`, which never actually exercised
  `src/main.ts`) was deleted and its 24 tests were redistributed into two
  correctly-named files in the same pass. A stable total is compatible with a
  meaningful restructure; it is not evidence that no restructure occurred.
- **Rules out:** treating a *drop* in count as automatically explainable by
  "cleanup." The 581 figure in this table's history was **never measured** —
  it was written down as a plausible increment in the very commit that made
  it wrong, and it stood for a full release cycle before being caught. A
  count that decreases needs the same scrutiny as one that increases.
- **Rules in:** collection has to be checked independently of the pass/fail
  total. This repository has previously lost five suites entirely (a
  documented 580 → 478 drop) by placing them under a reserved directory name
  the collection plugin silently excludes — the run stayed green throughout,
  because the aggregate coverage gate has no way to notice a suite that was
  never collected. The two-file-count comparison in this measurement (vitest's
  own list against a plain `find`) is the check that would have caught it.
- **Does not establish:** that 643 is a stable steady state. It is a snapshot
  as of 2026-09-13, and the historical table above shows this number has
  changed at nearly every commit that touched test files.

Re-derive with `pnpm vitest run` for the pass/fail total and
`pnpm exec vitest list --filesOnly` compared against
`find __test__ -name '*.test.ts' | wc -l` for collection integrity; never
carry either the table above or this pass's numbers forward without
re-running both.

See [tests stay mirrored, never co-located](../decisions/tests-not-colocated.md)
for the layout convention this measurement justifies, and
[the uncollected-test-suite gotcha](../gotchas/uncollected-test-suite.md) for
the mechanism behind the 580 → 478 incident.
