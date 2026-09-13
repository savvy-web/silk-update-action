---
type: Runbook
title: Regenerate the result output's JSON Schema after editing RunResultDocument
description: Edit the domain type, regenerate through the generator script, and let the drift test confirm the committed schema still matches — never hand-edit the generated JSON.
status: draft
tags:
  - observability
resource: ../../lib/scripts/generate-schema.ts
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 05574188ac267df4365d629dbbc432777d4f9790750696bd589ec2bcf6183604
sources:
  - id: generate-schema
    resource: ../../lib/scripts/generate-schema.ts
  - id: generate-schema-test
    resource: ../../__test__/unit/generate-schema.test.ts
  - id: package-json
    resource: ../../package.json
---

# Regenerate the result output's JSON Schema after editing RunResultDocument

`docs/schema/run-result.schema.json` is generated from
`RunResultDocument` (`src/schema/domain.ts`) via
`lib/scripts/generate-schema.ts`, run as `pnpm generate-schema`
(`package.json` script, line 27).[^package-json] It lives under
`lib/scripts/` rather than `scripts/` because that path is
cache-invalidating for turbo — a generated artifact whose generator changes
must not be served from a stale cache.

**Trigger:** `RunResultDocument`, or any schema it composes, changes shape
in `src/schema/domain.ts`.

## Steps

1. Edit the domain type(s) in `src/schema/domain.ts`.
2. Run `pnpm generate-schema`. Never hand-edit
   `docs/schema/run-result.schema.json` directly — the generator's
   `SchemaPipeline.run` builds the document, runs a structural lint and the
   shipped ajv strict-mode gate, and writes only when the document's
   **content** differs from what is committed
   (`lib/scripts/generate-schema.ts:84`),[^generate-schema] so a formatter
   reflowing the file on its own never provokes a spurious rewrite.
3. Read the logged outcome for each target: `Written (<contract|annotations>): <path>`
   or `Unchanged: <path>` (`lib/scripts/generate-schema.ts:94-96`).
   `contract` means the change is consumer-visible; `annotations` means it
   is documentation only.
4. If the run reports every struct flipping to
   `additionalProperties: true`, the target's
   `jsonSchema: { onExcessProperty: "error" }` option
   (`lib/scripts/generate-schema.ts:75`) was lost — restore it on the
   target in `generate-schema.ts`, never patch the emitted JSON by hand.
5. If a new `$defs` key appears named like `Union_` or `Struct_`, a schema
   shared by more than one field is missing an explicit `identifier`
   annotation at its definition site in `src/schema/domain.ts` — add the
   annotation there; do not rename the generated key. See
   [annotate shared schemas](../conventions/annotate-shared-schemas.md).
6. Run `pnpm test` (or scope to
   `__test__/unit/generate-schema.test.ts`). That suite imports the
   generator's own exported `targets` constant and runs the identical
   `SchemaPipeline.check` walk without writing, asserting `wouldWrite` is
   `false` and `blocked` is `false` for every target — a rebuilt target
   list in the test itself would pass while the generator wrote something
   else, which is why it imports the generator's own list rather than
   reconstructing one.[^generate-schema-test]
7. Commit the domain-type edit and the regenerated
   `docs/schema/run-result.schema.json` together.

## Observable end state

`docs/schema/run-result.schema.json` matches what `RunResultDocument`
currently describes, `pnpm test` (including
`__test__/unit/generate-schema.test.ts`) passes, and the published `result`
action output's schema — see
[action outputs](../interfaces/action-outputs.md) — stays honest about the
document a consumer will actually receive.

[^generate-schema]: `lib/scripts/generate-schema.ts`
[^generate-schema-test]: `__test__/unit/generate-schema.test.ts`
[^package-json]: `package.json`
