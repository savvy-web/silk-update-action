---
"silk-update-action": minor
---

## Features

* Config and regular dependency resolution now respects pnpm's `minimumReleaseAge` / `minimumReleaseAgeExclude` settings. The action discovers the effective gate from both inline `pnpm-workspace.yaml` keys and config-dependency `pnpmfile` `updateConfig` hooks (replayed in a subprocess), fetches publish timestamps from the npm registry, and holds back any candidate version younger than the cutoff instead of proposing it. Runs no longer fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` when a matched dependency published inside the age window — the update is deferred until the release matures, with a log line naming how many versions were held back.
