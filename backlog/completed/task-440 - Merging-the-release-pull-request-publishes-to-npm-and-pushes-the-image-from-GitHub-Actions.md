---
id: TASK-440
title: >-
  Merging the release pull request publishes to npm and pushes the image from
  GitHub Actions
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 18:53'
updated_date: '2026-10-20 19:41'
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
- [x] #1 release-please.yml has a publish job, in environment release, that runs when release-please reports releases created and on workflow_dispatch
- [x] #2 The publish job runs pnpm release: npm through trusted publishing with no npm token, the image to ghcr.io with GITHUB_TOKEN, both platforms
- [x] #3 Every published package.json names its repository, so npm accepts the provenance trusted publishing attaches
- [x] #4 The Dockerfile labels the image with its source repository
- [x] #5 pnpm release still works from a maintainer's machine
- [x] #6 docs/development.md and the comments in release-please.yml and scripts/release.ts describe the automated publish
- [x] #7 A release reaches npm with provenance and ghcr.io with both platforms from Actions before 2026-10-22
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built on branch release-from-actions (7a2eedcc..d1d18ca8). lint, format:check, typecheck, 47 release tests and actionlint pass; checkout git sequence replayed locally. Awaiting the first real run on the 0.36.1 release.

First run 2026-10-20, run 39483801467 (publish 19:29-19:40Z, about 11 min with gates and the QEMU arm64 build): published @geekity/cms 0.36.1, plugin-wordpress 0.7.1, plugin-llm 0.4.1, plugin-post-summary 0.6.1, plugin-tag-suggest 0.5.1, each with SLSA provenance; ghcr.io/geekitycom/cms:0.36.1 has linux/amd64 and linux/arm64, and the package is now linked to geekitycom/cms. The release environment had no required reviewer, so the job ran without approval.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Merging the release PR now publishes from GitHub Actions. release-please.yml gained a publish job (environment release, id-token and packages write) that runs pnpm release when release-please creates releases, or on workflow_dispatch. npm authenticates through trusted publishing with no token. scripts/release.ts skips npm whoami when an OIDC token is present. Every package.json names its repository so npm accepts provenance, and the Dockerfile labels its source. docs/development.md documents the flow, with pnpm release kept as the local fallback. Verified by the release tests and actionlint, then by the first real run, which published all five packages with provenance and a two-platform image. PR #212.
<!-- SECTION:FINAL_SUMMARY:END -->
