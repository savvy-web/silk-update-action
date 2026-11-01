import { PackageJsonFormat } from "@effected/package-json";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { CatalogMap } from "../../../src/utils/catalogs.js";
import {
	manifestCatalogEdits,
	normalizeCatalogs,
	readManifestCatalogs,
	threeWayMergeCatalogs,
} from "../../../src/utils/catalogs.js";

/**
 * Apply `manifestCatalogEdits` to `pkg` serialized with tabs, through the same
 * kit formatter `PackageJsonFile.modify` uses, and return both the text and the
 * parsed result — the edits are only meaningful against real source text.
 */
const applyCatalogs = (pkg: Record<string, unknown>, catalogs: CatalogMap) => {
	let text = `${JSON.stringify(pkg, null, "\t")}\n`;
	for (const edit of manifestCatalogEdits(pkg, catalogs)) {
		text = Effect.runSync(PackageJsonFormat.modifyToString(text, edit.path, edit.value));
	}
	return { text, json: JSON.parse(text) as Record<string, unknown> };
};

describe("normalizeCatalogs", () => {
	it("accepts a Map of Maps", () => {
		const value = new Map([["silk", new Map([["effect", "^3.21.4"]])]]);

		expect(normalizeCatalogs(value)).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("accepts plain nested objects", () => {
		expect(normalizeCatalogs({ silk: { effect: "^3.21.4" } })).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("accepts a Map of plain objects", () => {
		const value = new Map([["silk", { effect: "^3.21.4" }]]);

		expect(normalizeCatalogs(value)).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("returns null for a non-conforming shape", () => {
		expect(normalizeCatalogs("nope")).toBeNull();
		expect(normalizeCatalogs(null)).toBeNull();
		expect(normalizeCatalogs({ silk: "not-a-map" })).toBeNull();
		expect(normalizeCatalogs({ silk: { effect: 42 } })).toBeNull();
	});
});

describe("threeWayMergeCatalogs", () => {
	// The spec's worked example. Plugin 0.23.0 shipped typescript/vitest/lodash;
	// the user then pinned typescript exactly and hand-added zod. Plugin 0.24.0
	// bumps vitest and drops lodash.
	const base: CatalogMap = {
		silk: { typescript: "^7.0.2", vitest: "^4.1.9", lodash: "^4.17.0" },
	};
	const disk: CatalogMap = {
		silk: { typescript: "7.0.2", vitest: "^4.1.9", lodash: "^4.17.0", zod: "^3.24.0" },
	};
	const next: CatalogMap = {
		silk: { typescript: "^7.0.2", vitest: "^4.1.10" },
	};

	it("bumps an entry the disk still agrees with the base on", () => {
		const { merged } = threeWayMergeCatalogs(base, disk, next);

		expect(merged.silk?.vitest).toBe("^4.1.10");
	});

	it("preserves a local override", () => {
		const { merged } = threeWayMergeCatalogs(base, disk, next);

		expect(merged.silk?.typescript).toBe("7.0.2");
	});

	it("preserves a local addition upstream never had", () => {
		const { merged } = threeWayMergeCatalogs(base, disk, next);

		expect(merged.silk?.zod).toBe("^3.24.0");
	});

	it("propagates an upstream removal", () => {
		const { merged } = threeWayMergeCatalogs(base, disk, next);

		expect(merged.silk).not.toHaveProperty("lodash");
	});

	it("adds a key that is absent from disk", () => {
		const { merged } = threeWayMergeCatalogs({}, {}, { silk: { effect: "^3.21.4" } });

		expect(merged.silk?.effect).toBe("^3.21.4");
	});

	it("does not remove an upstream-dropped key the user overrode", () => {
		const { merged } = threeWayMergeCatalogs(
			{ silk: { lodash: "^4.17.0" } },
			{ silk: { lodash: "^4.18.0" } },
			{ silk: {} },
		);

		expect(merged.silk?.lodash).toBe("^4.18.0");
	});

	it("reports one delta per changed key, and none for an unchanged one", () => {
		const { deltas } = threeWayMergeCatalogs(base, disk, next);

		expect(deltas).toContainEqual({
			catalog: "silk",
			dependency: "vitest",
			from: "^4.1.9",
			to: "^4.1.10",
			action: "updated",
		});
		expect(deltas).toContainEqual({
			catalog: "silk",
			dependency: "lodash",
			from: "^4.17.0",
			to: null,
			action: "removed",
		});
		expect(deltas).toContainEqual({
			catalog: "silk",
			dependency: "typescript",
			from: "7.0.2",
			to: "7.0.2",
			action: "kept",
		});
	});

	it("is idempotent — re-merging its own output is a no-op", () => {
		const { merged } = threeWayMergeCatalogs(base, disk, next);
		const { merged: second, deltas } = threeWayMergeCatalogs(next, merged, next);

		expect(second).toEqual(merged);
		expect(deltas.every((d) => d.action === "kept")).toBe(true);
	});

	// "kept" must mean exactly one thing: a user override/addition survived.
	// An entry that is ours and simply didn't move this release is not news —
	// it must produce no delta at all, or downstream consumers (the PR table,
	// the "N kept (local override: ...)" summary line) can't tell the two
	// situations apart.
	it("emits no delta for an entry that is ours and unchanged, while a sibling override still emits kept", () => {
		const localBase: CatalogMap = { silk: { alpha: "1.0.0", beta: "1.0.0" } };
		const localDisk: CatalogMap = { silk: { alpha: "1.0.0", beta: "2.0.0" } };
		const localNext: CatalogMap = { silk: { alpha: "1.0.0", beta: "1.0.0" } };

		const { deltas } = threeWayMergeCatalogs(localBase, localDisk, localNext);

		expect(deltas.find((d) => d.dependency === "alpha")).toBeUndefined();
		expect(deltas).toContainEqual({ catalog: "silk", dependency: "beta", from: "2.0.0", to: "2.0.0", action: "kept" });
	});

	it("emits a removed delta for every one of our keys when a whole catalog name is dropped from next", () => {
		const localBase: CatalogMap = { silk: { a: "1.0.0", b: "1.0.0" } };
		const localDisk: CatalogMap = { silk: { a: "1.0.0", b: "1.0.0" } };
		const localNext: CatalogMap = {};

		const { merged, deltas } = threeWayMergeCatalogs(localBase, localDisk, localNext);

		expect(merged.silk).toEqual({});
		expect(deltas).toContainEqual({ catalog: "silk", dependency: "a", from: "1.0.0", to: null, action: "removed" });
		expect(deltas).toContainEqual({ catalog: "silk", dependency: "b", from: "1.0.0", to: null, action: "removed" });
	});

	it("produces no delta and no write for a key present only in base", () => {
		const localBase: CatalogMap = { silk: { ghost: "1.0.0", a: "1.0.0" } };
		const localDisk: CatalogMap = { silk: { a: "1.0.0" } };
		const localNext: CatalogMap = { silk: { a: "1.0.0" } };

		const { merged, deltas } = threeWayMergeCatalogs(localBase, localDisk, localNext);

		expect(merged.silk).toEqual({ a: "1.0.0" });
		expect(deltas.find((d) => d.dependency === "ghost")).toBeUndefined();
	});

	it("leaves a catalog name present only in disk completely untouched", () => {
		const localDisk: CatalogMap = { consumer: { foo: "^1.0.0" } };

		const { merged, deltas } = threeWayMergeCatalogs({}, localDisk, {});

		expect(merged).toEqual(localDisk);
		expect(deltas).toEqual([]);
	});

	it("does not mutate its disk argument", () => {
		const localBase: CatalogMap = { silk: { a: "1.0.0" } };
		const localDisk: CatalogMap = { silk: { a: "1.0.0", b: "2.0.0" } };
		const localNext: CatalogMap = { silk: { a: "1.0.1" } };
		const diskSnapshot = structuredClone(localDisk);

		threeWayMergeCatalogs(localBase, localDisk, localNext);

		expect(localDisk).toEqual(diskSnapshot);
	});
});

describe("readManifestCatalogs / manifestCatalogEdits", () => {
	it("maps the top-level catalog to the default catalog and back", () => {
		const pkg: Record<string, unknown> = {
			workspaces: ["."],
			catalog: { react: "^19.0.0" },
			catalogs: { silk: { effect: "^3.21.4" } },
		};

		const read = readManifestCatalogs(pkg);
		expect(read.default).toEqual({ react: "^19.0.0" });
		expect(read.silk).toEqual({ effect: "^3.21.4" });

		const { json } = applyCatalogs(pkg, { default: { react: "^19.1.0" }, silk: { effect: "^3.22.0" } });
		expect(json.catalog).toEqual({ react: "^19.1.0" });
		expect(json.catalogs).toEqual({ silk: { effect: "^3.22.0" } });
	});

	it("leaves an array workspaces field untouched and writes catalogs at the top level", () => {
		const pkg: Record<string, unknown> = { workspaces: ["."] };

		const { json } = applyCatalogs(pkg, { silk: { effect: "^3.21.4" } });

		// The array form is bun's canonical shape: it must survive verbatim.
		expect(json.workspaces).toEqual(["."]);
		expect(json.catalogs).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("appends new catalog blocks after every existing key, leaving those keys in place", () => {
		const pkg: Record<string, unknown> = {
			name: "root",
			workspaces: ["."],
			scripts: { test: "bun test" },
			devDependencies: {},
		};

		const { json } = applyCatalogs(pkg, { default: { react: "^19.0.0" }, silk: { effect: "^3.21.4" } });

		// `modify` has no insert-after position, so new keys go last.
		expect(Object.keys(json)).toEqual(["name", "workspaces", "scripts", "devDependencies", "catalog", "catalogs"]);
	});

	it("appends catalogs when the manifest has no workspaces key to anchor to", () => {
		const pkg: Record<string, unknown> = { name: "root" };

		const { json } = applyCatalogs(pkg, { silk: { effect: "^3.21.4" } });

		expect(json.workspaces).toBeUndefined();
		expect(json.catalogs).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("removes a catalog key that has become empty", () => {
		const pkg: Record<string, unknown> = { workspaces: ["."], catalogs: { silk: { a: "1" } } };

		const { json } = applyCatalogs(pkg, { silk: {} });

		expect(json.catalogs).toBeUndefined();
	});

	it("removes an emptied default catalog", () => {
		const pkg: Record<string, unknown> = { workspaces: ["."], catalog: { react: "^19.0.0" } };

		const { json } = applyCatalogs(pkg, { default: {} });

		expect(json.catalog).toBeUndefined();
	});

	it("reads an empty map from a manifest with no catalogs", () => {
		expect(readManifestCatalogs({ workspaces: ["."] })).toEqual({});
		expect(readManifestCatalogs({})).toEqual({});
		expect(readManifestCatalogs(null)).toEqual({});
	});

	it("reads named catalogs when the default catalog is omitted", () => {
		const pkg = { workspaces: ["."], catalogs: { silk: { effect: "^3.21.4" } } };

		const read = readManifestCatalogs(pkg);

		expect(read.default).toBeUndefined();
		expect(read.silk).toEqual({ effect: "^3.21.4" });
	});

	it("reads the default catalog when named catalogs are omitted", () => {
		const pkg = { workspaces: ["."], catalog: { react: "^19.0.0" } };

		const read = readManifestCatalogs(pkg);

		expect(read.default).toEqual({ react: "^19.0.0" });
		expect(Object.keys(read)).toEqual(["default"]);
	});

	it("still reads catalogs nested inside an object-form workspaces", () => {
		// bun tolerates the nested shape, and an earlier build of this action
		// wrote it, so an existing repo may carry it.
		const pkg = {
			workspaces: { packages: ["."], catalog: { react: "^19.0.0" }, catalogs: { silk: { effect: "^3.21.4" } } },
		};

		const read = readManifestCatalogs(pkg);

		expect(read.default).toEqual({ react: "^19.0.0" });
		expect(read.silk).toEqual({ effect: "^3.21.4" });
	});

	it("migrates a nested catalogs block to the top level on write, keeping workspaces", () => {
		const pkg: Record<string, unknown> = {
			workspaces: { packages: ["."], catalog: { react: "^19.0.0" }, catalogs: { silk: { effect: "^3.21.4" } } },
		};

		const { json } = applyCatalogs(pkg, readManifestCatalogs(pkg));

		expect(json.workspaces).toEqual({ packages: ["."] });
		expect(json.catalog).toEqual({ react: "^19.0.0" });
		expect(json.catalogs).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("round-trips the canonical bun shape without disturbing the manifest", () => {
		const pkg: Record<string, unknown> = {
			name: "design-docs",
			workspaces: ["."],
			catalogs: { silk: { effect: "^3.21.0" } },
			devDependencies: { "@savvy-web/silk": "^2.4.1" },
		};

		const before = `${JSON.stringify(pkg, null, "\t")}\n`;
		const { text } = applyCatalogs(pkg, { silk: { effect: "^3.21.4" } });

		// Exactly one value's bytes change.
		expect(text).toBe(before.replace('"effect": "^3.21.0"', '"effect": "^3.21.4"'));
	});

	it("emits no edits when the catalogs on disk already match", () => {
		const pkg = { workspaces: ["."], catalog: { react: "^19.0.0" }, catalogs: { silk: { effect: "^3.21.4" } } };

		expect(manifestCatalogEdits(pkg, readManifestCatalogs(pkg))).toEqual([]);
	});

	it("edits per entry: adds, updates and removes keys without replacing the catalog", () => {
		const pkg = {
			catalogs: { silk: { keep: "1", bump: "1", drop: "1" }, gone: { x: "1" } },
		};

		const edits = manifestCatalogEdits(pkg, { silk: { keep: "1", bump: "2", add: "1" } });

		expect(edits).toEqual([
			{ path: ["catalogs", "silk", "bump"], value: "2" },
			{ path: ["catalogs", "silk", "add"], value: "1" },
			{ path: ["catalogs", "silk", "drop"], value: undefined },
			{ path: ["catalogs", "gone"], value: undefined },
		]);
		expect(applyCatalogs(pkg, { silk: { keep: "1", bump: "2", add: "1" } }).json).toEqual({
			catalogs: { silk: { keep: "1", bump: "2", add: "1" } },
		});
	});

	it("replaces a non-object catalog field and adds a missing named catalog whole", () => {
		const pkg = { catalog: "nonsense", catalogs: { silk: { a: "1" } } };

		const { text, json } = applyCatalogs(pkg, { default: { react: "^19.0.0" }, silk: { a: "1" }, peers: { b: "2" } });

		expect(json).toEqual({ catalog: { react: "^19.0.0" }, catalogs: { silk: { a: "1" }, peers: { b: "2" } } });
		// Built entry by entry, so the inserted object is indented to its depth.
		expect(text).toContain('\t\t"peers": {\n\t\t\t"b": "2"\n\t\t}');
	});

	// @effected/jsonc leaves a whitespace-only line when it deletes the FIRST
	// member of an object (spencerbeggs/effected#1208), so none of these may
	// reach a first-member delete.
	const BLANK_LINE = /\n[ \t]*\n/;

	it("drops a catalog's first entry without a blank line", () => {
		const pkg = { workspaces: ["."], catalogs: { silk: { drop: "1", keep: "1" } } };

		const { text, json } = applyCatalogs(pkg, { silk: { keep: "1" } });

		expect(json).toEqual({ workspaces: ["."], catalogs: { silk: { keep: "1" } } });
		expect(text).not.toMatch(BLANK_LINE);
	});

	it("swaps a catalog's only entry for a different key without a blank line", () => {
		const pkg = { workspaces: ["."], catalogs: { silk: { zod: "^3.0.0" } } };

		const { text, json } = applyCatalogs(pkg, { silk: { effect: "^4.1.1" } });

		expect(json).toEqual({ workspaces: ["."], catalogs: { silk: { effect: "^4.1.1" } } });
		expect(text).not.toMatch(BLANK_LINE);
	});

	it("drops the first named catalog without a blank line", () => {
		const pkg = { workspaces: ["."], catalogs: { gone: { x: "1" }, silk: { a: "1" } } };

		const { text, json } = applyCatalogs(pkg, { silk: { a: "1" } });

		expect(json).toEqual({ workspaces: ["."], catalogs: { silk: { a: "1" } } });
		expect(text).not.toMatch(BLANK_LINE);
	});

	it("migrates a nested catalog that comes first in workspaces without a blank line", () => {
		const pkg: Record<string, unknown> = { workspaces: { catalog: { react: "^19.0.0" }, packages: ["."] } };

		const { text, json } = applyCatalogs(pkg, readManifestCatalogs(pkg));

		expect(json).toEqual({ workspaces: { packages: ["."] }, catalog: { react: "^19.0.0" } });
		expect(text).not.toMatch(BLANK_LINE);
		// The rebuilt array is indented to its depth, not the top level.
		expect(text).toContain('\t"workspaces": {\n\t\t"packages": [\n\t\t\t"."\n\t\t]\n\t}');
	});

	it("keeps an untouched entry's bytes when a later entry is dropped", () => {
		const pkg = { workspaces: ["."], catalogs: { silk: { keep: "1", drop: "1" } } };
		const before = `${JSON.stringify(pkg, null, "\t")}\n`;

		const { text } = applyCatalogs(pkg, { silk: { keep: "1" } });

		expect(text).toBe(before.replace(',\n\t\t\t"drop": "1"', ""));
	});

	it("empties an object-form workspaces that held only catalogs, without a blank line", () => {
		const pkg = { workspaces: { catalog: { react: "^19.0.0" } } };

		const { text, json } = applyCatalogs(pkg, readManifestCatalogs(pkg));

		expect(json).toEqual({ workspaces: {}, catalog: { react: "^19.0.0" } });
		expect(text).not.toMatch(/\n\s*\n/);
	});
});
