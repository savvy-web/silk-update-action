---
"pnpm-config-dependency-action": patch
---

## Bug Fixes

Stops the action from creating an empty commit and opening a spurious pull request when a `run` command leaves the working tree dirty only by an executable-bit change (for example, husky chmod-ing `.husky` hook scripts during `savvy-commit init`).

* Change detection now runs `git status` with `core.fileMode=false`, so file-mode-only changes are ignored and no longer bypass the no-changes early exit
* This matches what the action actually commits — file content via the GitHub API at mode `100644` — so a mode-only diff can no longer produce an empty commit
