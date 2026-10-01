---
id: TASK-206
title: Content license setting
status: To Do
assignee: []
created_date: '2026-10-01 17:13'
updated_date: '2026-10-01 17:20'
labels:
  - settings
  - theme
  - schema-org
dependencies:
  - TASK-192
references:
  - packages/cms/admin/pages/settings/general.njk
  - packages/cms/themes/default/partials/jsonld.njk
  - packages/cms/src/web/feed-rss.ts
priority: low
type: feature
ordinal: 222800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A site cannot say what readers may do with its posts. Add a License setting on Settings > General: none (the default, meaning all rights reserved), one of the Creative Commons licenses (CC BY, BY-SA, BY-NC, BY-NC-SA, BY-ND, BY-NC-ND, CC0) or a custom URL with a name. Show it in the default theme's footer with rel="license", add license to the JSON-LD WebSite and BlogPosting nodes, and declare it in the feeds (Atom link rel=license, RSS creativeCommons:license or a dc:rights line, JSON Feed _license extension or omit). A post may override it with license in front matter.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Settings > General offers no license, the Creative Commons set and a custom URL with name, saved in site.json
- [ ] #2 With a license chosen, every page links it with rel="license" and the JSON-LD WebSite and BlogPosting carry license
- [ ] #3 The Atom and RSS feeds declare the license
- [ ] #4 A post's license front matter overrides the site's on that post, its JSON-LD and its feed item
- [ ] #5 With no license chosen nothing is printed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: after TASK-192 (and TASK-201 if it has landed). It adds a control to Settings > General, which TASK-192 restructures, and license members to jsonld.njk, which TASK-192 and TASK-201 also edit.
<!-- SECTION:NOTES:END -->
