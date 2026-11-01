import type { PackageFieldEdit } from "@effected/package-json";

import type { CatalogDelta } from "../schema/domain.js";

/**
 * Catalogs keyed by catalog name, each mapping a dependency to a version range.
 *
 * The `"default"` key is the default catalog: it lives in the manifest's
 * top-level `catalog` field, while every other key lives under the top-level
 * `catalogs` field. Both sit beside `workspaces` — they are not nested in it.
 */
export type CatalogMap = Record<string, Record<string, string>>;

/**
 * Coerce a `Map` or plain object into a plain record, or `null` if it is neither.
 */
const asRecord = (value: unknown): Record<string, unknown> | null => {
	if (value instanceof Map) {
		return Object.fromEntries(value);
	}
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
};

/**
 * Normalize a config dependency's `catalogs` export into a {@link CatalogMap}.
 *
 * The export is read out of a third-party module we import at runtime, and a
 * bundler may emit either a `Map` or a plain object at each of the two levels —
 * a `Map` of plain objects is a real shape, not a hypothetical — so both are
 * accepted independently.
 *
 * A non-string range makes the whole shape non-conforming rather than dropping
 * that one entry: a plugin shipping a malformed catalog is broken, and
 * half-merging it would write a corrupt manifest. `null` is the caller's signal
 * to warn and skip that dependency.
 */
export const normalizeCatalogs = (value: unknown): CatalogMap | null => {
	const outer = asRecord(value);
	if (outer === null) {
		return null;
	}

	const result: CatalogMap = {};

	for (const [name, rawCatalog] of Object.entries(outer)) {
		const inner = asRecord(rawCatalog);
		if (inner === null) {
			return null;
		}

		const catalog: Record<string, string> = {};
		for (const [dependency, range] of Object.entries(inner)) {
			if (typeof range !== "string") {
				return null;
			}
			catalog[dependency] = range;
		}
		result[name] = catalog;
	}

	return result;
};

/**
 * Merge a config dependency's catalogs into the manifest, three-way.
 *
 * pnpm merges a config dependency's catalogs in memory at install time and never
 * rewrites the manifest. In a bun repo there is no such hook, so the merged
 * catalogs are written to disk — and a later run cannot then tell a deliberate
 * user override from an entry the action itself wrote. Diffing against `base`
 * (the catalogs of the version that was previously installed) separates them:
 *
 * - a key the disk still agrees with `base` on is ours, so it takes `next`'s
 *   value, and is deleted when `next` drops it;
 * - a key whose disk value diverges from `base` is the user's, and survives —
 *   even if upstream dropped it;
 * - a key absent from the disk is added.
 *
 * Only catalog names present in `base` or `next` are considered. A catalog name
 * no config dependency ships belongs to the consumer and is never touched.
 *
 * A `"kept"` delta means exactly one thing: a user override or user addition
 * survived the merge. An entry that is ours and simply did not move in this
 * release is not news — it produces no delta at all, rather than a `"kept"`
 * entry that would be indistinguishable from a real override.
 *
 * @param base - Catalogs shipped by the previously installed version.
 * @param disk - Catalogs currently in the manifest.
 * @param next - Catalogs shipped by the version being installed.
 */
export const threeWayMergeCatalogs = (
	base: CatalogMap,
	disk: CatalogMap,
	next: CatalogMap,
): { merged: CatalogMap; deltas: ReadonlyArray<CatalogDelta> } => {
	const merged: CatalogMap = structuredClone(disk);
	const deltas: Array<CatalogDelta> = [];

	const managedNames = new Set([...Object.keys(base), ...Object.keys(next)]);

	for (const catalog of managedNames) {
		const baseEntries = base[catalog] ?? {};
		const diskEntries = disk[catalog] ?? {};
		const nextEntries = next[catalog] ?? {};

		const entries: Record<string, string> = { ...diskEntries };
		const keys = new Set([...Object.keys(baseEntries), ...Object.keys(diskEntries), ...Object.keys(nextEntries)]);

		for (const dependency of keys) {
			const previous = diskEntries[dependency];
			const managed = baseEntries[dependency];
			const incoming = nextEntries[dependency];

			// Absent from the manifest: adopt whatever the new version ships.
			if (previous === undefined) {
				if (incoming !== undefined) {
					entries[dependency] = incoming;
					deltas.push({ catalog, dependency, from: null, to: incoming, action: "added" });
				}
				continue;
			}

			// Diverged from what the previous version shipped: the user's, kept as-is.
			if (previous !== managed) {
				deltas.push({ catalog, dependency, from: previous, to: previous, action: "kept" });
				continue;
			}

			// Ours. Follow the new version, including its removals.
			if (incoming === undefined) {
				delete entries[dependency];
				deltas.push({ catalog, dependency, from: previous, to: null, action: "removed" });
				continue;
			}

			entries[dependency] = incoming;
			if (incoming !== previous) {
				deltas.push({ catalog, dependency, from: previous, to: incoming, action: "updated" });
			}
		}

		merged[catalog] = entries;
	}

	return { merged, deltas };
};

