---
id: TASK-272
title: 'List screens on the DaisyUI table, tabs, badge and pagination macros'
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-270
  - TASK-269
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 231800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: every screen that is a table of rows is redrawn through the macros: Posts and Pages (documents/list.njk), Users, Categories and Tags (taxonomy.njk, with its inline rename field), Media library, Followers, Connected apps, App activity and the activity entry, and Syndication. Tables keep their captions (keyboard.test.ts reads them), filters become tabs, page links become pagination, statuses (draft, scheduled, trashed, pending, spam, failed, active, missing) become badges in semantic colours, and row actions stay one readable line. Wide tables scroll inside their wrapper rather than widening the page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each listed screen renders its rows through the table macro inside a horizontally scrolling wrapper, opens with its caption, and its test file passes
- [ ] #2 Filters (all / published / drafts / trash, pending / approved / spam, inbox / spam) are DaisyUI tabs with the current one marked, and pagination is the pagination macro
- [ ] #3 Every status a row can show is a badge in a semantic colour and never by colour alone: the word is still printed
- [ ] #4 The taxonomy rename field, the media copy controls and the alt-text field work as before (their tests pass), and the screens carry no legacy admin-* class
<!-- AC:END -->
