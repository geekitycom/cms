---
id: TASK-46
title: 'Site navigation: a menu setting and show-in-navigation on pages'
status: To Do
assignee: []
created_date: '2026-09-04 01:34'
labels:
  - theme
  - admin
milestone: m-5
dependencies:
  - TASK-12
  - TASK-14
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 27900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme has no navigation: pages exist but nothing links to them. Add a `navigation` setting, an ordered list of `{ label, url }` items, edited on the settings screen and mirrored to `site.json` so an Eleventy build renders the same menu. A page may also opt in with `navigation: true` (optionally `navigationOrder`) in its front matter, which the editor exposes as a checkbox, and those pages follow the explicit items. The base layout renders the menu and marks the current item; the theme README documents the template variable for a site overriding the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Items from the navigation setting render in the header in order, with the current one marked, on every public page
- [ ] #2 A page with navigation: true appears in the menu without being listed in the setting, and the editor checkbox round-trips it
- [ ] #3 The setting is mirrored to site.json and read back on seed; an old site.json without it yields an empty menu
- [ ] #4 A malformed item (missing label or url) is refused on the settings screen with a message
<!-- AC:END -->
