import { describe, expect, it } from "vitest";
import {
	findRuntimeEntry,
	isStaticVersion,
	parseRuntimeOperator,
	redecorateVersion,
	upsertRuntimeEntry,
} from "./runtime.js";

describe("parseRuntimeOperator", () => {
	it("extracts caret", () => expect(parseRuntimeOperator("^24.0.0")).toBe("^"));
	it("extracts tilde", () => expect(parseRuntimeOperator("~24.5.0")).toBe("~"));
	it("extracts >=", () => expect(parseRuntimeOperator(">=20.0.0")).toBe(">="));
	it("returns empty for bare version", () => expect(parseRuntimeOperator("24.11.0")).toBe(""));
});

describe("isStaticVersion", () => {
	it("true for bare X.Y.Z", () => expect(isStaticVersion("24.11.0")).toBe(true));
	it("true for prerelease", () => expect(isStaticVersion("24.11.0-rc.1")).toBe(true));
	it("false for caret range", () => expect(isStaticVersion("^24.0.0")).toBe(false));
	it("false for tilde range", () => expect(isStaticVersion("~24.5.0")).toBe(false));
	it("false for partial (24)", () => expect(isStaticVersion("24")).toBe(false));
	it("false for wildcard (24.x)", () => expect(isStaticVersion("24.x")).toBe(false));
	it("false for comparator (>=20)", () => expect(isStaticVersion(">=20.0.0")).toBe(false));
	it("false for OR range", () => expect(isStaticVersion("20.0.0 || 22.0.0")).toBe(false));
});

describe("redecorateVersion", () => {
	it("reattaches caret", () => expect(redecorateVersion("24.16.0", "^")).toBe("^24.16.0"));
	it("no operator yields bare", () => expect(redecorateVersion("24.16.0", "")).toBe("24.16.0"));
});

describe("findRuntimeEntry", () => {
	it("finds in array shape", () => {
		const dev = { runtime: [{ name: "node", version: "^24.0.0" }] };
		expect(findRuntimeEntry(dev, "node")?.version).toBe("^24.0.0");
	});
	it("finds in single-object shape", () => {
		const dev = { runtime: { name: "node", version: "24.11.0" } };
		expect(findRuntimeEntry(dev, "node")?.version).toBe("24.11.0");
	});
	it("returns null when absent", () => {
		expect(findRuntimeEntry({ runtime: [{ name: "node", version: "1" }] }, "bun")).toBeNull();
		expect(findRuntimeEntry(undefined, "node")).toBeNull();
		expect(findRuntimeEntry({}, "node")).toBeNull();
	});
});

describe("upsertRuntimeEntry", () => {
	it("modifies an existing array entry (added=false, shape preserved)", () => {
		const pkg: Record<string, unknown> = {
			devEngines: { runtime: [{ name: "node", version: "^24.0.0", onFail: "ignore" }] },
		};
		const result = upsertRuntimeEntry(pkg, "node", "^24.16.0");
		expect(result.added).toBe(false);
		expect((pkg.devEngines as { runtime: unknown }).runtime).toEqual([
			{ name: "node", version: "^24.16.0", onFail: "ignore" },
		]);
	});

	it("modifies an existing single-object entry (shape preserved)", () => {
		const pkg: Record<string, unknown> = { devEngines: { runtime: { name: "node", version: "24.11.0" } } };
		const result = upsertRuntimeEntry(pkg, "node", "24.16.0");
		expect(result.added).toBe(false);
		expect((pkg.devEngines as { runtime: unknown }).runtime).toEqual({ name: "node", version: "24.16.0" });
	});

	it("promotes a single object to an array when adding a sibling, mirroring onFail", () => {
		const pkg: Record<string, unknown> = {
			devEngines: { runtime: { name: "node", version: "^24.0.0", onFail: "warn" } },
		};
		const result = upsertRuntimeEntry(pkg, "deno", "^2.1.0");
		expect(result.added).toBe(true);
		expect((pkg.devEngines as { runtime: unknown }).runtime).toEqual([
			{ name: "node", version: "^24.0.0", onFail: "warn" },
			{ name: "deno", version: "^2.1.0", onFail: "warn" },
		]);
	});

	it("creates devEngines.runtime as an array when absent, defaulting onFail to ignore", () => {
		const pkg: Record<string, unknown> = { name: "x" };
		const result = upsertRuntimeEntry(pkg, "bun", "^1.2.0");
		expect(result.added).toBe(true);
		expect((pkg.devEngines as { runtime: unknown }).runtime).toEqual([
			{ name: "bun", version: "^1.2.0", onFail: "ignore" },
		]);
	});

	it("appends to an existing array when adding a new runtime", () => {
		const pkg: Record<string, unknown> = { devEngines: { runtime: [{ name: "node", version: "^24.0.0" }] } };
		const result = upsertRuntimeEntry(pkg, "bun", "^1.2.0");
		expect(result.added).toBe(true);
		expect((pkg.devEngines as { runtime: unknown }).runtime).toEqual([
			{ name: "node", version: "^24.0.0" },
			{ name: "bun", version: "^1.2.0", onFail: "ignore" },
		]);
	});
});
