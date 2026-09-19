---
id: TASK-87
title: >-
  Health check: GET /healthz answers 200 when the site can serve and 503 when it
  cannot
status: To Do
assignee:
  - '@claude'
created_date: '2026-09-19 15:24'
labels:
  - web
  - infra
milestone: m-15
dependencies: []
references:
  - packages/cms/src/index.ts
  - /Users/andrewshell/code/projects/iheartrss/Dockerfile
type: feature
ordinal: 112800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A container orchestrator (Docker HEALTHCHECK, dockge, an uptime monitor) needs one cheap URL whose HTTP status says whether the site is up. Geekity has none. Add GET /healthz to the CMS itself, not to the image, so every way of running a site gets it. It answers 200 when the content index database can be queried and the content directory can be read, and 503 when either fails, because a checker reads only the status code and a 200 carrying {ok:false} would read as healthy. The body is a small JSON object naming each check, with no paths, versions or other details a stranger should not learn. The route is registered before content resolution so no permalink can shadow it, is never cached, sets no session cookie, and is not counted by the login throttle. Reference: the iheartrss /healthz and its HEALTHCHECK comments in /Users/andrewshell/code/projects/iheartrss/Dockerfile.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /healthz answers 200 with a JSON body when the database and content directory are usable, proven by a test
- [ ] #2 It answers 503 when the database cannot be queried or the content directory cannot be read, proven by a test for each
- [ ] #3 The body names each check and its outcome and leaks no filesystem paths, versions or error messages
- [ ] #4 A post or page whose permalink is /healthz/ does not shadow the route
- [ ] #5 The response carries Cache-Control: no-store and sets no cookie
- [ ] #6 The README documents the endpoint
<!-- AC:END -->
