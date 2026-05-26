---
"pnpm-config-dependency-action": minor
---

## Features

### devEngines Runtime Upgrade

Adds optional automatic upgrading of `devEngines.runtime` entries (`node`, `deno`, `bun`) in the root `package.json` via a new `RuntimeUpgrade` service backed by the `runtime-resolver` package.

Four new action inputs control the feature:

| Input | Default | Behavior |
| :--- | :--- | :--- |
| `upgrade-runtime-node` | `false` | `false` disables; `auto` bumps within the existing range preserving the operator; a semver range (e.g. `^22`) selects which line to resolve but preserves the existing entry's operator on write (an exact pin stays exact), using the range's own operator only when adding a missing entry |
| `upgrade-runtime-deno` | `false` | Same semantics as `upgrade-runtime-node` |
| `upgrade-runtime-bun` | `false` | Same semantics as `upgrade-runtime-node` |
| `runtime-data` | `offline` | `offline` uses the bundled release cache only; `live` fetches current data with fallback to the bundled cache |

Resolution is limited to currently-maintained (non-end-of-life) major lines. `auto` mode is a no-op when the field is a static pin or already current. Runtime bumps appear in the PR body, commit message, and Actions summary but never trigger `pnpm install` and never create a changeset — consistent with how pnpm tooling upgrades are handled.

**Example — bump Node.js within its existing range:**

```yaml
- uses: savvy-web/pnpm-config-dependency-action@v1
  with:
    upgrade-runtime-node: auto
```

**Example — move Node.js to a specific major line with live data:**

```yaml
- uses: savvy-web/pnpm-config-dependency-action@v1
  with:
    upgrade-runtime-node: "^22"
    runtime-data: live
```
