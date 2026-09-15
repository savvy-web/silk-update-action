# Runbook

* [Bump the @effected kit](bump-the-effected-kit.md) - The extra config-dependency pin, the every-package pnpm why sweep, and the .repos re-pin a kit bump needs beyond an ordinary dependency update.
* [Dogfood a fix to a first-party dependency before it publishes](dogfood-a-first-party-dependency.md) - Link an unreleased fix from a sibling checkout into this action's dev branch, exercise it end to end against a real consumer, then unlink once the dependency publishes.
* [Follow dependency-update work from dev through to a published release](release-flow.md) - The chain of workflow triggers that carries a merged dependency-update PR on dev to a promoted main PR, a changeset release, a moved major-alias tag, and an evened-out dev branch.
* [Rebuild the result output's JSON Schema after editing RunResultDocument](rebuild-the-result-schema.md) - Edit the domain type, run \`pnpm schema:build\`, and let \`pnpm schema:check\` confirm the committed document matches — never hand-edit the generated JSON, and never spell the schema URL anywhere but \`src/schema/hosted.ts\`.
* [Test a dev-branch build end to end against a real consumer](test-a-dev-branch-build.md) - Rebuild dist on dev and run it through a real consumer workflow, since a bundled action can only be exercised end to end by the committed dist a consumer actually executes.
