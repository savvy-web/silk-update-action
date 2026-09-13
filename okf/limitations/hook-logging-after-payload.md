---
type: Limitation
title: A pnpmfile hook that logs after its payload breaks the release-age replay
description: The subprocess replay reads its child's last non-empty stdout line as the payload; a hook that writes after that line (process.on("exit", ...) cleanup logging) is misread and the gate degrades to no gate.
status: draft
tags:
  - deps
bounds: ../decisions/release-age-fail-open.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 748224a9310c0828c76b0af8f6621867bf716a1ace207191c9b18f9924ec4444
sources:
  - id: release-age-service
    resource: ../../src/services/release-age.ts
  - id: release-age-int-test
    resource: ../../__test__/integration/release-age.int.test.ts
  - id: effected-292
    resource: "https://github.com/spencerbeggs/effected/issues/292"
---

# A pnpmfile hook that logs after its payload breaks the release-age replay

## Condition

`ReleaseAge.layer` discovers the effective `minimumReleaseAge` gate by
replaying every config-dependency plugin's pnpmfile hooks in a subprocess and
reading the child's captured stdout for a JSON payload. That read is framed
as "the last non-empty line of stdout," not a delimited or
newline-terminated payload — a documented upstream limitation this action's
wrapper cannot see or repair, tracked as
`spencerbeggs/effected#292`.[^effected-292][^release-age-service] The same
subprocess also carries two other bounds accepted as the cost of running the
replay off-process: a 30-second timeout on the child (so a looping pnpmfile
fails typed rather than hanging the memoized assemble pass) and a roughly
16 MiB ceiling on captured stdout, above which the read fails typed as too
large.[^release-age-service]

## Symptom

A pnpmfile hook that writes valid JSON **after** its actual settings — the
concrete shape is a `process.on("exit", () => console.log(...))` cleanup
logger — makes the last-line parse pick up the wrong payload (or fail
outright), and `ReleaseAge.layer`'s fail-open wrapper converts that failure
into "no gate" exactly as it would any other assembly failure: the run
proceeds silently, with no `minimumReleaseAge` gate applied for that run,
and a warning is the only visible trace.

A hook that logs valid JSON **during** execution — the ordinary shape for a
chatty plugin, and the one a real historical regression was actually about —
survives fine, because it logs before the framing's last line is captured.
`release-age.int.test.ts` exercises this during-execution case directly, as
a control: a pnpmfile that logs a decoy JSON payload mid-hook and then sets
the real settings, asserting the real contribution survives the noise and
the decoy is not mistaken for the payload.[^release-age-int-test] There is
**no dedicated test in this repository for the after-payload case** — the
gap is named only in a code comment pointing at where such a test would go,
not exercised.[^release-age-int-test]

## Why acceptable

The failure mode this limitation names was **nearly mis-filed as something
else** during its own diagnosis: a first reproduction used a hand-built
fixture and returned the inert gate, which looked damning on its own — until
a silent-hook control run against the *same* fixture also returned the inert
gate, proving the fixture itself was broken rather than the framing. Only a
reproduction built with a genuine control — the during-execution case in
`release-age.int.test.ts` passing while an after-payload case would fail —
counts as evidence here; a reproduction without a control is an anecdote.
Given that, this action's own posture is unchanged by the gap: pnpm
re-enforces `minimumReleaseAge` at install regardless, so the worst case of a
misparsed hook payload is exactly the pre-gate behavior this action had
before adopting the gate at all — see
[release-age gate discovery fails open](../decisions/release-age-fail-open.md).

## What a fix would take

The fix is upstream, in the kit's subprocess framing — moving from
last-non-empty-line parsing to a delimited or newline-terminated payload
(the tracked issue) would close this limitation without any change on this
action's side. Nothing here can filter or recover the correct payload once a
hook writes valid JSON after it, because there is no way to distinguish "the
payload" from "trailing noise that happens to parse" using only line
position.

[^release-age-service]: `src/services/release-age.ts`
[^release-age-int-test]: `__test__/integration/release-age.int.test.ts`
[^effected-292]: <https://github.com/spencerbeggs/effected/issues/292>
