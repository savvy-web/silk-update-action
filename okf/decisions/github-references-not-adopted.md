---
type: Decision
title: Do not adopt @effected/github-references — there is no call site for it
description: The issue-reference-parsing package arrives transitively already; this action has nothing to parse or write, because a dependency-update run closes no issues.
status: draft
tags:
  - deps
  - bundle
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 6a031e231c3f2833e5601b7939ba0da190f71cec0ad4a4e66c7cf3566d410c92
sources:
  - id: report-service
    resource: ../../src/services/report.ts
  - id: github-references-npm
    resource: "npm:@effected/github-references"
  - id: silk-release-worked-example
    resource: "https://github.com/savvy-web/silk-release-action"
---

# Do not adopt @effected/github-references — there is no call site for it

## Context

`@effected/github-references` is a reference-parsing grammar: harvest
`Closes #N` from prose, read a bare-line or comma-separated closing list
out of a commit or PR body. It was considered for adoption alongside
other kit packages during a dependency wave.

This action neither reads nor writes issue references. `Report`'s PR-body
builder calls `PrBody.ManagedPrBody.build` with `linkedIssues: []` on
every invocation[^report-service] — a dependency-update run has nothing
to close, so there is no prose to harvest and no list to
render.[^github-references-npm]

The package already arrives in the dependency graph without being
adopted directly: `@savvy-web/silk-effects` backs its own bare-line
reference parsing with it, and `@effected/github` moved the grammar into
it and re-exports the original names for backward compatibility. That
re-export is documented upstream as droppable at a later release.

## Decision

Do not add a direct dependency on `@effected/github-references`, and do
not add a call site for it. If a call site ever appears — this action
learning to close a tracked issue from an `upgrade-package-manager` run
is the plausible trigger — import `@effected/github-references` directly
rather than through the `@effected/github` re-export, because the
`@effected/github` surface deliberately omits the newer closing-list
dialect the standalone package supports.

`silk-release-action`'s `link-issues-from-commits.ts` is the worked
example to start from for that future call site: it uses
`collectReferenceLists` rather than the older `harvestIssueReferences`,
because the latter reads a list like `Closes #247, #248 and #251` as
only `#247` — a defect the newer entry point does not have.[^silk-release-worked-example]

## Alternatives rejected

- **Adopt it now for future-proofing.** Rejected: there is no call site
  to justify the dependency today, and adopting a package with nothing
  calling it is exactly the shape this action's own dependency audits
  exist to catch and remove elsewhere.
- **Keep using the `@effected/github` re-export if a call site ever
  appears.** Rejected in advance, because the re-export's grammar is
  known to be narrower (no closing-list support) than the standalone
  package's, and the compatibility re-export is documented as temporary
  upstream.

## Consequences

- This action carries no direct dependency on
  `@effected/github-references` and no code that parses or emits
  `Closes #N`-style references.
- The package is present in the installed tree regardless, pulled in
  transitively by `@savvy-web/silk-effects` and `@effected/github` — its
  absence from this action's own dependency list should not be read as
  its absence from `pnpm-lock.yaml`.

## What would change the answer

This action gaining a reason to close an issue automatically — most
plausibly an `upgrade-package-manager` run that resolves a tracked
dependency ticket — is the condition that would justify a direct
dependency and a call site, using `collectReferenceLists` as the entry
point.

[^report-service]: `src/services/report.ts`
[^github-references-npm]: `@effected/github-references` on npm
[^silk-release-worked-example]: `savvy-web/silk-release-action`, `link-issues-from-commits.ts`
</content>
