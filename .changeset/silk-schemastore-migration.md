---
"silk-update-action": minor
---

## Features

### `result` output document names its schema via `$schema`

The `result` output's JSON document no longer carries an in-band
`schemaVersion` field. Every document now names its own hosted JSON Schema
directly via `$schema`:

```json
{
	"$schema": "https://raw.githubusercontent.com/savvy-web/silk-update-action/main/schemas/5.0/output.json",
	"hasChanges": false,
	"dryRun": false,
	"packageManager": null
}
```

The version now lives in the schema's own label (`5.0`, the action's next
major) and URL rather than in a field a consumer has to know to check. The
label is not yet submitted anywhere and iterates in place until that major
ships; the document at it is regenerated, not frozen.

**Migration:** replace any code that reads or asserts on `result.schemaVersion`
with a check against `result.$schema`, or drop the check entirely and instead
pin validation to the schema published at the URL the document names.

### JSON Schema moved to `schemas/5.0/output.json`

The published JSON Schema for the `result` document moved from
`docs/schema/run-result.schema.json` to `schemas/5.0/output.json`. Update any
reference to the old path — including local validation tooling — to the new
location, or better, read the URL directly from a document's own `$schema`
field.

### `result` is logged before it is set

- The `result` document is now printed pretty inside a collapsed "Structured result output" log group in the workflow log immediately before it is set as an output, so the full payload is visible without a downstream step reading `steps.<id>.outputs.result`.

## Dependencies

`@effected/schemastore` moves from a devDependency to a runtime dependency because `src/schema/hosted.ts` now imports `HostedSchema` from it; schema generation itself moves to the new `@effected/schemastore-cli` devDependency, replacing the removed `generate-schema` script.

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| @effected/pnpm-plugin-effect | config | updated | 0.8.8 | 0.8.9 |
| @effected/schemastore | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/schemastore-cli | devDependency | added | — | 0.12.0 |
