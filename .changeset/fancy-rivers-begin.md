---
"silk-update-action": minor
---

## Features

Two new optional inputs let you control which branches the action operates against. With both unset, behavior is unchanged — the update branch is cut from `main` and the PR targets `main`.

### `source-branch` and `target-branch` inputs

`source-branch` (default `main`) is the branch the dedicated dependency-update branch is created from and reset to on each run. The pull request targets this branch unless `target-branch` overrides it.

`target-branch` (default empty) is the branch the pull request merges into. Leave it unset to follow `source-branch`; set it only when you want to cut the update from one branch but merge the PR into a different one.

```yaml
- uses: savvy-web/silk-update-action@v3
  with:
    # Cut the update branch from dev, PR into main
    source-branch: dev
    target-branch: main
```

Both refs are validated before the action performs its destructive delete-and-recreate of the update branch. If either ref does not exist, the action fails fast with a clear input error rather than mid-run.
