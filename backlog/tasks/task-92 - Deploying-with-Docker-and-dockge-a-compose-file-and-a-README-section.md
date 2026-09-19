---
id: TASK-92
title: 'Deploying with Docker and dockge: a compose file and a README section'
status: To Do
assignee:
  - '@claude'
created_date: '2026-09-19 15:25'
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
- [ ] #1 The compose file starts the published image on a box with no repo checkout, given only its .env and two empty directories owned by uid 1000
- [ ] #2 The port is bound to 127.0.0.1 and the image tag comes from .env
- [ ] #3 The README section covers directories and ownership, environment, first login, WordPress import, backups, upgrade and rollback, and custom themes
- [ ] #4 Following the README on a fresh machine reaches the setup screen, checked once by hand
<!-- AC:END -->
