# Log

## 2026-11-25

* Updated A caret on a 0.x dependency pins the minor, and pnpm never revisits a satisfied range
* Updated A clean pnpm-lock.yaml is not evidence of the peer-suppression rules in effect
* Updated A computed dynamic import relies on rolldown keeping it native, with no annotation and no post-build guard
* Updated A duplicate kit package and a type error are not necessarily cause and effect
* Updated A first-party computed dynamic import stays local, guarded by a build-time assertion
* Updated A fixture that forgets to seed its own state decodes the host workflow's persisted data and passes
* Updated A green coverage run is not evidence a module is exercised
* Updated A just-published npm version can be unresolvable for minutes after publish succeeds
* Updated A memoized WorkspaceCatalogs assembly judged the after-install lockfile under pre-install rules
* Updated A miscompiled computed dynamic import passes every check except the built bundle
* Updated A pnpm 11 to 12 upgrade committed a lockfile pnpm 12 refuses
* Updated A pnpmfile hook that logs after its payload breaks the release-age replay
* Updated A search that cannot read a file returns nothing, indistinguishable from a real no-match
* Updated A test double stricter or richer than production hides the bug it should catch
* Updated Action error union
* Updated Action inputs
* Updated Action outputs
* Updated Adopt @effected/git for all local git operations; pin core.fileMode in repository config
* Updated Adopt @effected/package-json for surgical field edits only, never its decode path
* Updated Adopting a service into a second consumer is a layer-wiring change
* Updated An Effect Schema base-class rename presents as dozens of unrelated call-site errors
* Updated An abstained peer report reads exactly like a repo with real peer problems
* Updated An excluded test file is silently never collected — the suite shrinks and stays green
* Updated An unprovided service in makeAppLayer is not a type error
* Updated Annotate every schema reused in more than one place with an explicit identifier
* Updated Build on Effect v4 and the @effected kit, not plain TypeScript or one all-in-one library
* Updated Bump the @effected kit
* Updated Code style — extensions, tabs, no barrels, conventional commits
* Updated Commit via the Git Data API with no author, sign off separately from the token identity
* Updated Committed dist payload size
* Updated Declare a service's layer as a static field inside the class body
* Updated Delegate dependency changesets to silk-effects' DepsRegen
* Updated Demonstrate a failure path with a test, or leave it out of the signature
* Updated Detect the package manager once, and dispatch every step on it
* Updated Do not adopt @effected/github-references — there is no call site for it
* Updated Dogfood a fix to a first-party dependency before it publishes
* Updated Domain schemas
* Updated Each orchestration step declares its own error channel
* Updated Follow dependency-update work from dev through to a published release
* Updated Force-reset a dedicated branch every run rather than rebase
* Updated Guard makeAppLayer's requirement channel at compile time, not by convention
* Updated Isolating experiment over a duplicated @effected/github pair
* Updated Keep a lockfile-snapshot read failure fatal, for now
* Updated Keep every unit suite under __test__/unit, mirroring src, never co-located
* Updated Keep persistLocal disabled
* Updated Keep the run's log rendering and the PR's report rendering as two separate modules
* Updated Kit single-copy probe
* Updated Leave platform services in makeAppLayer's requirement channel instead of building private copies
* Updated Mirror src/ under __test__/unit/ and keep helpers out of reserved directories
* Updated Never rewrite the dev branch — commit, don't squash, rebase, or force-push
* Updated No main/index.js fallback when a config dependency's exports map does not match
* Updated Open work toward integration testing with a real GitHub App
* Updated Publish the output baseline before any work runs
* Updated Read every input through ActionInput, never bare Config
* Updated Rebuild the result output's JSON Schema after editing RunResultDocument
* Updated Refresh WorkspaceCatalogs before reading peer-suppression rules
* Updated Regenerate the lockfile from a clean slate rather than repair it in place
* Updated Release-age gate discovery fails open
* Updated Require the workspace root as a parameter everywhere it is used
* Updated Resolve dependency updates within the declared range, never to npm's absolute latest
* Updated Route a bun catalog merge on WHY the base tarball could not be read, never collapse every failure to one outcome
* Updated Run as three phases around a GitHub App token, not a personal access token
* Updated Run.text trims its output, which corrupts a column-aligned format
* Updated Runtime upgrades only ever upgrade an existing entry, and always write a bare exact version
* Updated State what would falsify a load-bearing claim, or say it is unverified
* Updated Test a dev-branch build end to end against a real consumer
* Updated Test suite count and its accounting history
* Updated The first check-peers dogfood run died on an unmerged WorkspaceCatalogs
* Updated The peer gate covers less than "no peer problems" implies
* Updated The peer-dependency auto-merge gate fails closed
* Updated This repository's @effected ranges come from a config dependency, not package.json
* Updated Two real pnpm lockfile shapes made peer-check abstain on a clean repo
* Updated Write package-manager and config-dependency pins bare; the lockfile holds integrity
* Updated Yarn is refused at detection, not supported
* Updated config dependency
* Updated dev (branch)
* Updated kept (catalog delta)
* Updated npm 11 to 12 pin bump probe against the bundled kit
* Updated npm has nothing to reproduce pnpm's config dependencies with
* Updated proven-clean
* Updated release-age gate
* Updated savvy-web/silk-runtime-action
* Updated savvy-web/systems
* Updated silk-update-action
* Updated silk-update-action
* Updated spencerbeggs/pnpm-module-template
* Updated spencerbeggs/type-registry-effect
* Updated unsatisfiable (package-manager upgrade)
* Updated v4.6.0: every consumer run died on an unprovided PackageJsonFile

