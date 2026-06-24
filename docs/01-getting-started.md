# Getting started

Set up the Silk Update Action in your repository in four steps: create a GitHub App, store its credentials as secrets, add the workflow and run it once to confirm it works.

## Table of contents

- [Prerequisites](#prerequisites)
- [Step 1: Create a GitHub App](#step-1-create-a-github-app)
- [Step 2: Add secrets](#step-2-add-secrets)
- [Step 3: Create the workflow](#step-3-create-the-workflow)
- [Step 4: Verify](#step-4-verify)

## Prerequisites

Before setting up the action, ensure your repository meets these requirements:

- Uses **pnpm** as its package manager
- Has a `pnpm-workspace.yaml` file (for monorepo or config dependency support)
- Has a GitHub App with the required permissions (see
  [GitHub App setup](./03-github-app-setup.md))

## Step 1: Create a GitHub App

The action authenticates using a GitHub App to generate short-lived tokens with
fine-grained permissions. This is more secure than personal access tokens.

Follow the [GitHub App setup](./03-github-app-setup.md) guide to create and
configure your app.

**Required permissions:**

- `contents: write` — Push commits and manage branches
- `pull-requests: write` — Create and update pull requests
- `checks: write` — Create check runs for status visibility

## Step 2: Add secrets

Store the GitHub App credentials as repository or organization secrets:

1. Go to **Settings > Secrets and variables > Actions**
2. Add `APP_CLIENT_ID` — Your GitHub App's client ID
3. Add `APP_PRIVATE_KEY` — Your GitHub App's private key (PEM format)

## Step 3: Create the workflow

Create `.github/workflows/update-deps.yml`:

```yaml
name: Update Dependencies
on:
  schedule:
    - cron: "0 6 * * 1" # Weekly on Monday at 6am UTC
  workflow_dispatch: # Allow manual triggers

permissions:
  contents: write
  pull-requests: write
  checks: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "24"

      - uses: savvy-web/silk-update-action@v3
        with:
          app-client-id: ${{ vars.APP_CLIENT_ID }}
          app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
          config-dependencies: |
            typescript
            @biomejs/biome
          dependencies: |
            effect
            @effect/*
          peer-minor: |
            vitest
          run: |
            pnpm lint:fix
            pnpm test
```

### Choosing dependencies

**Config dependencies** (`config-dependencies` input) are packages declared in
your `pnpm-workspace.yaml` under `configDependencies`. List them one per line
with exact package names:

```yaml
config-dependencies: |
  typescript
  @biomejs/biome
  @savvy-web/pnpm-plugin-silk
```

**Workspace dependencies** (`dependencies` input) are packages in your
workspace `package.json` files — matched across `dependencies`,
`devDependencies` and `optionalDependencies`. Glob patterns are supported:

```yaml
dependencies: |
  effect
  @effect/*
  @savvy-web/*
```

**Peer dependency syncing** (`peer-lock` and `peer-minor` inputs) keeps peer
ranges in sync with workspace dependencies:

```yaml
peer-lock: |
  vitest-agent-reporter
peer-minor: |
  vitest
  @vitest/coverage-v8
```

## Step 4: Verify

1. Trigger the workflow manually from the **Actions** tab
2. The action will:
   - Generate a GitHub App token
   - Create or reset the update branch (default: `pnpm/config-deps`)
   - Update the specified dependencies
   - Run any post-update commands
   - Create a pull request with a summary of changes
3. Review the pull request for correctness

### Dry run mode

To test the action without creating commits or pull requests, enable dry-run
mode:

```yaml
- uses: savvy-web/silk-update-action@v3
  with:
    app-client-id: ${{ vars.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
    config-dependencies: |
      typescript
    dry-run: true
```

The action will detect changes and report them in the GitHub Actions summary
without modifying the repository.

## Next steps

- [Configuration](./02-configuration.md) — Explore all input options and advanced patterns
- [Troubleshooting](./06-troubleshooting.md) — Common issues and solutions
