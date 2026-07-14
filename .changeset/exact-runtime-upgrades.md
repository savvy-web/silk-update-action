---
"silk-update-action": major
---

## Breaking Changes

The `upgrade-runtime-node`, `upgrade-runtime-deno` and `upgrade-runtime-bun` inputs no longer add a `devEngines.runtime` entry that does not already exist. Previously an explicit semver range could introduce a missing entry (promoting the object shape to an array), so a bun-only repo passing `upgrade-runtime-node` grew a node entry it never asked for. These inputs upgrade the runtimes a repo already declares; when no entry exists for the runtime, the upgrade is skipped with a warning naming the runtime and the input, in every mode.

Resolved runtime versions are now written as exact versions with no range operator. The range still drives resolution — `auto` resolves within the existing entry's range and an explicit input range selects which line to resolve — but the value written is always the bare resolved version, so an existing `^24.0.0` entry is rewritten as e.g. `24.9.1` rather than `^24.16.0`. Range operators are not supported by downstream consumers of `devEngines.runtime` (silk-runtime-action), so writing one was a latent failure in the next pipeline step.

The package-manager upgrade now emits a warning, not an info line, when no release of the detected package manager satisfies the `upgrade-package-manager` range — the usual cause is a range typed for a different package manager than the workspace uses.
