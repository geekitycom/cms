---
id: TASK-91
title: CI builds the image and smoke-tests it on every pull request
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
  - .github/workflows/ci.yml
type: task
ordinal: 116800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The image is pushed by hand, so a broken Dockerfile would otherwise surface only at release time on a workstation. Add a job to .github/workflows/ci.yml that builds the image for linux/amd64 without pushing, starts it with empty content and data volumes, waits for /healthz to answer 200, fetches the home page and checks it is the default theme, and fails the job if any step fails. Use the buildx GitHub Actions cache so the job stays quick.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A pull request that breaks the Dockerfile fails CI
- [ ] #2 The job boots the built image on empty volumes and checks /healthz and the home page
- [ ] #3 The job pushes nothing to any registry
<!-- AC:END -->
