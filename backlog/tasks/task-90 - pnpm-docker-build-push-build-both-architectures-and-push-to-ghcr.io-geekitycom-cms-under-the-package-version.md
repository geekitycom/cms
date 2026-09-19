---
id: TASK-90
title: >-
  pnpm docker:build-push: build both architectures and push to
  ghcr.io/geekitycom/cms under the package version
status: To Do
assignee:
  - '@claude'
created_date: '2026-09-19 15:25'
labels:
  - infra
milestone: m-15
dependencies:
  - TASK-89
references:
  - /Users/andrewshell/code/projects/iheartrss/scripts/docker-build-push.sh
  - release-please-config.json
  - packages/cms/package.json
type: feature
ordinal: 115800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Publishing an image is done by hand from a workstation, as in iheartrss: GitHub runners are amd64 only and the box may be arm64, so nothing in CI pushes. Add scripts/docker-build-push.sh and the root package.json scripts docker:build-push and docker:dry-run, modelled on /Users/andrewshell/code/projects/iheartrss/scripts/docker-build-push.sh. The script checks Docker is running and ghcr.io is logged in, runs the quality gates (lint, format:check, typecheck, test), then uses a buildx builder to build linux/amd64 and linux/arm64 and push ghcr.io/geekitycom/cms tagged with the version in packages/cms/package.json (which release-please bumps), latest, and an optional custom tag given as an argument. --dry-run prints what it would build and push without doing it. It refuses to run from anywhere but the repo root. The expected order after a release is: merge the release PR, pull main, run the script.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm docker:dry-run prints the image name and the version, latest and custom tags it would push, and builds nothing
- [ ] #2 The version tag is read from packages/cms/package.json
- [ ] #3 A failing quality gate stops the script before any build
- [ ] #4 A real run pushes a manifest list for linux/amd64 and linux/arm64, confirmed with docker buildx imagetools inspect
- [ ] #5 The README release section says when and how to run it
<!-- AC:END -->