/** Fold one manifest section's `catalog` / `catalogs` fields into `result`. */
const collectCatalogs = (source: Record<string, unknown>, result: CatalogMap): void => {
	const normalizedDefault = normalizeCatalogs({ default: source.catalog ?? {} });
	if (normalizedDefault?.default && Object.keys(normalizedDefault.default).length > 0) {
		result.default = { ...(result.default ?? {}), ...normalizedDefault.default };
	}

	const named = normalizeCatalogs(source.catalogs ?? {});
	if (named !== null) {
		for (const [name, entries] of Object.entries(named)) {
			result[name] = { ...(result[name] ?? {}), ...entries };
		}
	}
};

/**
 * Read the catalogs out of a root manifest.
 *
 * `catalog` is surfaced under the `"default"` key; every entry of `catalogs`
 * keeps its own name. The canonical top-level location is read last so that on
 * the (pathological) manifest carrying both shapes, it wins.
 */
export const readManifestCatalogs = (pkgJson: unknown): CatalogMap => {
	const manifest = asRecord(pkgJson);
	if (manifest === null) {
		return {};
	}

	const result: CatalogMap = {};

	// Legacy/tolerated: nested inside an object-form `workspaces`. `asRecord`
	// returns null for the array form, which is the common case.
	const nested = asRecord(manifest.workspaces);
	if (nested !== null) {
		collectCatalogs(nested, result);
	}

	collectCatalogs(manifest, result);

	return result;
};

/**
 * Edits that set the value at `path` from nothing, one leaf at a time: an
 * empty `{}` or `[]` first, then one edit per entry or element.
 *
 * Built leaf by leaf rather than as one value because `modify` indents a
 * multi-line inserted value as if it sat at the top level
 * (spencerbeggs/effected#1208); growing an empty container one member at a
 * time indents every line to its real depth.
 */
const freshValueEdits = (path: ReadonlyArray<string | number>, value: unknown): Array<PackageFieldEdit> => {
	if (Array.isArray(value)) {
		const edits: Array<PackageFieldEdit> = [{ path, value: [] }];
		value.forEach((element, index) => {
			edits.push(...freshValueEdits([...path, index], element));
		});
		return edits;
	}
	if (typeof value === "object" && value !== null) {
		const edits: Array<PackageFieldEdit> = [{ path, value: {} }];
		for (const [key, entry] of Object.entries(value)) {
			edits.push(...freshValueEdits([...path, key], entry));
		}
		return edits;
	}
	return [{ path, value }];
};

/** {@link freshValueEdits} for an object value. */
const freshObjectEdits = (
	path: ReadonlyArray<string>,
	value: Readonly<Record<string, unknown>>,
): Array<PackageFieldEdit> => freshValueEdits(path, value);

/**
 * True when turning `existing` into an object with only `kept` keys would
 * delete its FIRST member. `@effected/jsonc` leaves a whitespace-only line
 * behind when it deletes an object's first member (deleting a middle or last
 * one is clean), so such an object is rebuilt instead
 * (spencerbeggs/effected#1208).
 */
const deletesFirstMember = (existing: Readonly<Record<string, unknown>>, kept: (key: string) => boolean): boolean => {
	const first = Object.keys(existing)[0];
	return first !== undefined && !kept(first);
};

/**
 * Edits turning the string-valued object at `path` (as it is on disk) into
 * `target`, per entry, so an untouched entry keeps its bytes.
 *
 * When that would delete the object's first member, the object is rebuilt
 * entry by entry instead (see {@link deletesFirstMember}); `target` is
 * non-empty, so the rebuilt object is never empty.
 */
