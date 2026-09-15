---
type: Runbook
title: Rebuild the result output's JSON Schema after editing RunResultDocument
description: Edit the domain type, run `pnpm schema:build`, and let `pnpm schema:check` confirm the committed document matches — never hand-edit the generated JSON, and never spell the schema URL anywhere but `src/schema/hosted.ts`.
status: draft
tags:
  - observability
resource: ../../lib/scripts/schemastore.config.ts
generated:
  by: okfit/claude-code
  at: 2026-09-15T18:43:07Z
  body_sha256: 05a8c7188c94a400809de968ec37f9c1f41dae7d1314b8687a4d6a077d7e5f54
sources:
  - id: schemastore-config
    resource: ../../lib/scripts/schemastore.config.ts
  - id: hosted
    resource: ../../src/schema/hosted.ts
  - id: package-json
    resource: ../../package.json
  - id: turbo-json
    resource: ../../turbo.json
---

# Rebuild the result output's JSON Schema after editing RunResultDocument

`schemas/<label>/output.json` is generated from `RunResultDocument`
(`src/schema/domain.ts`) by the `schemastore` CLI
(`@effected/schemastore-cli`) reading `lib/scripts/schemastore.config.ts`,
run as `pnpm schema:build`.[^package-json] The config never spells a URL,
path or version: it receives `OutputSchemaIdentity` from
`src/schema/hosted.ts` as its entry's `hosted`, and the `$schema` the emitted
document carries (`SCHEMA_URL`) is that same identity's `$id`.[^hosted]
`defineConfig` rejects an entry keyed differently from its identity's `name`,
so the two cannot disagree.

The label (`SCHEMA_VERSION`, currently `5.0`) is the action's **next major**,
not its current version. Nothing is published to SchemaStore, so the label
iterates in place: the entry is `published: false`, and a contract change
regenerates the file rather than demanding a bump.[^schemastore-config]

**Trigger:** `RunResultDocument`, or any schema it composes, changes shape
in `src/schema/domain.ts`.

## Steps

1. Edit the domain type(s) in `src/schema/domain.ts`.
2. Run `pnpm schema:build`. Never hand-edit `schemas/5.0/output.json` — the
   CLI lowers the schema, runs the structural lint and the ajv strict-mode
   gate, and writes only when the document's **content** differs from what
   is committed, so a formatter reflowing the file never provokes a rewrite.
3. Read the summary line: `1 schema(s): 1 written, 0 unchanged, 0 drift`
   after a real change, `0 written, 1 unchanged` when nothing moved. A
   `gate failed` count means a lint or ajv finding; the CLI prints it.
4. Run `pnpm lint:fix` so the committed artifact is Biome-formatted (the
   CLI's `semantic` drift policy accepts that), then `pnpm schema:check` and
   expect `0 written, 1 unchanged, 0 drift`.
5. If a new `$defs` key appears named like `Union_` or `Struct_`, a schema
   shared by more than one field is missing an explicit `identifier`
   annotation at its definition site in `src/schema/domain.ts` — add the
   annotation there; do not rename the generated key. See
   [annotate shared schemas](../conventions/annotate-shared-schemas.md).
6. Commit the domain-type edit and the regenerated
   `schemas/5.0/output.json` together.

Once a label has shipped to a consumer, do not regenerate it: append a new
label to `SCHEMA_VERSIONS`, make it `SCHEMA_VERSION`, and leave the old file
in place as a frozen version the CLI verifies but never rewrites.[^hosted]

## Observable end state

`pnpm schema:check` reports `0 drift`. It is the whole guard: `ci:test` runs
it before vitest, and turbo's `build:prod` depends on `schema:build`, so a
stale document can neither pass CI nor ship inside
`dist/`.[^turbo-json] There is no separate drift test to keep green.

[^schemastore-config]: `lib/scripts/schemastore.config.ts`
[^hosted]: `src/schema/hosted.ts`
[^package-json]: `package.json` (`schema:build`, `schema:check`, `ci:test`)
[^turbo-json]: `turbo.json` (`schema:build` task, `build:prod.dependsOn`)
