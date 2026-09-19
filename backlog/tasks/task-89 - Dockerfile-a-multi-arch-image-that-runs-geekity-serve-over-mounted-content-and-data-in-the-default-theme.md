---
id: TASK-89
title: >-
  Dockerfile: a multi-arch image that runs geekity serve over mounted content
  and data, in the default theme
status: To Do
assignee:
  - '@claude'
created_date: '2026-09-19 15:24'
labels:
  - infra
milestone: m-15
dependencies:
  - TASK-87
  - TASK-88
references:
  - /Users/andrewshell/code/projects/iheartrss/Dockerfile
  - /Users/andrewshell/code/projects/iheartrss/.dockerignore
  - .node-version
  - packages/cms/package.json
type: feature
ordinal: 114800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a Dockerfile and .dockerignore at the repo root that build the generic Geekity image from the workspace: build @geekity/cms (tsc and the editor bundle) in a build stage, then carry only the package and its production dependencies into the runtime stage (for example with pnpm deploy --prod), so apps/demo, its demo theme, the test suites and devDependencies are not in the image. The runtime runs `geekity serve` with no config file, as the unprivileged node user (uid 1000), with content, data and themes directories under one root (for example /site/content, /site/data, /site/themes) set through GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR and GEEKITY_THEMES_DIR, content seeding switched on (TASK-88), and a HEALTHCHECK on /healthz (TASK-87) that reads the port from the environment inside node, as the iheartrss Dockerfile explains. With no theme in site.json the site renders the packaged default theme; a site theme mounted under themes/ and named in site.json is used instead. The node base image tag is pinned to match .node-version. sharp is a native module, so the base (Alpine or Debian slim) is chosen so its prebuilt binaries load on both linux/amd64 and linux/arm64, and that choice is explained in a Dockerfile comment. The operator commands (geekity user add, geekity rebuild, geekity import wordpress-actor) work through docker exec against the same directories. A second build without source changes reuses the dependency layer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docker build produces an image that boots with empty content and data volumes, seeds the starter site, and answers 200 on /healthz and on the home page in the default theme
- [ ] #2 The image holds no apps/demo files, no demo theme, no tests and no devDependencies, checked by listing the image filesystem
- [ ] #3 The container runs as uid 1000, and content written through the admin survives a container restart on the same volumes
- [ ] #4 A theme mounted under the themes volume and named in site.json is the one rendered
- [ ] #5 geekity user add and geekity rebuild run through docker exec against the mounted directories
- [ ] #6 The image builds and sharp loads on both linux/amd64 and linux/arm64
- [ ] #7 The .dockerignore keeps .env files, data directories, node_modules, .git and backlog out of the build context
<!-- AC:END -->
