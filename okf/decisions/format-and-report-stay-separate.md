---
type: Decision
title: Keep the run's log rendering and the PR's report rendering as two separate modules
description: format.ts renders the run's log output and report.ts renders the PR body, summary and commit message — two named rendering modules split by sink, not a rule violated by having two.
status: draft
tags:
  - architecture
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 1649b9a806879b7c0c6e91f453d263dc06a99e5a33b529e72f1928a9103e06c3
sources:
  - id: format
    resource: ../../src/format.ts
  - id: report
    resource: ../../src/services/report.ts
---

# Keep the run's log rendering and the PR's report rendering as two separate modules

## Context

This action has one rule about human-readable output: the same fact must
never be worded two different ways in two different places. `format.ts`'s
own doc comment states the rule directly and points at
`formatCatalogCounts` / `formatCatalogCountsCompact` — the same catalog tally
rendered for two audiences, deliberately kept side by side so the
duplication stays visible rather than drifting apart silently.[^format] That
rule could be read as an argument for one rendering module. It is
not — the module boundary that already exists is what the rule intends.

## Decision

Two named rendering modules, split by sink, not by developer convenience:

| | `format.ts` | `services/report.ts` |
| --- | --- | --- |
| sink | the runner log / decision record | the PR body, job summary, commit message |
| lifetime | written once, scrolls | upserted and re-rendered across runs |
| shape | pure functions, no services | a `Context.Service` over `PullRequest` |

`format.ts` is pure and service-free: every export is a function from data to
a string or an array of strings, so every line is testable without a
runtime.[^format] It owns the opening "Run context" block, the closing
"Result" block (including the skipped-step summary — a step that did not run
must always say so, because silence there reads as "ran and found nothing"),
and the catalog-delta tallies rendered at two verbosities for two audiences —
the config-dependency step log and the closing Result block.[^format]

`report.ts` is a `Context.Service` over `@effected/github`'s `PullRequest`,
because generating the PR body and summary needs the PR's identity and the
DCO sign-off resolved once from the persisted App token — state a pure
function cannot carry.[^report] Merging the two modules would either drag
that service dependency into what is otherwise a pure module, or strand
`Report`'s own statics without a home.

Authority over exact wording is also split, deliberately, along the same
line: `program.inner.test.ts` asserts on the literal log text `format.ts`
produces and is authoritative over it, while `format.test.ts` asserts the
*shape* of the decision record rather than its exact wording. A wording
change should fail the suite that models the log as a contract, not both
suites at once.

The one function that used to live in `format.ts` for cross-checking the
package-manager decision — `describePmEvidence`, a best-effort re-derivation
of which detection signal had decided the run, explicitly documented as *not*
a source of truth — is now gone entirely rather than merely relocated.
`@effected/workspaces@0.13.0`'s `DetectedPackageManager` carries the deciding
marker itself, so the step forwards `detected.evidence` and there is nothing
left to re-derive; deleting the re-derivation also removed this module's only
raw `node:fs` import.[^format]

## Alternatives rejected

- **One rendering module for both the log and the PR.** Rejected: the two
  sinks have different lifetimes (a log line is written once and scrolls; a
  PR body is upserted and re-rendered on every run against the same PR) and
  different dependency needs (the PR body needs `PullRequest` state; the log
  needs none). Folding them together would make the pure half impure or leave
  the stateful half's statics orphaned.
- **Re-derive the package-manager evidence locally, forever.** This is what
  `describePmEvidence` did, and it is rejected now that the underlying
  library carries the real answer: a locally re-implemented priority order
  can only approximate the detector's actual decision, and its own doc
  comment already conceded it was not authoritative.

## Consequences

- A change to the run's log wording is reviewed and tested against
  `format.test.ts` (shape) and `program.inner.test.ts` (exact text); a change
  to the PR body or commit message is reviewed and tested against
  `report.ts`'s own suite. Neither should need to touch the other.
- Any future fact that needs rendering into *both* the log and the PR (a
  catalog delta is the current example) has to be computed once and handed to
  both renderers rather than recomputed twice — the risk the single-rendering
  rule exists to prevent applies across the module boundary, not only within
  each module.

[^format]: `src/format.ts`
[^report]: `src/services/report.ts`
