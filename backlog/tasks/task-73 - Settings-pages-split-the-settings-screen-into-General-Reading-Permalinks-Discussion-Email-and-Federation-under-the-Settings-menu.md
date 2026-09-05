---
id: TASK-73
title: >-
  Settings pages: split the settings screen into General, Reading, Permalinks,
  Discussion, Email and Federation under the Settings menu
status: To Do
assignee: []
created_date: '2026-09-05 13:58'
labels:
  - admin
milestone: m-12
dependencies:
  - TASK-72
references:
  - packages/cms/src/admin/settings.ts
  - packages/cms/admin/layouts/settings.njk
  - packages/cms/src/admin/settings.test.ts
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 99700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The settings screen is one form with twelve headings (Site, Navigation, Archives, Comments, Webmentions, Federation, Notifications, Email, Mail credentials, Spam checking, Avatar) and five POST routes, and it grows with every milestone. Split it into pages under the Settings menu from TASK-72, each its own screen with its own form, its own POST and its own tests, all writing site.json through the same updateSiteSettings path so two pages saved at once cannot lose each other and unknown keys survive. The grouping to start from, following WordPress's names where the CMS has the same thing: General (title, tagline, base URL, timezone, language, author, avatar while the site actor exists); Reading (posts per page, navigation, notify server); Permalinks (tag base, category base, the recorded archive redirects); Discussion (comments on or off and the close-after days, webmentions send and receive, spam checking with the Akismet key, the notification digest note); Email (provider, from name and address, reply-to, contact address, the Brevo and SMTP credentials, send test); Federation (actor handle and type while they exist, relays). The validator is split so a page validates only its fields and a refused save re-renders that page with its problems; base URL keeps its read-only rule; the side effects stay where the field is (updating the actor on a profile change, syncing relays after a relay save). Fields M12 later removes are simply removed from their page then. The old single form goes; the settings URL becomes the General page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Settings has six children, General, Reading, Permalinks, Discussion, Email and Federation, each a page with its own form and POST, and /admin/settings is the General page
- [ ] #2 Every field the old screen had appears on exactly one page, saving one page changes only its fields, and two pages saved concurrently both land in site.json with unknown keys preserved; a test proves the concurrent case
- [ ] #3 A refused save re-renders the page it came from with its problems and writes nothing; the base URL read-only rule and the actor update and relay sync side effects behave as before, proved by the existing settings tests moved to the page they belong to
- [ ] #4 The avatar, Akismet and mail credential forms keep their separate POST routes so a bad credential cannot lose an edit to the title, now on their pages
- [ ] #5 doc-5 and the package README's admin route table list the pages; settings.ts is split so no one module carries every page
<!-- AC:END -->
