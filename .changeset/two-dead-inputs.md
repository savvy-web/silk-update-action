---
"silk-update-action": minor
---

## Features

Remove the dead `log-level` and `skip-token-revoke` inputs. Logging now has two modes only — normal, or debug when the runner's step-debug flag (`ACTIONS_STEP_DEBUG` / `RUNNER_DEBUG`) is enabled — matching what the previous `auto` default already did. The post phase now always revokes the GitHub App installation token, which was the default behavior. Workflows passing either input will see an unexpected-input warning; remove the lines.
