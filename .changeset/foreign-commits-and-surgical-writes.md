---
"silk-update-action": minor
---

## Features

### Commits pushed to the update branch are no longer discarded

Each run used to force-reset the update branch, silently deleting any commit someone had pushed to it, such as a fix to make `check-peers` pass. The action now checks the branch first. If any commit ahead of the source branch was not made by the action's GitHub App, the run leaves the branch and its pull request untouched, makes no updates, and concludes its check run as `neutral`, listing each commit and how to clear it. `has-changes` is `false` for such a run.

Merge or close the pull request, or delete the branch, and the next run updates it again. When the token carries no App identity, the check is skipped with a warning and the branch is reset as before.

## Bug Fixes

* Dependency, peer-dependency and catalog updates to `package.json` now change only the values they update. Indentation, key order and every other field are kept byte for byte, where the file used to be re-serialized as a whole. A newly created `catalog` or `catalogs` block is added at the end of the file.
* `pnpm-workspace.yaml` keys are now sorted fully alphabetically, `packages` included, matching the `@savvy-web/silk` lint hook so it no longer reorders the file after the action commits.
