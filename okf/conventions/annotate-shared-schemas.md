---
type: Convention
title: Annotate every schema reused in more than one place with an explicit identifier
description: A Schema.Struct or Schema.Literals value referenced from two or more places in the result-output schema must carry an explicit `identifier` annotation, or the JSON Schema generator invents a positional name for it.
stale_after: 2027-03-12T00:00:00Z
tags:
  - observability
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: f237b98e4a3f0bba37d21bbaff1c47b5db75d650d8b6b6da7171cc4cd588a2eb
sources:
  - id: domain-schema
    resource: ../../src/schema/domain.ts
  - id: generate-schema
    resource: ../../lib/scripts/generate-schema.ts
  - id: generate-schema-test
    resource: ../../__test__/unit/generate-schema.test.ts
---

# Annotate every schema reused in more than one place with an explicit identifier

## Rule

Any `Schema.Struct` or `Schema.Literals` value in `src/schema/domain.ts` that
is referenced from more than one field must carry `.annotate({ identifier:
"…", title: "…" })`.[^domain-schema] Do this at the point the schema is
defined, not after generating the JSON Schema and noticing the result looks
wrong.

## Why

The generated `docs/schema/run-result.schema.json` is published at a public
`$id` and read by consumers outside this repository. Effect's JSON Schema
lowering hoists a schema used in more than one place into `$defs` and, when
that schema has no `identifier`, invents a *positional* name (`Union_`,
`Struct_`). Nothing fails when this happens — the document still validates —
but the name is an implementation-order accident rather than a stable
identifier: introducing a second anonymous union elsewhere in the schema
silently renumbers the first one (`Union_` → `Union_1`), which is a breaking
rename for any consumer that `$ref`s the key. `DependencyType`, referenced
from both `DependencyUpdateResult.type` and `LockfileChange.type`, is the
schema that first surfaced this and is the worked example: it now lowers to
`$defs/DependencyType` rather than `$defs/Union_`.[^domain-schema]

A `$defs` key matching `Union_`/`Struct_` (or any other positional pattern)
found in the generated output is a missing annotation at the definition
site — never an artifact to commit as-is.

Separately, and worth stating alongside this because the two are easy to
conflate: every struct in the generated schema is published **closed**
(`additionalProperties: false`). That closedness comes from an explicit
option on the generator's `SchemaTarget` (`jsonSchema: { onExcessProperty:
"error" }`), not from a default the lowering happens to choose — the
lowering's own default flipped to open (`"ignore"`) partway through this
project's Effect version history, and this repository crossed that boundary
in one dependency bump. If `pnpm generate-schema` ever rewrites every struct
to `additionalProperties: true`, the option was lost from
`lib/scripts/generate-schema.ts` and must be restored there; the fix is never
to commit the permissive output.[^generate-schema]

## How to check

1. Run `pnpm generate-schema` and diff `docs/schema/run-result.schema.json`.
   A `$defs` entry named `Union_`, `Union_1`, `Struct_`, or similar is a
   missing `identifier` on the schema hoisted at that position — add
   `.annotate({ identifier, title })` to it in `src/schema/domain.ts` and
   regenerate.
2. `__test__/unit/generate-schema.test.ts` imports the generator's own
   exported `targets` (not a copy) and asserts `wouldWrite === false` — a
   passing suite means the committed schema already matches what the current
   source would generate.[^generate-schema-test] A drift here is reported as
   either a `contract` change (a consumer-visible break, including a renamed
   `$defs` key) or an `annotations` change (documentation only); the
   generator's own diagnostic tells you which.
3. If `additionalProperties: true` appears anywhere in the generated file,
   check `jsonSchema: { onExcessProperty: "error" }` is still present on the
   `SchemaTarget` in `lib/scripts/generate-schema.ts` before assuming the
   schema itself changed.

See [the result output interface](../interfaces/action-outputs.md) for the
contract this schema publishes, and
[regenerate the result schema](../runbooks/regenerate-the-result-schema.md)
for the full regeneration procedure.

[^domain-schema]: `src/schema/domain.ts:10-84` (the `identifier`-annotation
  rule and the `DependencyType` example)
[^generate-schema]: `lib/scripts/generate-schema.ts` (`SchemaTarget` /
  `onExcessProperty`)
[^generate-schema-test]: `__test__/unit/generate-schema.test.ts`
