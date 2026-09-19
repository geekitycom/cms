---
id: TASK-89
title: >-
  Dockerfile: a multi-arch image that runs geekity serve over mounted content
  and data, in the default theme
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-19 15:24'
updated_date: '2026-09-19 21:05'
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
- [x] #1 docker build produces an image that boots with empty content and data volumes, seeds the starter site, and answers 200 on /healthz and on the home page in the default theme
- [x] #2 The image holds no apps/demo files, no demo theme, no tests and no devDependencies, checked by listing the image filesystem
- [x] #3 The container runs as uid 1000, and content written through the admin survives a container restart on the same volumes
- [x] #4 A theme mounted under the themes volume and named in site.json is the one rendered
- [ ] #5 geekity user add and geekity rebuild run through docker exec against the mounted directories
- [x] #6 The image builds and sharp loads on both linux/amd64 and linux/arm64
- [x] #7 The .dockerignore keeps .env files, data directories, node_modules, .git and backlog out of the build context
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add .dockerignore at the repo root: .git, node_modules (every level), dist, .env/.env.*, data dirs, backlog, apps/*/data, coverage, OS noise, the Dockerfile itself.
2. Add a multi-stage Dockerfile on a pinned node:24.18 base (matches .node-version 24 and the local 24.18.0):
   - build stage: pnpm from packageManager via corepack; copy only the workspace manifests and lockfile, pnpm fetch (dependency layer, cached until the lockfile changes), then offline install with --ignore-scripts (husky prepare), copy packages/cms sources, pnpm build (tsc + editor bundle), then pnpm deploy --prod of @geekity/cms to /prod/cms so only the package files (dist, admin, themes, templates) and production deps are carried.
   - runtime stage: copy /prod/cms to /app, geekity on PATH, /site/{content,data,themes} owned by node, ENV GEEKITY_CONTENT_DIR/DATA_DIR/THEMES_DIR and GEEKITY_SEED_CONTENT=true, NODE_ENV=production, USER node, WORKDIR /site, EXPOSE 3000, HEALTHCHECK on /healthz reading GEEKITY_PORT then PORT in node, CMD geekity serve.
   - comment explaining the Debian-slim vs Alpine choice for sharp's prebuilt binaries.
3. Verify with docker: build; run on empty named volumes and curl /healthz and /; list image filesystem for apps/demo, demo theme, tests, devDependencies; id -u; write content through the admin, restart, confirm it persists; mount a site theme and select it in site.json; docker exec geekity user add and geekity rebuild; buildx build for linux/amd64 and linux/arm64 and load sharp in each; rebuild without changes and confirm cached dependency layer.
4. Run pnpm build/test/typecheck/lint/format:check; clean up geekity-t89 containers, volumes and images.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: Dockerfile and .dockerignore at the repo root. No unit tests: a Dockerfile is verified by building and running the image, which is what was done.

Design:
- Base node:24.18.0-trixie-slim (ARG NODE_IMAGE), pinned to .node-version 24 at the 24.18.0 the workspace runs. Debian slim over Alpine for sharp's glibc prebuilts; the reason is in a Dockerfile comment.
- Build stage: corepack pnpm 12.4.2; pnpm fetch from the lockfile alone (the dependency layer), then an offline frozen install with --ignore-scripts (the root prepare runs husky), pnpm --filter @geekity/cms build, then pnpm deploy --prod to /prod/cms.
- @types/node was the one devDependency left after --prod. sharp names it as an optional peer, so the lockfile ties sharp to it. It is deleted after the deploy, together with undici-types, which nothing else depends on. sharp was checked afterwards: it still loads and encodes on both architectures.
- Runtime: /app holds the package (dist, admin, themes/default, templates, prod node_modules). geekity is chmod +x and symlinked onto PATH, because tsc does not set the exec bit and the node entrypoint would otherwise treat 'geekity' as a script path. /site/{content,data,themes} are owned by node. ENV sets GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR and GEEKITY_THEMES_DIR, plus GEEKITY_SEED_CONTENT=true and NODE_ENV=production. WORKDIR is /site (no config file), USER node, EXPOSE 3000. The HEALTHCHECK is exec-form node fetch of /healthz with port GEEKITY_PORT||PORT||3000 and --start-interval=5s. CMD is geekity serve.

Evidence (docker 29.8.0, Docker Desktop, arm64 host):
- AC1: run on empty named volumes with GEEKITY_BASE_URL set. Logs showed 'Seeded /site/content with the starter site'. /healthz returned 200, / returned 200, and docker health status was healthy. The served /theme/style.css sha1 equals packages/cms/themes/default/static/style.css (583f76de) and differs from the demo theme's. The seeded site.json has no theme and url=GEEKITY_BASE_URL.
- AC2: /app contains LICENSE, README.md, admin, dist, node_modules, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, templates and themes (themes holds only default). find over the image turned up no apps/ path and no demo directory. The only *.test.ts files are ones @fedify/vocab-runtime publishes inside its own npm package, none from this repo. .pnpm contains none of @11ty, typescript, tsx, esbuild, codemirror, highlight.js, @fedify/cli or @types. /app is 122M.
- AC3: id -u prints 1000, Config.User is node, and docker top shows uid 1000. Signed in at /admin/login and published a post through POST /admin/posts/new; the file landed in /site/content/posts. The post was still on the home page after docker restart and after docker rm plus a fresh docker run on the same volumes, with no reseed of non-empty content, and admin sign-in still worked.
- AC4: bind-mounted a themes dir holding t89/theme.json, static/style.css and layouts/base.njk (with a marker). Before choosing, the default theme was served. After setting theme=t89 in site.json, with no restart, the marker was in the HTML and /theme/style.css was the mounted one.
- AC5 (NOT checked): 'docker exec <c> geekity user add admin --password ... --email ...' created /site/data/users.json and the user could sign in. 'docker exec <c> geekity sync' works. 'docker exec <c> geekity rebuild' exits 1 with '/site/data/geekity.db is in use ... Stop the server and run this again'. That is rebuild's deliberate guard (cli.ts), and serve is PID 1, so exec can never reach rebuild with the server stopped. Tested and working instead: stop the container, then 'docker run --rm -v <content>:/site/content -v <data>:/site/data <image> geekity rebuild', which rebuilt the index (Scanned 3: 3 created), after which the container started normally. For compose that is 'docker compose run --rm <service> geekity rebuild' with the service stopped. The criterion needs a decision: reword it to that route (TASK-92 can document it), or change rebuild. geekity import wordpress-actor runs through exec and reaches its argument validation.
- AC6: docker buildx build --platform linux/amd64,linux/arm64 --load succeeded. On each platform uname -m reported x86_64 or aarch64, @img/sharp-linux-x64 or -arm64 was installed, and sharp 0.35.4 encoded a 4x4 webp (68 bytes). The amd64 image booted under QEMU with /healthz 200 and / 200.
- AC7: a probe build that COPY . over the real context, with .env, .env.production, packages/cms/.env and data/ planted, contained no .env*, node_modules, .git, backlog, data or dist (apps/demo/data excluded too). The context was 5.3M.
- Cache: a second build with no changes was CACHED on every step. With a source edit in packages/cms/src, fetch and install stayed CACHED and only COPY packages/cms, build and deploy re-ran.
- Gates: pnpm build && pnpm test (1924 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check, exit 0.
- Cleanup: removed all geekity-t89 containers, volumes and images.
<!-- SECTION:NOTES:END -->
