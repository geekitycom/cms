---
id: TASK-90
title: >-
  pnpm docker:build-push: build both architectures and push to
  ghcr.io/geekitycom/cms under the package version
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-19 15:25'
updated_date: '2026-09-19 21:11'
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
- [x] #1 pnpm docker:dry-run prints the image name and the version, latest and custom tags it would push, and builds nothing
- [x] #2 The version tag is read from packages/cms/package.json
- [x] #3 A failing quality gate stops the script before any build
- [ ] #4 A real run pushes a manifest list for linux/amd64 and linux/arm64, confirmed with docker buildx imagetools inspect
- [x] #5 The README release section says when and how to run it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Seam under test: the script's command line (arguments, working directory, exit status, output). docker and pnpm are the external boundaries; tests put stub docker/pnpm executables first on PATH that log each call and fail on demand, and run the real script inside a temp fixture repo (Dockerfile, package.json, packages/cms/package.json with a made-up version) so nothing real is built or pushed.

1. packages/cms/src/docker-build-push.test.ts (the only test glob CI runs); vertical slices, red then green:
   a. --dry-run prints ghcr.io/geekitycom/cms with the version, latest and custom tags, calls no buildx build and runs no gate (AC #1).
   b. the version tag comes from packages/cms/package.json, not the root package.json (AC #2).
   c. a failing gate (each of lint, format:check, typecheck, test) exits non-zero before any buildx build, and later gates do not run (AC #3).
   d. a real run (stubbed) builds linux/amd64,linux/arm64 with --push and all three tags, after all gates pass.
   e. refuses to run from a subdirectory; Docker not running and a failed ghcr.io login stop it; bad custom tag / unknown option rejected.
2. scripts/docker-build-push.sh modelled on iheartrss: bash 3.2 compatible, shellcheck clean; buildx builder 'multiplatform'; docker config read from ${DOCKER_CONFIG:-$HOME/.docker}.
3. Root package.json: docker:build-push and docker:dry-run.
4. README Releasing: 'Publishing the Docker image' subsection (when: after merging the release PR and pulling main; how; dry-run; custom tag; verify with imagetools inspect).
5. Gates: pnpm build/test/typecheck/lint/format:check, real pnpm docker:dry-run, optional local multi-arch build without push. No registry push or login: AC #4 left for the user's first real run.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built scripts/docker-build-push.sh (bash 3.2 compatible, shellcheck clean), root scripts docker:build-push and docker:dry-run, README 'Publishing the Docker image' under Releasing plus two Commands rows and a pointer in 'How a release flows'.

Decisions:
- --dry-run prints image, version (and its source file), platforms, gates and tags, and touches nothing: no docker call, no login prompt, no gates. It still refuses outside the repo root and rejects a bad tag.
- Real run: Docker running check, ghcr.io entry in ${DOCKER_CONFIG:-~/.docker}/config.json (else docker login ghcr.io), gates lint, format:check, typecheck, test in that order, then docker buildx build --builder multiplatform (created with the docker-container driver on first use) --platform linux/amd64,linux/arm64 --pull --no-cache with the version, latest and optional custom tags, --push. Prints the imagetools inspect command at the end.
- Repo-root check compares pwd -P with the script's parent dir and requires Dockerfile and packages/cms/package.json.
- Custom tag validated against Docker's tag grammar; unknown options and a second tag are rejected.

Tests: packages/cms/src/docker-build-push.test.ts (13 tests; placed in cms/src because that is the glob CI runs). Each runs a copy of the script in a temp fixture repo with stub docker/pnpm first on PATH that log calls and fail on demand; the fixture's packages/cms/package.json holds a made-up version and the root package.json 0.0.0. Covers dry-run output with no build/gates/login (AC #1), version from packages/cms/package.json (AC #2), each of the four gates failing stops before any buildx build and skips later gates (AC #3), a stubbed real run's exact buildx arguments, subdir refusal, Docker down, failed login, bad tag, unknown option.

Validation: pnpm build, pnpm test (1937 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all green. Real pnpm docker:dry-run prints ghcr.io/geekitycom/cms:0.3.0 and :latest (plus :rc1 with a custom tag); running the script from apps/demo exits 1 with the root message. A local multi-arch build with the same flags minus --push/--no-cache on a throwaway docker-container builder (task90-verify, removed afterwards) built both linux/amd64 and linux/arm64 successfully.

AC #4 is NOT checked: it needs a real push to ghcr.io, which is the user's call and was not done (no registry login or push in this task). It awaits the user's first real run: pnpm docker:build-push, then docker buildx imagetools inspect ghcr.io/geekitycom/cms:<version> should list linux/amd64 and linux/arm64. Task stays In Progress for that.
<!-- SECTION:NOTES:END -->
