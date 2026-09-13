---
type: Decision
title: The peer-dependency auto-merge gate fails closed
description: Auto-merge is withheld whenever the peer report cannot be proven clean, not only when it proves a problem.
status: draft
tags:
  - deps
  - ci
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 5018ee1c2ca60eeae6eb59719d722ff1a609b8ebea4b69685f465a53557b3630
sources:
  - id: peers-util
    resource: ../../src/utils/peers.ts
  - id: peer-check-step
    resource: ../../src/steps/peer-check.ts
  - id: peers-test
    resource: ../../__test__/unit/utilities/peers.test.ts
  - id: inputs-schema
    resource: ../../src/schema/inputs.ts
  - id: pnpm-lock
    resource: ../../pnpm-lock.yaml
---

# The peer-dependency auto-merge gate fails closed

## Context

`check-peers` runs `PeerCheck` (from `@effected/workspaces`) against the
lockfile this run is about to commit and can withhold auto-merge on the
result. The report it produces is not binary — it can find zero required
rows for reasons that mean "nothing was proven" as easily as for reasons that
mean "nothing is wrong": the lockfile format was unsupported, an importer
could not be resolved, or the peer-suppression rules could not be looked up.

A lockfile alone cannot answer the question the gate needs answered. pnpm
persists resolution-affecting configuration into `pnpm-lock.yaml` (an
`overrides` entry from a config-dependency pnpmfile hook, for example) and
discards reporting-affecting configuration: `peerDependencyRules` appears
nowhere in the file this repository's own lockfile produces, and nowhere in
`pnpm-workspace.yaml` either — every rule in effect here comes from a hook
replay.[^pnpm-lock] `PeerCheck.run` without `peerDependencyRules` reports
`peerRulesNotApplied` unconditionally, which is the correct behavior for an
API that cannot assume what it was not told: supplying `NoPeerDependencyRules`
is an assertion ("I looked, there are none"), and a failed lookup must
therefore degrade to omitting the option rather than to that assertion — the
empty set is a claim this run has no basis to make.

## Decision

Gate on `supported && !unresolvedImporters.length && !unverified.length &&
!requiredCount`, all four terms — not on `requiredCount === 0` alone.
`decidePeerGate` (`src/utils/peers.ts`) checks the three "not proven clean"
terms before the "proven clean but found something" term, in that
order.[^peers-util] Each of the first three produces an empty `required` set
that means "not examined", which is a different fact from "examined and
nothing wrong", and only the fourth term is a genuine pass. A gate reading
only `requiredCount` collapses those two facts and silently reports success
on a report that never looked.

The `check-peers` mode has a **derived** default rather than a static one:
unset resolves to `"no-auto-merge"` when `auto-merge` is enabled and to
`"false"` when it is not.[^inputs-schema] A static `"no-auto-merge"` default
would be a no-op for the *gate* on a repo with no auto-merge to withhold, but
not for the *run* — the step still spawns the config-dependency hook replay
in the consumer's repository. Deriving the default makes "free where there is
nothing to gate" literally true rather than merely cheap.

`fail` is not a mode this input accepts; only `false`, `warn` and
`no-auto-merge` are.[^inputs-schema] A mode that failed the whole job over a
peer report would need a second, concurrent check run to still surface
dependency-update work that succeeded, and nothing here builds one — the
report is designed to ride inside the same check run and PR as everything
else the run did.

`decidePeerGate` also takes `autoMergeEnabled` explicitly, and returns
`"auto-merge-disabled"` rather than treating a withhold as always
meaningful: nothing can be withheld that was never going to happen. Without
this, the PR body told reviewers auto-merge was withheld on repositories
that had never enabled it — a decision reported as taken that was never
available to take. Peers are still reported in that case; only the gate
itself is inapplicable.

The step calls `catalogs.refresh()` before reading `peerDependencyRules()`,
so the after-install lockfile is judged under the after-install plugins'
rules rather than a memoized pre-install assembly — see
[refresh catalogs before peer check](refresh-catalogs-before-peer-check.md)
for why that ordering is load-bearing on its own.

## Alternatives rejected

- **Gate on `requiredCount > 0` alone.** The obvious reading, and the one the
  fail-closed terms exist to rule out: it treats "nothing found because
  nothing was checked" the same as "checked and found nothing", which is
  exactly the silent pass that shipped a false auto-merge once (see
  [peer check abstained on a clean repo](../incidents/peer-check-abstained-on-clean-repo.md)
  for the incident this shape produces from the *opposite* direction — an
  abstention on a genuinely clean repo reading as a problem). The unit suite
  pins this: four cases assert a withhold with `requiredCount: 0` on each of
  the three non-clean terms, plus a fifth asserting reason-ordering when
  several terms are true at once, so a gate reading only `requiredCount`
  fails at least five assertions in
  `__test__/unit/utilities/peers.test.ts`.[^peers-test]
- **A static `"no-auto-merge"` default for `check-peers`.** Considered and
  rejected because it silently gates repositories that never enabled
  auto-merge, spawning the hook-replay subprocess for a check that could
  never have anything to withhold.
- **Read `peerDependencyRules` from `pnpm-workspace.yaml` only.** Rejected on
  measurement, not on suspicion: this repository declares no rules in that
  file and its effective rules are all injected by config-dependency
  plugins, so a workspace-file-only read finds nothing here and would still
  report false positives.

## Consequences

- The gate can only ever go one of two ways when it fires: withhold, or
  report `proven-clean`. There is no third "probably fine" state — an
  `unverified` report withholds exactly as hard as a `required-unsatisfied`
  one, and the two are distinguished only by the reason logged, not by the
  gate's effect.
- A kit-side lockfile-parsing regression that turns a legitimate shape into
  `unresolvedEdge` (npm-alias dependencies, `publishDirectory` `link:` edges)
  withholds auto-merge from a repository with zero real peer problems. See
  [the peer-check coverage limitation](../limitations/peer-check-coverage.md)
  and the incident this produced live.
- `peerDependencyRules` never appearing in a lockfile is a standing property
  of pnpm this gate depends on, not a bug to watch for — see
  [the lockfile-omits-peer-rules gotcha](../gotchas/lockfile-omits-peer-rules.md).

## What would change the answer

A pnpm release that starts persisting `peerDependencyRules` into the
lockfile would remove the reason the rules have to come from a hook replay
at all, though the fail-closed shape of the gate itself would still be
correct — the three "not examined" terms are about *any* source of rules
being unavailable, not specifically about hook replay. A `check-peers` mode
that genuinely needs to fail the whole job (rather than withhold auto-merge)
would need its own check-run path, which does not exist today.

[^peers-util]: `src/utils/peers.ts`
[^peers-test]: `__test__/unit/utilities/peers.test.ts`
[^inputs-schema]: `src/schema/inputs.ts`
[^pnpm-lock]: `pnpm-lock.yaml` (`grep -c peerDependencyRules pnpm-lock.yaml` → `0`)
