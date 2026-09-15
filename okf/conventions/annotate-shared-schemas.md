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
  at: 2026-09-15T18:43:07Z
  body_sha256: 72707fed3996d6cda4f495df6656dd243f7f9ca20760e12a384afbd8b4b4e8e9
sources:
  - id: domain-schema
    resource: ../../src/schema/domain.ts
  - id: schemastore-config
    resource: ../../lib/scripts/schemastore.config.ts
---

# Annotate every schema reused in more than one place with an explicit identifier

## Rule

Any `Schema.Struct` or `Schema.Literals` value in `src/schema/domain.ts` that
is referenced from more than one field must carry `.annotate({ identifier:
"…", title: "…" })`.[^domain-schema] Do this at the point the schema is
defined, not after generating the JSON Schema and noticing the result looks
wrong.

## Why

The generated `schemas/5.0/output.json` is published at a public
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
(`additionalProperties: false`). That is `@effected/schemastore`'s default
lowering (since 0.12), stricter than core's own open default — the config
in `lib/scripts/schemastore.config.ts` pins nothing. If `pnpm schema:build`
ever rewrites every struct to `additionalProperties: true`, the library's
default has moved; pin `jsonSchema: { onExcessProperty: "error" }` on the
entry rather than committing the permissive output.[^schemastore-config]

## How to check

1. Run `pnpm schema:build` and diff `schemas/5.0/output.json`. A `$defs`
   entry named `Union_`, `Union_1`, `Struct_`, or similar is a missing
   `identifier` on the schema hoisted at that position — add
   `.annotate({ identifier, title })` to it in `src/schema/domain.ts` and
   rebuild.
2. `pnpm schema:check` (run before vitest by `ci:test`) reports drift
   between the committed document and what the current source would
   generate, classified as `contract` (a consumer-visible break, including
   a renamed `$defs` key) or `annotations` (documentation only).
3. If `additionalProperties: true` appears anywhere in the generated file,
   the library's default lowering has changed — see above — before assuming
   the schema itself changed.

See [the result output interface](../interfaces/action-outputs.md) for the
contract this schema publishes, and
[rebuild the result schema](../runbooks/rebuild-the-result-schema.md)
for the full regeneration procedure.

[^domain-schema]: `src/schema/domain.ts:10-84` (the `identifier`-annotation
  rule and the `DependencyType` example)
[^schemastore-config]: `lib/scripts/schemastore.config.ts`
