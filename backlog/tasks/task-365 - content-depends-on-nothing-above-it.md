---
id: TASK-365
title: content/ depends on nothing above it
status: To Do
assignee: []
created_date: '2026-10-12 11:31'
labels: []
milestone: m-36
dependencies: []
references:
  - packages/cms/src/content/store.ts
  - packages/cms/src/admin-boundary.test.ts
priority: high
type: chore
ordinal: 324800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
content/ is the domain core, yet it imports from the delivery and feature layers: content/store.ts imports repliesKey (web/feed-source.ts), feedGuid and postObjectId (web/guids.ts), NO_REDIRECTS and RedirectTable (web/redirects.ts), and linksInto, ownSiteLinks, siteLinkKey and spelling (webmention/links.ts). Other content/ files import web/, webmention/, site/, federation/, contact/ and comments/. GUID, permalink, redirect and link-key rules are content policy that currently lives in web/ and webmention/, so a change to rendering can force a change to the domain. Move that policy down so content/ only depends on itself and lower-level modules (util/, files/, cache.ts, config types), and make the rule checkable the way src/admin-boundary.test.ts already checks content/ against admin/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No non-test module under packages/cms/src/content/ imports from web/, webmention/, federation/, comments/, contact/, site/, admin/, micropub/ or cms/
- [ ] #2 A check that runs in pnpm test or pnpm lint fails when such an import is added, and its message names the rule
- [ ] #3 Public exports from the package index and @geekity/cms/plugin keep their names
- [ ] #4 Existing tests pass unchanged in behaviour
<!-- AC:END -->
