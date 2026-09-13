---
type: Convention
title: Code style — extensions, tabs, no barrels, conventional commits
description: "Relative TS imports carry an explicit .js extension; Node built-ins use the node: protocol; type-only imports use `import type`; formatting is tabs, enforced by Biome; commits are conventional format with DCO signoff and no markdown in the body; no barrel re-exports anywhere."
stale_after: 2027-03-12T00:00:00Z
tags:
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: f01696f4d98162a76020fedc7c6c7514ef4d34e542513d1095b5c694c623e749
sources:
  - id: biome-config
    resource: ../../biome.json
  - id: lint-staged-config
    resource: ../../lib/configs/lint-staged.config.ts
  - id: commitlint-config
    resource: ../../lib/configs/commitlint.config.ts
  - id: package-json
    resource: ../../package.json
---

# Code style — extensions, tabs, no barrels, conventional commits

## Rule

- Relative imports of TypeScript modules carry an explicit `.js` extension
  (the emitted form), even though the source file is `.ts` — this is an ESM
  requirement, not a stylistic choice.
- Node.js built-ins are imported through the `node:` protocol
  (`node:fs`, `node:path`), never bare (`fs`, `path`).
- Type-only imports are written `import type { Foo } from "…"`, kept
  separate from value imports rather than inlined as `import { type Foo }`.
- Formatting is **tabs**, not spaces, enforced by Biome — do not hand-format;
  the pre-commit hook applies formatting and safe fixes automatically.
- No barrel re-exports (`index.ts` files that only re-export) anywhere in
  `src/` — import directly from the module that defines a symbol.
- Commits are conventional-commit format with a DCO `Signed-off-by:` trailer,
  and the body must not contain markdown (enforced by the `silk/body-no-markdown`
  commitlint rule).
- `@actions/*` is never imported directly — the `@effected/github-actions`
  kit implements the GitHub Actions runtime protocol natively; a raw
  `@actions/*` import is a signal something reached for the wrong package.
- `Schema.TaggedError`, not `Schema.TaggedErrorClass` — the latter existed
  only on early Effect v4 betas and does not exist in the version this
  repository runs. See [the tagged-error rename gotcha](../gotchas/tagged-error-rename-presents-as-call-site-errors.md)
  for how using the wrong one actually presents (as ~50 unrelated-looking
  call-site errors, not as one).

## Why

The extension and protocol rules exist because this is a pure-ESM package —
Node resolves relative specifiers exactly as written, with no extension
inference, so an import written without `.js` fails at runtime even though it
typechecks. The `node:` protocol and `import type` separation are Biome
lint rules enforced at commit time (`useNodejsImportProtocol`,
`useImportType`, `useImportExtensions`) rather than conventions relying on
review to catch.

No barrels exist because this is a single-package action, not a library
publishing a curated public surface — a barrel would add an indirection layer
with nothing to hide behind it, and every barrel is one more place an import
cycle or a tree-shaking regression can hide.

## How to check

Formatting, import shape, and the conventional-commit contract are enforced
mechanically, not by review:

- `pnpm run lint` — Biome check (`biome.json` extends the shared
  `@savvy-web/silk/biome` preset).[^biome-config]
- `pnpm run typecheck` — `tsc`/`tsgo` via Turbo; catches a missing `.js`
  extension or a `Schema.TaggedErrorClass` typo as a compile error.
- `pnpm run lint:md` — markdownlint-cli2 over `okf/**` and the rest of the
  repository's markdown.
- Husky's pre-commit hook runs lint-staged
  (`lib/configs/lint-staged.config.ts`, `Preset.silk()`) over staged files
  automatically: Biome check+fix for JS/TS/JSON, markdownlint-cli2 --fix for
  markdown, and a blocking `tsc --noEmit` with no autofix — a type error
  fails the commit; nothing else in that pipeline does.[^lint-staged-config]
- `commit-msg` runs commitlint (`lib/configs/commitlint.config.ts`,
  `CommitlintConfig.silk()`) against the conventional-commit + DCO + no-markdown
  contract; `pre-push` runs the test suite.[^commitlint-config]

Do not hand-format, hand-sort imports, or hand-order `package.json` keys —
all three are applied automatically at commit time; a hand-formatted diff
just gets reformatted again.

[^biome-config]: `biome.json`
[^lint-staged-config]: `lib/configs/lint-staged.config.ts`
[^commitlint-config]: `lib/configs/commitlint.config.ts`
