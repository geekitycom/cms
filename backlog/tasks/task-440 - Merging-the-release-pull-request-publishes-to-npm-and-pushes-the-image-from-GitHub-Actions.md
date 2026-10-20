---
id: TASK-440
title: >-
  Merging the release pull request publishes to npm and pushes the image from
  GitHub Actions
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-20 18:53'
labels:
  - release
  - ci
dependencies: []
priority: high
ordinal: 377800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Publishing was manual (decision-7): a maintainer ran pnpm release on main after merging the release PR, because GitHub runners could not build the arm64 image and publishing was meant to be a deliberate choice. Both reasons have gone: merging the release PR is the deliberate choice, the release environment's required reviewer is a last click, and QEMU or arm64 runners build both platforms. npm trusted publishing (OIDC) is configured on npmjs.com for all five packages with workflow release-please.yml and environment release, and npm asks for a publish before 2026-10-22 to validate it. decision-58 records the change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 release-please.yml has a publish job, in environment release, that runs when release-please reports releases created and on workflow_dispatch
- [ ] #2 The publish job runs pnpm release: npm through trusted publishing with no npm token, the image to ghcr.io with GITHUB_TOKEN, both platforms
- [ ] #3 Every published package.json names its repository, so npm accepts the provenance trusted publishing attaches
- [ ] #4 The Dockerfile labels the image with its source repository
- [ ] #5 pnpm release still works from a maintainer's machine
- [ ] #6 docs/development.md and the comments in release-please.yml and scripts/release.ts describe the automated publish
- [ ] #7 A release reaches npm with provenance and ghcr.io with both platforms from Actions before 2026-10-22
<!-- AC:END -->
