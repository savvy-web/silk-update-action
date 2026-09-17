---
type: Gotcha
title: A just-published npm version can be unresolvable for minutes after publish succeeds
description: 'npm''s publish-time malware scan can hold a freshly published version back from the registry for minutes while the publish itself reports success; an update run triggered off that publish fails the install with ERR_PNPM_NO_MATCHING_VERSION (or npm ETARGET, bun "No version matching"), which reads as a wrong range but is transient. The action retries that one failure on the retry-unmatched schedule; the wait counts against timeout.'
status: draft
stale_after: 2027-03-17T00:00:00Z
tags:
  - ci
  - deps
resource: ../../src/utils/unmatched-retry.ts
sources:
  - id: unmatched-retry
    resource: ../../src/utils/unmatched-retry.ts
  - id: install-step
    resource: ../../src/steps/install.ts
  - id: inputs
    resource: ../../src/schema/inputs.ts
  - id: npm-changelog
    resource: https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/
  - id: runs
    resource: https://github.com/savvy-web/silk-runtime-action/actions/runs/35233728336
generated:
  by: okfit/claude-code
  at: 2026-09-17T15:37:50Z
  body_sha256: 3ecbeba71f2cfdc4f9faaea7abf432bdbfaf71a34a25bc635ed22722db7736e3
---

## What you see

An update run fails at the install step with, for pnpm:

```text
ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @effected/github-actions@^0.13.1 while fetching it from https://registry.npmjs.org/
```

(npm reports `code ETARGET` / `No matching version found`; bun reports
`No version matching "^0.13.1" found for specifier ...`.) Re-running the same
job a minute or two later succeeds with no change to the inputs.[^runs]

## What you will wrongly conclude

That the range the action wrote is wrong, or that the release that produced
the version did not actually publish. Neither: the publish succeeded and the
version exists, but npm's publish-time malware scan has not released it to the
registry yet.[^npm-changelog] GitHub's announcement says 5–15 minutes for
new packages; observed in practice the hold is bimodal — usually under three
minutes, occasionally many hours — and most publishes are not held at all.

## What is actually true

The failure is transient and specific to the window between a publish
reporting success and the registry serving the version. This repository's
releases fan out update runs into consuming repositories immediately after a
publish, so those runs land inside the window whenever a hold happens.

The action handles the one failure shape and nothing else:[^unmatched-retry]

- `isUnmatchedVersion` classifies a `CommandFailedError` as unmatched only
  when it is a `nonZero` exit whose stderr or stdout matches one of the three
  package managers' no-matching-version signatures. A spawn failure, a
  timeout, or any other non-zero exit (outdated lockfile, peer failure,
  network reset) keeps the install step's fail-the-job posture.
- `runInstall` retries the whole clean-and-install sequence up to
  `retry-unmatched` times, waiting 3, 6, 10, 15, then +10 minutes between
  attempts, and logs a warning naming the wait before each one.[^install-step]
- The waits count against `timeout`, which wraps the whole run. `readInputs`
  rejects a `retry-unmatched` whose total wait is not below `timeout`, naming
  both numbers, rather than clamping — so a workflow that lowers `timeout`
  under 180 seconds must also set `retry-unmatched: 0`.[^inputs] The job's own
  `timeout-minutes` is not observable from inside the run and cannot be
  checked.

The defaults (`timeout: 480`, `retry-unmatched: 1`) cover the common short
hold with headroom for two install attempts. A long hold is not worth waiting
out in a runner; re-run the job later.

[^runs]: Failed run `savvy-web/silk-runtime-action` actions run 35233728336 job 105244177242; the immediate re-run, job 105244889138, succeeded.
[^npm-changelog]: <https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/>
[^unmatched-retry]: `../../src/utils/unmatched-retry.ts`
[^install-step]: `../../src/steps/install.ts`
[^inputs]: `../../src/schema/inputs.ts`
