---
type: Interface
title: Action outputs
description: The five action outputs, the every-exit-path guarantee, and the closed, generated JSON Schema for `result`.
kind: config
resource: ../../docs/schema/run-result.schema.json
status: draft
tags:
  - ci
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: c6204c4b072dadc67418c3b2b2a2133edbf0f4af5db7e1de0991672278a8dfb6
sources:
  - id: action-yml
    resource: ../../action.yml
  - id: outputs-ts
    resource: ../../src/schema/outputs.ts
  - id: domain-ts
    resource: ../../src/schema/domain.ts
  - id: generate-schema
    resource: ../../lib/scripts/generate-schema.ts
---

# Action outputs

## The five outputs

`action.yml` declares five outputs, mirrored as the `OUTPUT_NAMES` tuple in
`src/schema/outputs.ts` and checked against the manifest by a test, the same
mirror-as-data pattern the input contract uses.[^action-yml][^outputs-ts]

| Output | Contents |
| --- | --- |
| `pr-number` | The pull request number, or `""` when none exists |
| `pr-url` | The pull request URL, or `""` |
| `updates-count` | The number of dependencies updated, as a string |
| `has-changes` | `"true"` / `"false"` — whether a commit was made and a PR opened |
| `result` | The whole run as one JSON document — see below |

`emitOutputs` writes all five at once, so a caller cannot publish a partial
set: the failure it exists to prevent is an output the manifest declares and
the run never sets, which a consuming workflow then reads as an empty string
rather than as the value the action would have chosen.[^outputs-ts]

## Every output has a value on every exit path

The baseline (`initialOutputs`) is published as the **first statement** of
the program, before `readInputs` or any work — not from a failure handler.
This guarantees every declared output has a value on every exit path,
including a failure inside `readInputs` itself, the earliest thing that can
abort the run.[^outputs-ts]

The alternative — re-emitting the baseline from an error handler — was
rejected: a handler that re-emits also *overwrites* anything a step already
published, so a run that opened a PR and then failed later would falsely
report `pr-number: ""` and `has-changes: false`. Writing the baseline first
and letting steps refine it gives the same total-coverage guarantee without
ever contradicting work that actually happened. See
[Emit the output baseline first](../decisions/emit-output-baseline-first.md).

## `result` is always parseable

`result`'s baseline is a full **empty-run document, not an empty string**
(`emptyRunResult`), so a consumer can call `fromJSON(...)` on it
unconditionally rather than guarding for an unparseable value — the same
defect class as an unset scalar output wearing a different hat.[^outputs-ts]
`packageManager: null` in that baseline is a genuine absence, not a
placeholder: a run that ended before detection has no package manager, and a
value that decodes, serializes, and is falsy would be worse than an absent
one, since a consumer branching on it could not tell it was branching on a
lie.[^domain-ts]

`result`'s shape is `RunResultDocument` (`schemaVersion: 2`), composed
entirely from the schemas the run already produces — `DependencyUpdateResult`,
`CatalogDelta`, `PeerIssue`, `LockfileChange`, `ChangesetFile`,
`PullRequestResult` — rather than restated in a parallel reporting shape, so
the `result` output and the PR body cannot disagree about what
happened.[^domain-ts] See
[Domain schemas](../models/domain-schemas.md) for the field-by-field shape.

## The generated JSON Schema is closed, on purpose

`docs/schema/run-result.schema.json` is generated from `RunResultDocument`
by `lib/scripts/generate-schema.ts` via `@effected/schemastore`'s
`SchemaPipeline` (structural lint, an ajv strict-mode gate, and a
write-only-if-content-differs pass).[^generate-schema] Every struct lowers to
a **closed** object (`additionalProperties: false`). That closedness is an
explicit option on the generator's `SchemaTarget`
(`jsonSchema: { onExcessProperty: "error" }`), not a default the lowering
supplies on its own — core flipped its own default to permissive
(`"ignore"`) at `effect@4.0.0-rc.113`, and losing the option would silently
loosen the contract `schemaVersion`'s own description states about
itself.[^domain-ts] Regenerate with `pnpm generate-schema`; see
[Regenerate the result schema](../runbooks/regenerate-the-result-schema.md).

**Every schema shared by more than one struct field needs an explicit
`identifier` annotation.** The lowering hoists a repeated sub-schema into
`$defs` and, with no identifier to use, invents a positional name
(`Union_`, `Struct_`) — nothing fails, but a document published at a public
`$id` then carries an unstable, unannounced key, and a second anonymous
union silently renumbers the first. `DependencyType` and `PeerIssue` both
carry explicit `identifier` annotations for exactly this reason.[^domain-ts]

A drift test imports the generator's own `targets` constant and runs
`SchemaPipeline.check` — the identical walk without writing — so a test that
rebuilt its own target list independently could pass while the generator
wrote something different; importing the same constant is the point.

[^action-yml]: `../../action.yml`
[^outputs-ts]: `../../src/schema/outputs.ts`
[^domain-ts]: `../../src/schema/domain.ts`
[^generate-schema]: `../../lib/scripts/generate-schema.ts`
