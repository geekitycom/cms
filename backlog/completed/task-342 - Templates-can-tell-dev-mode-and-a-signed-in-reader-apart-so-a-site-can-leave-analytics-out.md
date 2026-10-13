---
id: TASK-342
title: >-
  Templates can tell dev mode and a signed-in reader apart, so a site can leave
  analytics out
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 02:57'
updated_date: '2026-10-11 03:32'
labels:
  - enhancement
milestone: m-31
dependencies: []
references:
  - packages/cms/themes/default/README.md
  - packages/cms/src/comments/viewer.ts
  - packages/cms/src/web/routes.ts
priority: medium
ordinal: 301800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raised by Andrew for the andrewshell.org migration (phase 6). A site theme adds analytics through partials/head-end.njk (TASK-298): Umami and GA4 on andrewshell.org. Two kinds of visit shouldn't be counted, and a template can't tell either today. (1) Dev mode. A site built or migrated under dev mode runs with its production identity, so browsing it locally or on a staging host sends pageviews to the production analytics properties. Dev mode holds every outbound write, but a pageview is the reader's browser calling the analytics host, not the site, so dev mode can't hold it. The template context carries nothing about dev mode (checked in render.ts on v0.30.0). (2) The site's own users. A signed-in author reading their own site inflates the counts. The public site already reads the session (signedInCommenter in comments/viewer.ts, for the comment form) and marks a response drawn for somebody private (routes.ts). But that only happens where a comment form is drawn, and templates get no general flag. Proposal: every public HTML page's template context carries devMode (true while dev mode is on) and signedIn (true when a live session names a user, the same test the admin guard applies). A page drawn for a signed-in reader is marked Cache-Control private, as comment pages already are, so a shared cache never serves the signed-in variant to strangers. The theme README's analytics example wraps the snippets in {% if not devMode and not signedIn %}.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every public HTML page's template context has devMode, true exactly while dev mode is on (latched, as dev-mode status reports)
- [x] #2 Every public HTML page's template context has signedIn, true exactly when the request carries a live session for an existing user
- [x] #3 A page rendered with signedIn true carries Cache-Control private, so a shared cache never stores it for strangers; pages for strangers keep today's caching
- [x] #4 The editor preview and other admin renders keep leaving head-end and body-end out, as today
- [x] #5 The default theme README's analytics example leaves the scripts out in dev mode and for signed-in readers, and documents both keys
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: two booleans on the context every theme render gets, set in render() (web/render.ts) after the caller's context so front matter cannot spell them: devMode = devModeOn(config) (reads the latched state file per call), signedIn = whether this render runs for a request the public site's door found a live session for.
2. signedIn reaches the renderer without threading a parameter through ten render methods: publicAdminBar (web/admin-bar.ts), which already reads the session once per public request into c.var.signedIn, runs the rest of the request inside an AsyncLocalStorage scope exported from render.ts; render() reads it. Inside /admin the bar does not run, so the editor preview keeps editorPreview and signedIn false.
3. Cache-Control: publicAdminBar already marks every HTML response for a signed-in reader private, no-store and strips validators; the routes' private flag stops a 304 off an anonymous copy. Fold the document route's viewer-based flag into drawnForSomebody so one rule decides it, and drop the comment endpoint's own private header (the bar sets it).
4. One session read per request: the comment POST takes c.var.signedIn instead of reading the session again; well-known's private signedInUserId and the maintenance gate use signedInAccount (the one live-session test).
5. Tests first (page-hooks.test.ts): head-end wrapped in the README guard shows for anonymous, hidden for signed-in and in dev mode (config and dev-mode command latch), toggles back after leaving dev mode without restart; signed-in page private/no-store/no ETag and no 304 on an anonymous ETag; anonymous keeps no-cache + ETag; preview still has no hooks.
6. README: document devMode and signedIn in Template context and wrap the analytics example.
7. pnpm build/test/typecheck/lint/format:check; curl a served scratch site, logged in via the admin login form, dev mode on/off.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
devMode and signedIn are set once, in render() (web/render.ts), after the caller's context so front matter cannot spell them. devMode = devModeOn(config), which looks for the latched state file on every call, so geekity dev-mode on/off changes the next page with no restart. signedIn comes from an AsyncLocalStorage scope that publicAdminBar (web/admin-bar.ts) opens around the rest of the request once it has read a live session (signedInAccount, the existing one test: live session, user still in users.json); that middleware already reads the session once per public request into c.var.signedIn, so no extra lookup. Chosen over a parameter on ten render methods and every caller (listing, search, comment, 404, 410, 500, comment and contact endpoints).
AC#3 already held from TASK-183: publicAdminBar marks every HTML response for a signed-in reader private, no-store and strips ETag/Last-Modified; the routes' private flag (drawnForSomebody) keeps a 304 off an anonymous copy's ETag. The anonymous variant keeps no-cache + ETag, so a shared cache must revalidate every reuse with the origin, which answers a signed-in reader with a fresh private 200, never a 304. Feeds, JSON and Markdown are not drawn through the theme and are unchanged.
Simplified: the document route's private flag now uses drawnForSomebody like the listing and search; the comment POST takes c.var.signedIn (one session read per request) and drops its own private header (the bar sets it on every HTML response); web/well-known.ts's private signedInUserId copy of the session test is deleted in favour of signedInAccount; maintenance gate uses signedInAccount and the shared PRIVATE_CACHE_CONTROL constant (its PRIVATE_NO_STORE duplicate deleted). The admin guard keeps its own liveSession: it also keeps the anonymous CSRF session and deletes an orphaned one, which the public test must not do.
Known gap, not in scope: a listing's and search's ETag is built from the documents, not the HTML, so after geekity dev-mode off a browser holding a dev-mode copy of a listing can get a 304 until the listing changes (a theme change has the same property today). Documents are validated by their rendered HTML and are unaffected.
Verified: page-hooks.test.ts (7 new tests; the 304 test fails with drawnForSomebody forced false). pnpm build, test (cms 5436 pass, all packages pass), typecheck, lint, format:check. Scratch site (scratchpad/site342, analytics theme with the README guard, served on :3942, logged in through /admin/login): anonymous /, /about/, a post, /search/?q=hello, a 404 carry the Umami/GA4 snippet; the same with the session cookie carry the admin bar and no snippet. Post and front page: anonymous cache-control no-cache + ETag, If-None-Match 304; signed-in with that ETag 200, private, no-store, no ETag, no snippet. geekity dev-mode on removes the snippet on the next request of the running server, dev-mode off restores it. /admin/preview 200 with no snippet.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-11 03:32
---
Orchestrator review: closed the listing ETag gap noted above. listingFingerprint (listings and search) now includes dev mode, so after geekity dev-mode off a cached dev-mode listing is not revalidated with a 304 (page-hooks.test.ts, failing first with 304).
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every theme render now has devMode (devModeOn, read per render) and signedIn (a live session for an existing user, scoped by the public site's admin-bar middleware through AsyncLocalStorage) on its context, set after the caller's context. Signed-in HTML pages stay private, no-store with no validator and never get a 304 off an anonymous ETag; the document route now uses the same drawnForSomebody rule as listings and search. Session reads consolidated on signedInAccount / c.var.signedIn (comment POST, well-known change-password, maintenance gate); duplicate helpers and constants deleted. Default theme README documents both keys and wraps the analytics example in {% if not devMode and not signedIn %}. Verified by 7 new page-hooks tests, the full build/test/typecheck/lint/format chain, and curl against a served scratch site logged in through the admin login form, with dev mode toggled live.
<!-- SECTION:FINAL_SUMMARY:END -->