const recordEdits = (
	path: ReadonlyArray<string>,
	current: unknown,
	target: Readonly<Record<string, string>>,
): Array<PackageFieldEdit> => {
	const existing = asRecord(current);
	if (existing === null || deletesFirstMember(existing, (key) => key in target)) {
		return freshObjectEdits(path, target);
	}
	const sets: Array<PackageFieldEdit> = Object.entries(target)
		.filter(([key, value]) => existing[key] !== value)
		.map(([key, value]) => ({ path: [...path, key], value }));
	const deletes: Array<PackageFieldEdit> = Object.keys(existing)
		.filter((key) => !(key in target))
		.map((key) => ({ path: [...path, key], value: undefined }));
	return [...sets, ...deletes];
};

/**
 * The `PackageJsonFile.modify` edits that write `catalogs` back into the root
 * manifest `pkgJson` (its parsed on-disk form).
 *
 * Catalogs are written to the **top level** — `catalog` and `catalogs` as
 * siblings of `workspaces` — and `workspaces` itself is never rewritten: an
 * array stays an array. Any nested copy inside an object-form `workspaces` is
 * removed, migrating the manifest to the canonical shape. A catalog that has
 * become empty has its key removed rather than being left as an empty object.
 *
 * Edits are per entry wherever the on-disk shape allows, so an entry the merge
 * did not move keeps its exact bytes. A brand-new `catalog` / `catalogs` key is
 * appended at the end of the manifest: `modify` has no insert-after position.
 */
export const manifestCatalogEdits = (pkgJson: unknown, catalogs: CatalogMap): ReadonlyArray<PackageFieldEdit> => {
	const manifest = asRecord(pkgJson) ?? {};
	const edits: Array<PackageFieldEdit> = [];

	// Migrate away from the nested form. `workspaces` keeps its own shape;
	// only the catalog keys are lifted out of it.
	const nested = Array.isArray(manifest.workspaces) ? null : asRecord(manifest.workspaces);
	if (nested !== null && ("catalog" in nested || "catalogs" in nested)) {
		const remaining = Object.keys(nested).filter((key) => key !== "catalog" && key !== "catalogs");
		if (remaining.length === 0) {
			// Deleting an object's last key leaves a blank line; replace it whole.
			edits.push({ path: ["workspaces"], value: {} });
		} else if (deletesFirstMember(nested, (key) => key !== "catalog" && key !== "catalogs")) {
			edits.push(...freshObjectEdits(["workspaces"], Object.fromEntries(remaining.map((key) => [key, nested[key]]))));
		} else {
			for (const key of ["catalog", "catalogs"] as const) {
				if (key in nested) edits.push({ path: ["workspaces", key], value: undefined });
			}
		}
	}

	const { default: defaultCatalog, ...named } = catalogs;

	if (defaultCatalog && Object.keys(defaultCatalog).length > 0) {
		edits.push(...recordEdits(["catalog"], manifest.catalog, defaultCatalog));
	} else if ("catalog" in manifest) {
		edits.push({ path: ["catalog"], value: undefined });
	}

	const populatedNamed = Object.entries(named).filter(([, entries]) => Object.keys(entries).length > 0);
	if (populatedNamed.length === 0) {
		if ("catalogs" in manifest) edits.push({ path: ["catalogs"], value: undefined });
		return edits;
	}

	const existingNamed = asRecord(manifest.catalogs);
	if (existingNamed === null) {
		edits.push(...freshObjectEdits(["catalogs"], Object.fromEntries(populatedNamed)));
		return edits;
	}
	const kept = new Set(populatedNamed.map(([name]) => name));
	if (deletesFirstMember(existingNamed, (name) => kept.has(name))) {
		edits.push(...freshObjectEdits(["catalogs"], Object.fromEntries(populatedNamed)));
		return edits;
	}
	for (const [name, entries] of populatedNamed) {
		edits.push(...recordEdits(["catalogs", name], existingNamed[name], entries));
	}
	for (const name of Object.keys(existingNamed)) {
		if (!kept.has(name)) edits.push({ path: ["catalogs", name], value: undefined });
	}
	return edits;
};
