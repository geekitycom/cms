---
id: TASK-130
title: Maintenance mode that answers 503 with Retry-After
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 00:50'
labels:
  - resilience
milestone: m-18
dependencies: []
references:
  - 'https://specification.website/spec/resilience/maintenance-pages/'
priority: low
type: feature
ordinal: 154800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An operator upgrading a site or restoring content has no way to take the public site down on purpose. Maintenance mode should tell browsers, crawlers and fediverse servers that the outage is temporary, so they retry instead of dropping pages from their indexes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Maintenance mode can be turned on and off from the CLI and by an environment variable, without a restart where possible
- [x] #2 While it is on, public pages, feeds and sitemaps answer 503 with Retry-After and a themed maintenance page
- [x] #3 Signed-in admins can still use the admin, and /healthz reports the mode
- [x] #4 Inbound ActivityPub deliveries receive a 503 so remote servers retry later
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. State: maintenance lives in data/maintenance.json (operational, private, never published or committed with content/; decision-9 atomic write). Body optional {"until": ISO}. New src/maintenance.ts: enterMaintenance, leaveMaintenance (idempotent), readMaintenance (malformed file still counts as on), createMaintenanceSwitch (re-reads the file at most once a second by the site clock, so a relay burst costs one read a second).
2. Config: maintenance?: boolean, env GEEKITY_MAINTENANCE. On forces maintenance for the process (boot-time override, needs a restart to lift); off/unset leaves the file in charge.
3. CLI: geekity maintenance on [--until <ISO time>] | off | status. Writes/removes the file; a running server notices within a second, no restart.
4. Web: middleware after the context/header middleware, before /healthz and federation. Exempt: /healthz, /_geekity/health, /admin (so sign-in works), /theme/ (so the themed page is styled). Signed-in users (live session, same test the comment form uses) browse the public site normally with Cache-Control private, no-store so no shared cache serves it to strangers. Everything else, including Fedify inboxes, the WordPress inbox, feeds and sitemaps, gets 503 + Retry-After (HTTP date of until when in the future, else 600s) + no-store, in HTML via theme layouts/503.njk (default theme ships one; static fallback), or JSON/Markdown via representationOf.
5. /healthz: report gains maintenance: true|false; status code stays 200 while checks pass, since the process is healthy and an orchestrator must not restart it for being in maintenance.
6. Tests first per AC, then docs (CLI usage, env overrides, README/docs).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions:
- The switch is data/maintenance.json ({} or {"until": ISO}). data/ not content/: maintenance is operational state, and content/ is published and committed, so a flag there would take down every checkout. Written atomically via files/atomic.ts per decision-9. A malformed file still means on (the operator put it there).
- The running site re-reads the file at most once a second by the site clock (createMaintenanceSwitch), so a relay burst costs one read per second and on/off lands within a second with no restart.
- GEEKITY_MAINTENANCE / config maintenance: true forces it on from boot for the life of the process; removing the file does not lift it (needs a restart without it). The file can still add an until.
- Exempt paths: /healthz, /_geekity/health, /admin and /admin/* (login included), /theme/* (so the themed page is styled).
- Signed-in users (live session naming an existing user, the comment form's test via signedInCommenter) browse the public site normally; those responses get Cache-Control: private, no-store so a shared cache never hands them to a stranger. Chosen so an admin can check an upgrade before turning maintenance off.
- Retry-After is the until as an HTTP date while it is ahead, else 600 seconds. Body format follows representationOf (HTML via theme layouts/503.njk with a static fallback, JSON, Markdown). Cache-Control: no-store.
- /healthz gains maintenance: boolean and keeps its status code: a site down on purpose is healthy, and an orchestrator restarting it would fight the operator.
- The gate sits after the context/header/redirectBy middleware and before /healthz and mountFederation, so Fedify inboxes and the WordPress-compatible inboxes all get 503 before signature checks.
- Not in scope: outbound federation delivery and the scheduler keep running during maintenance; the admin shows no banner that maintenance is on.

Validation: pnpm build && pnpm test (2332 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Mutation checks: disabling the signed-in bypass, the /admin exemption, or the /theme exemption each fails a test. Live: geekity serve on a scratch site; geekity maintenance on --until 2030-01-01T12:00:00Z then curl / gave 503, Retry-After: Tue, 01 Jan 2030 12:00:00 GMT, no-store, article.maintenance; /feed/, /feed/atom/, /sitemap.xml, /robots.txt and POST /inbox/ gave 503; /theme/style.css and /healthz 200 with maintenance: true; geekity maintenance off then / gave 200 with no restart. GEEKITY_MAINTENANCE=on at boot gave 503 with Retry-After: 600. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Maintenance mode (TASK-130). geekity maintenance on [--until <time>] | off | status writes or removes data/maintenance.json; the running site re-reads it at most once a second, so no restart is needed. GEEKITY_MAINTENANCE=on (or config maintenance: true) forces it from boot. While on, everything but /healthz, /_geekity/health, /admin and /theme/ answers 503 with Retry-After (the --until time as an HTTP date while ahead, else 600s) and no-store, via the theme's new layouts/503.njk or JSON/Markdown per representationOf; that covers pages, feeds, sitemaps, robots.txt and every ActivityPub inbox, Fedify's and the WordPress-compatible ones. Signed-in users browse the public site as usual with Cache-Control: private, no-store. /healthz reports maintenance: true|false without changing its status code. Verified with new tests (src/web/maintenance.test.ts, src/cli-maintenance.test.ts, config and health tests), the full build/test/typecheck/lint/format run, and curl against a live geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
