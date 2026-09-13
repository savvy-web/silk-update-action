---
type: Glossary
title: unsatisfiable (package-manager upgrade)
description: The PackageManagerUpgrade skip kind meaning nothing in the detected manager's own release list satisfies the configured range — almost always a range typed for a different manager, and the only skip kind logged at warning.
status: draft
tags:
  - deps
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 94274ba5fb94d9d932e758d9f2a77d0bceae67cfcb299f3a13f97592f8f40591
sources:
  - id: package-manager-upgrade
    resource: ../../src/services/package-manager-upgrade.ts
---

# unsatisfiable (package-manager upgrade)

`PackageManagerSkipKind` is a five-member union
(`"disabled" | "no-reference" | "unsatisfiable" | "already-current" |
"error"`) `PackageManagerUpgrade.upgrade` returns when it does not apply a
change.[^package-manager-upgrade] `unsatisfiable` specifically means:
`NpmRegistry.versions(pm)` for the **detected** package manager returned
candidates, and none of them satisfies the synthesized target range.

The reason this earns its own glossary entry rather than reading as an
ordinary "nothing matched" case: it is overwhelmingly a **range typed for a
different manager**, not a genuinely exhausted search — the concrete shape
is an `upgrade-package-manager` range like `^11.0.0` (a plausible pnpm major)
copy-pasted into a workflow whose detected manager is bun, which correctly
and predictably satisfies nothing in bun's release list. It is deliberately
the **only** skip kind logged at warning rather than info, because reading it
as "already up to date" — which is how `already-current` reads, and which
looks superficially similar in a log — would hide a configuration mistake
behind a benign-sounding skip.

[^package-manager-upgrade]: `src/services/package-manager-upgrade.ts`