## 2026-11-13

* Updated Detect the package manager once, and dispatch every step on it
* Updated Yarn is refused at detection, not supported
* Updated silk-update-action

## 2026-11-10

* Updated Committed dist payload size
* Updated Kit single-copy probe
* Added A computed dynamic import relies on rolldown keeping it native, with no annotation and no post-build guard
* Updated A first-party computed dynamic import stays local, guarded by a build-time assertion
* Updated A miscompiled computed dynamic import passes every check except the built bundle
* Updated Build on Effect v4 and the @effected kit, not plain TypeScript or one all-in-one library
* Updated Bump the @effected kit
* Updated Keep persistLocal disabled
* Updated Never rewrite the dev branch — commit, don't squash, rebase, or force-push
* Updated Release-age gate discovery fails open
* Updated Route a bun catalog merge on WHY the base tarball could not be read, never collapse every failure to one outcome
* Updated dev (branch)

## 2026-11-06

* Updated Action outputs
* Updated Adopt @effected/package-json for surgical field edits only, never its decode path
* Updated Rebuild the result output's JSON Schema after editing RunResultDocument

## 2026-11-02

* Updated Bump the @effected kit

## 2026-11-01

* Updated Build on Effect v4 and the @effected kit, not plain TypeScript or one all-in-one library
* Updated Bump the @effected kit
* Updated This repository's @effected ranges come from a config dependency, not package.json
* Updated config dependency
* Updated A first-party computed dynamic import stays local, guarded by a build-time assertion
* Updated A miscompiled computed dynamic import passes every check except the built bundle
* Updated Open work toward integration testing with a real GitHub App
* Updated Adopt @effected/package-json for surgical field edits only, never its decode path
* Updated Demonstrate a failure path with a test, or leave it out of the signature
* Updated Force-reset a dedicated branch every run rather than rebase
* Updated silk-update-action

## 2026-10-21

* Updated Runtime upgrades only ever upgrade an existing entry, and always write a bare exact version

## 2026-09-29

* Updated Rebuild the result output's JSON Schema after editing RunResultDocument

## 2026-09-28

* Updated An abstained peer report reads exactly like a repo with real peer problems
* Updated Refresh WorkspaceCatalogs before reading peer-suppression rules
* Updated The peer gate covers less than "no peer problems" implies
* Updated The peer-dependency auto-merge gate fails closed

## 2026-09-27

* Updated A pnpm 11 to 12 upgrade committed a lockfile pnpm 12 refuses
* Added Write package-manager and config-dependency pins bare; the lockfile holds integrity
* Updated config dependency
* Updated npm 11 to 12 pin bump probe against the bundled kit
* Updated Bump the @effected kit
* Updated This repository's @effected ranges come from a config dependency, not package.json

## 2026-09-19

* Added npm 11 to 12 pin bump probe against the bundled kit
* Updated Test a dev-branch build end to end against a real consumer
* Updated The first check-peers dogfood run died on an unmerged WorkspaceCatalogs
* Updated savvy-web/systems
* Updated spencerbeggs/pnpm-module-template

## 2026-09-17

* Added A just-published npm version can be unresolvable for minutes after publish succeeds
* Updated Action inputs
* Added A pnpm 11 to 12 upgrade committed a lockfile pnpm 12 refuses

## 2026-09-15

* Updated Action outputs
* Updated Annotate every schema reused in more than one place with an explicit identifier
* Updated Publish the output baseline before any work runs
* Added Rebuild the result output's JSON Schema after editing RunResultDocument

## 2026-09-13

* Initialized the bundle with the software-project profile
