---
id: decision-58
title: >-
  Merging the release pull request publishes to npm and ghcr.io from Actions,
  behind the release environment
date: '2026-10-20 18:53'
status: accepted
---
## Context

decision-7 kept publishing manual. A maintainer ran `pnpm release` on main after merging the release pull request. There were two reasons. A release should reach npm only when a maintainer chooses. GitHub's hosted runners were amd64 only, so CI could build only half of the multi-arch image.

Neither reason holds now. Merging the release pull request is the maintainer's choice. The repository is public, so QEMU on an amd64 runner, or a hosted arm64 runner, can build both platforms. npm trusted publishing (OIDC) lets a workflow publish without a stored token, and it attaches provenance.

## Decision

The `release-please` workflow gets a publish job. It runs when release-please reports that a release was created, and on `workflow_dispatch`. It runs in the GitHub environment `release`, whose required reviewer approves each run. The job runs `pnpm release`, which stays the single release path:

- npm through trusted publishing. Each package trusts `geekitycom/cms`, `release-please.yml` and the environment `release`.
- The image goes to `ghcr.io/geekitycom/cms` with the workflow's `GITHUB_TOKEN`.

`pnpm release` still works from a maintainer's machine.

## Consequences

- Every published `package.json` names its repository, because npm refuses provenance that does not match it.
- The ghcr.io package grants the repository's Actions write access.
- No npm token is stored anywhere.
- A failed run is retried by dispatching the workflow again, because `pnpm release` publishes only what the registries lack.

