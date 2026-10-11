---
id: TASK-342
title: >-
  Templates can tell dev mode and a signed-in reader apart, so a site can leave
  analytics out
status: To Do
assignee: []
created_date: '2026-10-11 02:57'
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
- [ ] #1 Every public HTML page's template context has devMode, true exactly while dev mode is on (latched, as dev-mode status reports)
- [ ] #2 Every public HTML page's template context has signedIn, true exactly when the request carries a live session for an existing user
- [ ] #3 A page rendered with signedIn true carries Cache-Control private, so a shared cache never stores it for strangers; pages for strangers keep today's caching
- [ ] #4 The editor preview and other admin renders keep leaving head-end and body-end out, as today
- [ ] #5 The default theme README's analytics example leaves the scripts out in dev mode and for signed-in readers, and documents both keys
<!-- AC:END -->
