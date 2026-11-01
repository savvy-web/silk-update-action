# \_\_test\_\_/

The test suites. This file routes into the `okf/` bundle; it does not restate
it.

## The collection contract

A `*.test.ts` under a directory named `utils/`, `fixtures/` or `snapshots/`, at
any depth, is **never collected** — no error, no warning, the suite just
shrinks and stays green. Unit suites live under `unit/`, mirroring `src/` one
level for one level; tests for `src/utils/` go in `unit/utilities/`, not
`unit/utils/`. See [`okf/conventions/test-layout.md`](../okf/conventions/test-layout.md)
and [`okf/gotchas/uncollected-test-suite.md`](../okf/gotchas/uncollected-test-suite.md).

## Before you trust a green run

| Concern | Read |
| --- | --- |
| Coverage is an aggregate gate, not per-file | [`okf/gotchas/aggregate-coverage-gate.md`](../okf/gotchas/aggregate-coverage-gate.md) |
| A double richer or stricter than production | [`okf/gotchas/double-more-capable-than-production.md`](../okf/gotchas/double-more-capable-than-production.md) |
| Runner env leaking into a fixture | [`okf/gotchas/runner-env-leaks-into-tests.md`](../okf/gotchas/runner-env-leaks-into-tests.md) |
| A layer you forgot to provide | [`okf/gotchas/unprovided-service-is-not-a-type-error.md`](../okf/gotchas/unprovided-service-is-not-a-type-error.md) |

Re-derive a test count with `pnpm vitest run`; never carry one forward.
