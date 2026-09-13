---
type: Roadmap
title: Open work toward integration testing with a real GitHub App
description: "What remains before a real-App integration test runs green in CI, plus the smaller loose ends recorded alongside it — raw node: import drift, an unadopted lenient package.json decode path, and one program.ts extraction that has already partly happened."
status: draft
stale_after: 2027-03-13T00:00:00Z
gate: An integration test against a real GitHub App runs green in CI.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: fbdfd497c78677f6c531cef00697e133d68efffd90e25b4f1ab8a7bdb71a0a43
sources:
  - id: pre-ts
    resource: ../../src/pre.ts
  - id: post-ts
    resource: ../../src/post.ts
  - id: program-ts
    resource: ../../src/program.ts
  - id: config-deps-step
    resource: ../../src/steps/config-dependencies.ts
  - id: format-workspace-step
    resource: ../../src/steps/format-workspace.ts
---

# Open work toward integration testing with a real GitHub App

## Phase 1 — integration testing with a real GitHub App

Nothing in this repository's test suite currently exercises the full
`pre` → `main` → `post` token lifecycle against a real GitHub App installation
in CI; every existing suite drives `GitHubToken.provision` /
`GitHubToken.clientLayer()` / `GitHubToken.dispose()` against local doubles.
What remains: a CI job that provisions a real installation token against a
disposable or scoped-down test repository, runs the action end to end, and
tears the token down — closing the last gap between this repository's own
suite and the real-`dev`-branch proving ground described in
[savvy-web/systems](../consumers/savvy-web-systems.md).

## Phase 2 — documentation

A user guide and a troubleshooting document, neither of which exists yet
outside this bundle and the repository's own `docs/` directory. What remains
is scoping which parts of this bundle (the Interfaces, the Consumers, the
Gotchas) a first-time integrator actually needs versus what stays internal
reference.

## Phase 3 — changeset strategies beyond patch

The dependency-changeset step delegates entirely to
`@savvy-web/silk-effects`' `Changesets.DepsRegen`, which today only ever
proposes a `patch` bump for the consolidated dependency changesets it writes.
What remains is deciding whether a minor- or major-signaling changeset
strategy for a dependency bump belongs in this repository's own adapter
(`src/services/changesets.ts`) or upstream in `DepsRegen` itself, since this
repository does not currently compute or override the bump type it receives.

## Smaller loose ends tracked alongside the gate

These are not gated by the same integration-test condition above; they are
recorded here because they were open at the same review pass and each has a
concrete re-derivation step rather than a vague "someday."

- **Raw `node:` imports remain drift, not necessity.** Thirteen modules under
  `src/` still import directly from `node:fs` / `node:path` rather than
  through the ambient `FileSystem` / `Path` services every layer already has
  available: `src/services/{branch,catalog-config-deps,changesets,config-deps,
  lockfile,module-catalogs,package-manager-upgrade,peer-sync,regular-deps,
  runtime-upgrade,workspace-yaml}.ts`, `src/steps/install.ts`, and
  `src/utils/deps.ts` — re-derived on 2026-09-13 with
  `grep -rl 'from "node:' src/ | wc -l`, which still returns **13**.
  `runtime-upgrade.ts` and `package-manager-upgrade.ts` are expected to stay
  on this list even after everything else clears: both still `readFileSync` +
  `JSON.parse` a manifest to *decide* what to write, only routing the actual
  write through `PackageJsonFile.modify` — see
  [package.json edits go through modify only](../decisions/package-json-modify-only.md)
  for why the decode-based read path stays declined.
- **Adopting `@effected/package-json`'s lenient decode path (`PackageManifest`)
  is conditional, not scheduled.** Nothing currently blocks it — the package
  ships a presence-lenient model that would accept this repository's private
  workspace root — but nothing currently needs it either, because the two
  services that read a manifest only use the parsed value to make a decision,
  not to carry a typed field forward. The stated trigger: adopt it if a
  decision ever needs a typed field rather than a raw property read (a
  concrete candidate named at the time: `packageManager.isExact`). Adopting it
  for tidiness alone is explicitly not the bar.
- **The `program.ts` I/O-primitive claim has already partially resolved.** A
  prior review found `program.ts` calling both `readWorkspaceYaml` and
  `compareLockfiles` directly, which falsified the stronger claim that
  composition issues no I/O primitive of its own. Re-verified on 2026-09-13:
  `readWorkspaceYaml` has since moved out of `program.ts` entirely — it is now
  called from `src/steps/config-dependencies.ts` and
  `src/steps/format-workspace.ts`, both step modules. Only `compareLockfiles`
  remains a direct call in `src/program.ts`. So the extraction this loose end
  named as a candidate is one call site closer to done, not merely still
  proposed; the remaining `compareLockfiles` call is the one candidate left
  for the same treatment.
- **The lockfile-snapshot fail-open argument stays recorded, not applied** —
  see [keep a lockfile-snapshot read failure fatal](../decisions/keep-lockfile-snapshot-fatal.md)
  for the argument and why it was deliberately not folded into a
  behavior-preserving restructure.

## What would close each phase

Phase 1 closes on a green CI run of a real-App integration test, which is
this roadmap's stated `gate`. Phases 2 and 3 have no comparable observable
end state yet — closing either one should produce a Decision recording what
was actually chosen, at which point the corresponding phase here should be
struck rather than left describing settled work as still open.
