---
"pnpm-config-dependency-action": major
---

## Breaking Changes

The `app-id` input has been renamed to `app-client-id`. Update your workflow's `with:` block when upgrading.

## Features

Migrate to `@savvy-web/github-action-effects` 2.0 and `workspaces-effect` 1.0, adopting a three-phase (pre/main/post) GitHub App token lifecycle. The installation token is provisioned in a pre step — with up-front verification that the App grants `contents`, `pull-requests`, and `checks` write — and revoked in a post step via the `GitHubToken` namespace, replacing the previous in-process token bridge. A new optional `skip-token-revoke` input skips revocation in the post step (tokens expire after 1 hour regardless).

Adopt `@savvy-web/silk-effects` for publishability detection, replacing the action's local copy of the silk rules. Changeset creation now honors `.changeset/config.json` `ignore`: a package listed there is never given a changeset, even when `privatePackages.version` is enabled.
