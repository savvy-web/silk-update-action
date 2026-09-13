---
type: Convention
title: State what would falsify a load-bearing claim, or say it is unverified
description: Every load-bearing claim in documentation, a comment, or a commit message must name what would change the answer, or say plainly that it is unverified. Re-derive counts and enumerations by command rather than editing a stale number, and check a doc against itself before checking it against the code.
stale_after: 2027-03-12T00:00:00Z
tags:
  - docs
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 0460a08ae7b097e4bf37c1629087ce87ff5a4289e25785a0ba2a3ec26af5534b
sources:
  - id: app-layer-test
    resource: ../../__test__/unit/layers/app.test.ts
---

# State what would falsify a load-bearing claim, or say it is unverified

## Rule

- When a claim is load-bearing — something a later reader or agent will act
  on without re-checking — say what specific change would make it false, or
  say plainly that it is unverified. "We believe X, and here is what would
  show us wrong" survives being wrong later; a confident claim with no
  falsification condition does not, because nothing prompts anyone to
  re-check it.
- Re-derive counts and enumerations with a command; never hand-edit one. A
  count or a file list drifts the moment it is copied instead of computed,
  and an edit made *in the same commit* as the change it describes is the one
  nobody re-checks, because the surrounding diff makes it look current.
- Never write "do not re-propose this" as the reason a decision stands. That
  sentence's only effect is to stop the next reader checking. State instead
  the condition that would change the answer — ideally one checkable with a
  single command — so the next reader has something to run rather than
  something to obey.
- Before trusting or citing a claim against the code, check it against the
  rest of the same document first. An internal contradiction needs no
  external evidence to surface — it is caught by reading the document once,
  end to end, which is cheaper than any code investigation and should happen
  first.
- Name the mechanism a claim depends on, not the feature it appears to be
  about. "This path never runs" is a claim about which of several possible
  implementations is wired; naming the feature instead of the mechanism reads
  as true to someone who does not already know which implementation is
  meant, which is a worse failure than being flatly wrong.
- A control only proves the property it controls for. Before trusting a test
  as evidence for a claim, check what it would report if the claim were
  false — an assertion that a mutant satisfies exactly as well as the
  correct code proves nothing about the difference between them, however
  green it is.
- Aim a mutation at the new *assertion*, not merely at the code that changed.
  A mutant that only exercises the changed code can leave a decorative
  assertion undetected; the question that discriminates is whether flipping
  the specific claim the test makes turns it red.
- Treat "the only ways to do X are A and B" as the highest-risk claim in a
  piece of reasoning. Every individual fact in such an argument can be true
  while the word *only* is false, because a survey of what a dependency
  lacks is not a survey of what is possible — and checking A and B harder
  will never catch that the enumeration itself was incomplete.
- When a tool's output disagrees with what you believe, treat the
  disagreement itself as the finding and investigate the tool before the
  code. A grep that returns nothing because it silently skipped a file it
  read as binary, a background notification whose direction was misread, and
  a write that reported success on a file later found absent are all tool
  output — misfiling any of them as noise, configuration, or an unreliable
  channel throws away the actual finding.
- To verify that a code path is genuinely exercised, inject a fault into it
  and confirm a test goes red — an aggregate coverage number passing does not
  establish this, because a whole module can carry zero executions while the
  suite average stays green.

## Why

Every item above is a rule recovered from a real instance of the failure it
prevents in this project's own history, not a hypothetical:

- A design document's own test count was hand-adjusted by a plausible-looking
  `+1` in the very commit that invalidated it, and the edit — landing
  alongside real, related changes — is exactly what made the wrong number
  look current.
- A raw-`node:`-import enumeration was wrong twice in two different
  directions: first by undercounting relative to its own stated total, later
  by continuing to name a file that had stopped importing `node:` at all.
- A "declined outright, do not re-propose" verdict against a package stood
  for releases after the two things the ruling itself named as its own
  falsification condition had both shipped upstream — because "do not
  re-propose" gives nobody a reason to check whether the condition was met.
- A partial reconciliation — updating some documents in the same commit that
  invalidated others — has been more dangerous than updating none, because
  the freshly-edited neighbors make a stale claim two files over look
  current by association.
- A claim that a bundler warning was "inert because that code path never
  runs" was true of one implementation variant and false of the one actually
  wired; naming the feature rather than the specific mechanism made a narrow
  true statement read as a broad false one.
- Tests written to catch a specific parsing defect asserted only that an
  operation failed, which the defect they were meant to catch also produces
  as its symptom — so the tests passed against both the bug and the fix and
  discriminated between neither.
- A comment claiming "the test double would die if this were called" was
  false of the double as actually implemented (a `Layer.succeed` that would
  have answered happily), and stood unexamined because a plausible-sounding
  justification is exactly the thing that stops a reader from checking it
  themselves.
- An argument that a git config flag "cannot be scoped" enumerated two real
  scopes (per-command, process-global) and treated the enumeration as
  exhaustive; a third scope (repository-local config) existed and made the
  conclusion wrong, while every individual fact the argument stated stayed
  true throughout.

## How to check

- `git log -p -- <doc>` against the commit that changed the code the doc
  describes: if the doc's numbers moved in the same commit as the code, they
  were very likely adjusted by feel rather than re-measured — re-derive them
  independently before trusting either.
- For a "not adopted" or "declined" claim about a dependency: `git log
  -S'<package-name>' -- package.json src/` settles whether it was adopted
  later far more reliably than re-reading the claim.
- `git log --stat <commit>` (what the commit touched) against `git grep -l
  '<the claim or package name>' -- '<docs dir>'` (every document that
  mentions it): the difference between those two lists is exactly what a
  partial reconciliation left unreconciled.
- To prove a suite exercises a code path rather than merely covering its
  lines: throw inside the path and confirm a specific test goes red. The
  compile-time layer guard in `__test__/unit/layers/app.test.ts` is the
  sharpest example in this codebase of the *inverse* discipline — its own
  runtime `expect` calls are deliberately weak, and the file says so about
  itself, because its real teeth are a type-level assertion that fails
  `pnpm typecheck` rather than a runtime check that could be satisfied by
  accident.[^app-layer-test]

[^app-layer-test]: `__test__/unit/layers/app.test.ts`
