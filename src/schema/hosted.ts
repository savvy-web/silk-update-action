/**
 * Where the action's JSON Schema documents are hosted — the ONE place the
 * repository, path and version label are spelled.
 *
 * `lib/scripts/schemastore.config.ts` receives {@link OutputSchemaIdentity} as
 * its entry's `hosted`, and the emitted `result` document carries
 * {@link SCHEMA_URL} as `$schema`. Both are the same value's `$id`, so the URL a
 * payload names and the `$id` the CLI writes cannot disagree.
 *
 * @module schema/hosted
 */

import { HostedSchema } from "@effected/schemastore";

/**
 * The version label every generated document is currently published under
 * (`schemas/<version>/`). The next MAJOR of this action, not its current
 * version; it iterates in place until that release ships.
 */
export const SCHEMA_VERSION = "5.0";

/**
 * Every label the documents have been published under, oldest first; the
 * current one is the newest. Older labels are frozen: the CLI verifies each
 * file still exists and declares its derived `$id`, but never regenerates it.
 */
export const SCHEMA_VERSIONS: ReadonlyArray<string> = [SCHEMA_VERSION];

/**
 * Where a generated document is hosted: raw from this repository's `main`
 * branch under `schemas/`, as `schemas/<version>/<name>.json` — the directory
 * carries the label, so the file name does not repeat it.
 */
const hosted = (name: string): HostedSchema =>
	HostedSchema.github({
		repo: "savvy-web/silk-update-action",
		path: "schemas",
		name,
		versions: SCHEMA_VERSIONS,
		current: SCHEMA_VERSION,
		appendVersion: false,
	});

/** Hosted identity of the structured `result` output document. */
export const OutputSchemaIdentity: HostedSchema = hosted("output");

/** The `$schema` every emitted `result` carries. */
export const SCHEMA_URL: string = OutputSchemaIdentity.$id;
