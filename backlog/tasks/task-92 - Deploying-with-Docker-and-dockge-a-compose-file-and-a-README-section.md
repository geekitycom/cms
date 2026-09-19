---
id: TASK-92
title: 'Deploying with Docker and dockge: a compose file and a README section'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-19 15:25'
updated_date: '2026-09-19 21:24'
labels:
  - infra
  - docs
milestone: m-15
dependencies:
  - TASK-89
  - TASK-90
references:
  - /Users/andrewshell/code/projects/iheartrss/docker-compose.yml
  - /Users/andrewshell/code/projects/iheartrss/README.md
  - README.md
type: docs
ordinal: 117800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write the deployment an operator follows. Add a compose file (for example deploy/compose.yaml) meant to be pasted into a dockge stack, modelled on /Users/andrewshell/code/projects/iheartrss/docker-compose.yml: the image pulled by a pinned tag from .env (GEEKITY_TAG), never built on the box; ./content, ./data and optional ./themes bind mounts; the port published on 127.0.0.1 only, because Docker publishes ahead of the host firewall; GEEKITY_BASE_URL and GEEKITY_TRUST_PROXY=true for the TLS reverse proxy in front; init, restart, memory and pid limits, no-new-privileges, dropped capabilities and bounded json-file logs; and the healthcheck. Add a Deploying with Docker section to the README covering: creating content/ and data/ owned by uid 1000 before the first start; the environment variables that matter in a container; first login through the setup screen or docker exec geekity user add; bringing a WordPress author across with docker exec geekity import wordpress-actor; what to back up (all of content/, plus data/users.json and data/keys/, while data/geekity.db and data/images/ are derived and rebuilt); upgrading and rolling back by changing the tag; and choosing a custom theme.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The compose file starts the published image on a box with no repo checkout, given only its .env and two empty directories owned by uid 1000
- [x] #2 The port is bound to 127.0.0.1 and the image tag comes from .env
- [x] #3 The README section covers directories and ownership, environment, first login, WordPress import, backups, upgrade and rollback, and custom themes
- [ ] #4 Following the README on a fresh machine reaches the setup screen, checked once by hand
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add deploy/compose.yaml for a dockge stack, modelled on the iheartrss compose file: image ghcr.io/geekitycom/cms:${GEEKITY_TAG} (required, no latest fallback, never built); env_file .env plus fixed environment (GEEKITY_PORT=3000, GEEKITY_TRUST_PROXY=true, GEEKITY_BASE_URL required); ./content and ./data bind mounts, ./themes optional and read-only; port published on 127.0.0.1 only with the host side from GEEKITY_HOST_PORT; init, restart, mem and pid limits, no-new-privileges, cap_drop ALL, bounded json-file logs; the healthcheck reading the port inside node.
2. Add a 'Deploying with Docker' section to the README: stack creation, content/ and data/ owned by uid 1000, the .env and the variables that matter, reverse proxy (X-Forwarded-For overwrite), first login (setup screen or docker compose exec geekity user add), WordPress import through docker compose exec, backups (content/, data/users.json, data/keys/; geekity.db and images/ derived), upgrade and rollback by tag (with the stop/run --rm rebuild/start path for a newer database), custom themes. Add deploy/ to the workspace layout.
3. Verify: build the image locally, tag ghcr.io/geekitycom/cms:<test tag> locally only, run the compose file from a temp dir holding only compose.yaml, .env and two empty uid-1000 dirs; check 127.0.0.1 binding, /healthz, the setup screen, user add via exec, rebuild via stop/run/start. Then pnpm build/test/typecheck/lint/format:check. Clean up everything prefixed geekity-t92.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built deploy/compose.yaml and a 'Deploying with Docker' README section (before Continuous integration), plus a pointer in the README intro and a deploy/ line in the workspace layout.

Decisions:
- GEEKITY_TAG and GEEKITY_BASE_URL are required with ${VAR:?message}; there is no latest fallback. Verified: a .env without GEEKITY_TAG fails compose config with 'required variable GEEKITY_TAG is missing a value'.
- The container port is pinned with GEEKITY_PORT=3000 in environment; the host side is ${GEEKITY_HOST_PORT:-3000} on 127.0.0.1. Avoids the iheartrss PORT-on-both-sides pattern and keeps the healthcheck and mapping in step whatever .env says.
- No container_name, so two stacks on one box do not collide; docs use docker compose exec by service name.
- ./themes mount is commented out and :ro when enabled, so criterion #1 needs only content/ and data/.
- mem_limit 1g (sharp variant derivation), pids_limit 256, init, no-new-privileges, cap_drop ALL, json-file 10m x 3, healthcheck repeating the image's node fetch on /healthz.
- WordPress import in a container reads the key pair from --keypair /dev/stdin with exec -T; docker compose cp into /tmp leaves a root-owned copy node cannot delete under cap_drop ALL, so stdin is documented instead.
- Backups list all of content/ and all of data/ except geekity.db* and images/, not only users.json and keys/: data/ also holds mail.json, akismet.json, contact/, comment-salt, notification-secret and others that are not rebuilt (packages/cms/README.md 'Two directories').
- The README tells the proxy to overwrite X-Forwarded-For (nginx $remote_addr) because clientAddress() in admin/throttle.ts reads the first entry.

Validation (Docker Desktop 4.x, aarch64, compose v5.5.1): built the image for linux/arm64, tagged it locally ghcr.io/geekitycom/cms:geekity-t92 (never pushed), ran from a temp dir holding only compose.yaml, .env and empty content/ data/: container healthy, 127.0.0.1:3992->3000/tcp only (lsof shows 127.0.0.1 listen), /healthz 200, /admin 302 -> /admin/setup, /admin/setup 200 'Create the first admin', content seeded with site.json url from GEEKITY_BASE_URL, runs as uid 1000. docker compose exec -T ... geekity user add closed setup (/admin/setup -> /admin/login). import wordpress-actor with --keypair /dev/stdin --followers none wrote both keys. exec rebuild refused (db in use); stop / run --rm geekity geekity rebuild / start worked. Changing GEEKITY_TAG to a second local tag and up -d recreated on the new tag. Uncommenting ./themes:ro and setting theme in site.json served the theme's style.css; the mount is read-only. The documented tar backup command excluded geekity.db* and kept users.json and keys/. On macOS Docker Desktop bind-mount ownership is not enforced, so the uid 1000 chown requirement was not exercised; it matches TASK-89's Linux finding. All test containers, networks and images removed.

Gates: pnpm build, pnpm test (1937 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.

#4 (fresh machine, by hand) is left for the maintainer. No image is on ghcr.io yet, so a real pull cannot be tested until the first pnpm docker:build-push.
<!-- SECTION:NOTES:END -->
