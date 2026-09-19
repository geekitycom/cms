---
id: TASK-91
title: CI builds the image and smoke-tests it on every pull request
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-19 15:25'
updated_date: '2026-09-19 21:16'
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
- [x] #2 The job boots the built image on empty volumes and checks /healthz and the home page
- [x] #3 The job pushes nothing to any registry
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add scripts/docker-smoke.sh: build (unless given an image tag) a single linux/amd64 image with plain docker build/buildx --load, never push. Start it with fresh empty named volumes on /site/content and /site/data and GEEKITY_BASE_URL set, wait for GET /healthz to answer 200 (fail early if the container exits), GET / and check it is the default theme (links /theme/style.css, carries data-is-root-path), and compare /theme/style.css byte for byte with packages/cms/themes/default/static/style.css. Print container logs on failure; remove container and volumes on exit. Names prefixed so parallel runs do not collide.
2. Add a docker-smoke job to .github/workflows/ci.yml on an amd64 Blacksmith runner (the other jobs are arm64; building amd64 there would need QEMU): docker/setup-buildx-action, docker/build-push-action with platforms linux/amd64, load: true, push: false, cache-from/to type=gha, then run the script against the loaded tag. No registry login, permissions stay contents: read.
3. Add pnpm docker:smoke script to package.json.
4. Verify locally: run the smoke against the real Dockerfile (pass), against a deliberately broken Dockerfile copy (fail), and with a broken CMD (fail at healthz). Validate the workflow with actionlint. Run the quality gates. Clean up images/containers/volumes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- scripts/docker-smoke.sh (+ pnpm docker:smoke): with no argument builds the root Dockerfile for GEEKITY_SMOKE_PLATFORM (default linux/amd64) with buildx --load; with IMAGE, tests that image. Runs it on two fresh named volumes (/site/content, /site/data), -e GEEKITY_BASE_URL, host port picked by Docker on 127.0.0.1. Waits up to 90s for /healthz 200 (fails at once if the container exits), then GET / must contain 'Hello, world' (seeded starter), href="/theme/style.css" and data-is-root-path (default theme's base.njk), and /theme/style.css must cmp equal to packages/cms/themes/default/static/style.css. Prints docker logs on failure; removes container, volumes and any image it built on every exit.
- ci.yml job docker-smoke on blacksmith-2vcpu-ubuntu-2404 (amd64; every other job is arm64, and amd64 there would need QEMU). setup-buildx-action@v4 + build-push-action@v7 with platforms linux/amd64, load true, push false, provenance false, cache type=gha scope=docker-smoke mode=max; then bash scripts/docker-smoke.sh geekity-smoke:ci. No setup-workspace (no Node/pnpm needed), no login, workflow permissions stay contents: read.
- README: command table, CI job table, a docker-smoke paragraph, scripts/ tree line, and a sentence in Publishing the Docker image.

Local evidence (Docker 29.8.0, buildx 0.37.0, Apple silicon):
- real Dockerfile, linux/arm64: passed in 21s; linux/amd64 (emulated): passed in 27s. No geekity-t91 containers, volumes or images left after.
- COPY packages/cmz (build break): docker buildx build exits 1 ('/packages/cmz: not found'), which is what fails the build-push-action step in CI.
- CMD geekity serv: smoke exits 1, 'the container exited before /healthz answered', log shows 'Unknown command "serv"'.
- GEEKITY_SEED_CONTENT=false: healthz 200 but smoke exits 1 on missing 'Hello, world'.
- style.css overwritten in the image: smoke exits 1 on the stylesheet comparison.
- actionlint 1.7.12 (docker image, removed after): only runner-label warnings for the Blacksmith labels, the same as every existing job; no other findings. shellcheck stable: clean.
- pnpm build && pnpm test (1937 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check: all pass.

Not provable here: AC #1 needs a real pull request run on GitHub (the orchestrator opens the PR, whose CI runs docker-smoke). Also unverified until then: that the Blacksmith amd64 runner honours type=gha cache and that the second run is quick.
<!-- SECTION:NOTES:END -->
