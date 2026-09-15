/**
 * The `schemastore` CLI config: the action's JSON Schema document, derived
 * from its Effect Schema source.
 *
 * @remarks
 * Lives under `lib/scripts/` (`src/` is action source only), so the
 * package.json scripts hand the CLI this path explicitly instead of relying
 * on its upward `schemastore.config.*` discovery.
 *
 * `src/schema/domain.ts` (`RunResultDocument`) is the single source of truth.
 * Everything else — Draft-07 lowering, the structural lint, the ajv
 * strict-mode gate, the drift policy and the content-comparing write —
 * belongs to `@effected/schemastore` and its CLI.
 *
 * The entry's identity — repository, path, version label, layout — is the
 * `HostedSchema` value `src/schema/hosted.ts` constructs once
 * (`OutputSchemaIdentity`), handed over as `hosted`. The `$schema` URL the
 * code emits (`SCHEMA_URL`) is that same value's `$id`, so the URL a payload
 * carries and the `$id` the CLI writes are one derivation, not two that have
 * to agree. Nothing here spells a URL, a path or a version.
 *
 * Every object is generated closed (`additionalProperties: false`) — the
 * library's default — which is the contract consumers hold.
 *
 * `pnpm schema:build` writes; `pnpm schema:check` is the same walk with no
 * writes and is the CI gate (it fails when a build would write anything).
 */

import { defineConfig } from "@effected/schemastore";
import { RunResultDocument } from "../../src/schema/domain.js";
import { OutputSchemaIdentity } from "../../src/schema/hosted.js";

export default defineConfig({
	// Relative paths resolve against this file's directory, not the repo root.
	outputDir: "../../schemas",
	schemas: {
		[OutputSchemaIdentity.name]: {
			schema: RunResultDocument,
			hosted: OutputSchemaIdentity,
			// `published: false` (the default) lets a contract change at this label
			// regenerate the file in place instead of demanding a bump.
			published: false,
		},
	},
});
