---
type: Glossary
title: proven-clean
description: The one peer-report state that gates positively — supported, no unresolved importers, nothing unverified, and no required rows — distinct from a bare "no required rows", which can also mean "not examined".
status: draft
tags:
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 40cdd8e477328362cdb8222bc0070d3eaa8c9a550724956c3c49eb06206ceeda
sources:
  - id: peers-util
    resource: ../../src/utils/peers.ts
---

# proven-clean

`decidePeerGate` returns `reason: "proven-clean"` only when **all four**
conditions hold at once: the lockfile format is `supported`, every importer
resolved (`!unresolvedImporters.length`), nothing came back `unverified`, and
`requiredCount` is zero.[^peers-util] It is the single reason value meaning
"examined, and found nothing" — every other reason (`unsupported`,
`unresolved-importers`, `unverified`, `required-unsatisfied`) withholds
auto-merge.

The term exists in this repository's own sense specifically because
`requiredCount === 0` alone does **not** mean the same thing: each of the
other three "not proven clean" conditions can independently produce zero
required rows for a reason that means "nothing was examined," not "nothing
was wrong" — an unsupported lockfile format, an importer that could not be
resolved, or a suppression-rules lookup that failed all report zero required
rows without proving anything. Collapsing that distinction — gating on
`requiredCount > 0` alone — was considered and rejected precisely because it
reads "not examined" as "clean." See
[the peer gate fails closed](../decisions/peer-gate-fails-closed.md).

[^peers-util]: `src/utils/peers.ts`
