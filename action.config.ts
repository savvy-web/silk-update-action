import { defineConfig } from "@savvy-web/github-action-builder";

export default defineConfig({
	entries: {
		pre: "src/pre.ts",
		main: "src/main.ts",
		post: "src/post.ts",
	},
	build: {
		minify: true,
		// `@cyclonedx/cyclonedx-library` (pulled in transitively by
		// `@savvy-web/github-action-effects`) ships optional plugins — XML
		// serializers/validators and draft-2019 JSON validators — that this
		// action never invokes. They aren't installed and would never be
		// present in the deployed action, so `ignore` (alias to a throwing
		// stub) is correct here, not `externals` (which means "available at
		// runtime"). cyclonedx's `_optPlug` wrapper try/catches the stub throw
		// and falls through gracefully.
		ignore: ["xmlbuilder2", "libxmljs2", "ajv-formats-draft2019"],
		// Packages that perform a fully dynamic `await import(expr)` at
		// runtime. Without this, rspack compiles the import into a context
		// module and the action throws `Cannot find module 'file:///…'` in
		// production even though the file exists.
		// `@changesets/apply-release-plan` loads the configured changelog
		// module this way (via silk-effects 3's changesets v3 engine).
		// `workspaces-effect`'s config-dependency-hooks loader is currently
		// tree-shaken out of this bundle, but is listed so a future import
		// graph change can't silently break it.
		nativeDynamicImports: ["@changesets/apply-release-plan", "workspaces-effect"],
	},
	persistLocal: {
		enabled: false,
		path: ".github/actions/local",
	},
});
