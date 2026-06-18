---
"silk-update-action": minor
---

## Features

PR titles and branch commit subjects are now generated from the run's actual contents instead of the static `chore(deps): Update Silk Dependencies`. Each run produces a specific, readable subject that reflects what changed.

Examples of generated titles:

- `chore(deps): upgrade pnpm to 10.12.1`
- `chore(deps): upgrade Node to 24.16.0`
- `chore(deps): bump effect to 3.19.1`
- `chore(deps): upgrade pnpm and update 6 dependencies`
- `chore(deps): update 3 config and 12 dependencies`

Single changes are named outright; single-category runs are summarized; mixed runs compose an `upgrade … and update …` shape. All subjects keep the `chore(deps):` conventional-commit prefix and stay within the 72-character header budget (falling back to `chore(deps): update dependencies` when a composed subject would overflow).
