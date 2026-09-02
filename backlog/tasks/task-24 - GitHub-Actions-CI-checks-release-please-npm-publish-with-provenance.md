---
id: TASK-24
title: 'GitHub Actions: CI checks, release-please, npm publish with provenance'
status: To Do
assignee: []
created_date: '2026-09-02 13:38'
labels:
  - infra
milestone: m-0
dependencies:
  - TASK-23
references:
  - 'https://github.com/googleapis/release-please-action'
  - >-
    backlog/decisions/decision-7 -
    release-please-with-Conventional-Commits-enforced-by-husky-and-commitlint.md
type: chore
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ci.yml runs lint, typecheck, test, and build on push and pull request with pnpm caching and Node 22, plus a pull request title check for Conventional Commits. release-please.yml runs on push to main in manifest mode tracking packages/cms with bump-minor-pre-major; when a release is created it builds and publishes @geekity/cms with pnpm publish and npm provenance. Document required secrets and branch protection in the README.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A pull request shows lint, typecheck, test, and build as separate required checks
- [ ] #2 A pull request titled without a Conventional Commit prefix fails the title check
- [ ] #3 Merging a feat commit to main opens or updates a release pull request with a changelog entry and minor bump
- [ ] #4 Merging the release pull request creates a GitHub release and a git tag, and the publish job runs against npm
- [ ] #5 README lists the NPM_TOKEN or trusted publishing setup and the branch protection rules
<!-- AC:END -->
