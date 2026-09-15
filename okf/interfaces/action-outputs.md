---
type: Interface
title: Action outputs
description: The five action outputs, the every-exit-path guarantee, and the closed, generated JSON Schema for `result`.
kind: config
resource: ../../schemas/5.0/output.json
status: draft
tags:
  - ci
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-15T18:43:07Z
  body_sha256: 9edd06388ecfe358287df8a2d012469786ea19342cc130a3dd223212b116de90
sources:
  - id: action-yml
    resource: ../../action.yml
  - id: outputs-ts
    resource: ../../src/schema/outputs.ts
  - id: domain-ts
    resource: ../../src/schema/domain.ts
  - id: schemastore-config
    resource: ../../lib/scripts/schemastore.config.ts
  - id: hosted
    resource: ../../src/schema/hosted.ts
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

`result`'s shape is `RunResultDocument`, composed
entirely from the schemas the run already produces — `DependencyUpdateResult`,
`CatalogDelta`, `PeerIssue`, `LockfileChange`, `ChangesetFile`,
`PullRequestResult` — rather than restated in a parallel reporting shape, so
the `result` output and the PR body cannot disagree about what
happened.[^domain-ts] See
[Domain schemas](../models/domain-schemas.md) for the field-by-field shape.

## The generated JSON Schema is closed, on purpose

`schemas/5.0/output.json` is generated from `RunResultDocument` by the
`schemastore` CLI (`@effected/schemastore-cli`) reading
`lib/scripts/schemastore.config.ts` (structural lint, an ajv strict-mode
gate, and a write-only-if-content-differs pass).[^schemastore-config] Every
struct lowers to a **closed** object (`additionalProperties: false`) — the
library's default lowering, which is stricter than core's. Adding a field is
therefore a breaking change for a consumer validating against a pinned
document, which is why the label is the action's **next major**.

The document names its own schema: `$schema` is a `Schema.Literal` of
`SCHEMA_URL`, and `SCHEMA_URL` is `OutputSchemaIdentity.$id` — the
`HostedSchema` built once in `src/schema/hosted.ts` and handed to the config
as `hosted`. That is the only place the repository, path and label
(`SCHEMA_VERSION = "5.0"`) are spelled; the `$id` the CLI writes and the URL
every payload carries are one derivation.[^hosted] There is no in-band
`schemaVersion` field: the version is in the URL. Rebuild with
`pnpm schema:build`; see
[Rebuild the result schema](../runbooks/rebuild-the-result-schema.md).

**Every schema shared by more than one struct field needs an explicit
`identifier` annotation.** The lowering hoists a repeated sub-schema into
`$defs` and, with no identifier to use, invents a positional name
(`Union_`, `Struct_`) — nothing fails, but a document published at a public
`$id` then carries an unstable, unannounced key, and a second anonymous
union silently renumbers the first. `DependencyType` and `PeerIssue` both
carry explicit `identifier` annotations for exactly this reason.[^domain-ts]

`pnpm schema:check` is the whole drift guard: `ci:test` runs it before
vitest, and turbo's `build:prod` depends on `schema:build`, so a stale
document can neither pass CI nor ship inside `dist/`. There is no separate
drift test — the identity is handed to the config as a value, so a
"derived `$id` equals the constant" assertion has nothing to check.

Before `result` is set, `emitRunResult` (`src/schema/outputs.ts`) encodes
the document through `RunResultDocument` and prints it pretty inside a
collapsed `Structured result output` log group, then sets it through
`setJson` with the same codec — so what the log shows is what the runner
stores.[^outputs-ts]

[^action-yml]: `../../action.yml`
[^outputs-ts]: `../../src/schema/outputs.ts`
[^domain-ts]: `../../src/schema/domain.ts`
[^schemastore-config]: `../../lib/scripts/schemastore.config.ts`
[^hosted]: `../../src/schema/hosted.ts`
