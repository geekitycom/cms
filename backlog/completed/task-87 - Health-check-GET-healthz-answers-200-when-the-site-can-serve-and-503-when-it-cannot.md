---
id: TASK-87
title: >-
  Health check: GET /healthz answers 200 when the site can serve and 503 when it
  cannot
status: Done
assignee:
  - '@claude'
created_date: '2026-09-19 15:24'
updated_date: '2026-09-19 20:51'
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
- [x] #1 GET /healthz answers 200 with a JSON body when the database and content directory are usable, proven by a test
- [x] #2 It answers 503 when the database cannot be queried or the content directory cannot be read, proven by a test for each
- [x] #3 The body names each check and its outcome and leaks no filesystem paths, versions or error messages
- [x] #4 A post or page whose permalink is /healthz/ does not shadow the route
- [x] #5 The response carries Cache-Control: no-store and sets no cookie
- [x] #6 The README documents the endpoint
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seam: the CMS's Hono app (createCms().app.request), tests in packages/cms/src/web/health.test.ts.
2. Red/green per criterion: 200 + JSON when healthy; 503 when the content index is closed (store.counts() throws); 503 when the content directory is gone/unreadable; body is exactly {status, checks:{database, content}} with no paths or messages; a post with permalink /healthz/ does not shadow GET /healthz; Cache-Control: no-store and no Set-Cookie.
3. New module packages/cms/src/web/health.ts exporting mountHealth(app) / healthResponse: runs store.counts() and readdir(contentDir), each caught to 'ok'/'fail'.
4. Register it in createCms right after the baseline headers, before federation, admin and the public site, so no permalink can shadow it. Leave /_geekity/health as it is.
5. Document /healthz in README (public site section) and packages/cms/README if it lists routes.
6. Verify with pnpm build/test/typecheck/lint/format:check and curl a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built GET /healthz in packages/cms/src/web/health.ts (mountHealth, healthReport, HEALTH_PATH), registered in createCms right after the baseline security headers and before federation, the admin and the public site.
- database check: store.counts() (one query on the content index); content check: opendir(contentDir) then close. Each is caught and reduced to 'ok' or 'fail'; the error is dropped so nothing leaks.
- Body is exactly {status, checks: {database, content}}; 200 when both are ok, 503 otherwise; Cache-Control: no-store; no session middleware runs on it, so no Set-Cookie. The login throttle only counts POST /admin/login, so it never sees this route.
- Ordering proof: with mountHealth moved after mountPublicSite, the database-failure test answered 500 instead of 503, because the public site queries the index first. The shadow test (page at /healthz/) passes with the route first, and /healthz/ still serves the page.
- /_geekity/health is left as it was (unconditional {status:'ok'}); the README says so. Retiring it is a separate call.
- Tests: packages/cms/src/web/health.test.ts, 6 cases (healthy, database closed, content dir removed, /healthz/ page, no-store and no cookie on 200 and 503, body leaks no paths or messages).
- README: /healthz row in the public site table plus a 'Health check' subsection.
Validation: pnpm build && pnpm test (1913 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. curl against the running demo: 200, cache-control: no-store, {"status":"ok","checks":{"database":"ok","content":"ok"}}. curl against a throwaway served site after deleting its content dir: 503, no-store, {"status":"fail","checks":{"database":"ok","content":"fail"}}. Both servers stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added GET /healthz to the CMS: it answers 200 when a content index query and opening the content directory both succeed, and 503 when either fails. The body only names each check and its outcome, the response is Cache-Control: no-store with no cookie, and the route is registered before every other route so a /healthz/ permalink cannot shadow it. The README documents it. Verified with six tests in packages/cms/src/web/health.test.ts, the full build/test/typecheck/lint/format gates, and curl against the running demo (200) and a served site with its content dir removed (503).
<!-- SECTION:FINAL_SUMMARY:END -->
