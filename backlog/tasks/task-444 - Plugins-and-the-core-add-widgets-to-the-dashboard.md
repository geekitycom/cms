---
id: TASK-444
title: Plugins and the core add widgets to the dashboard
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - plugins
  - admin
  - dashboard
milestone: m-41
dependencies:
  - TASK-441
  - TASK-442
references:
  - >-
    backlog/decisions/decision-59 -
    Plugins-add-tags-to-public-pages-and-widgets-to-the-dashboard-through-declarative-contributions-the-core-draws.md
  - packages/cms/src/plugin.ts
  - packages/cms/src/plugins/registry.ts
priority: medium
ordinal: 381800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-59, a widget has an id, a title, a width (full or half), a refresh interval and a load() that returns the declarative blocks. The core own cards in this milestone register through the same path. The dashboard draws the stat tiles, then core widgets, then plugin widgets in enabled-plugin order. Loads run in parallel under a time limit; the last good result is kept in memory for the refresh interval; a failure shows that result marked stale, or an unavailable message, and is logged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin declares widgets in register and they draw on GET /admin below the core widgets, in enabled-plugin order
- [ ] #2 Widgets load in parallel; a widget that runs past the time limit or throws shows unavailable (or its last good result marked stale) and the rest of the dashboard draws
- [ ] #3 A widget result is reused for its refresh interval instead of loading on every dashboard request
- [ ] #4 A disabled plugin widgets disappear without a restart, in line with plugin reload
- [ ] #5 Full and half widths lay out in a responsive grid that stacks on narrow screens
- [ ] #6 docs/plugins.md documents widgets, the block types and the failure behaviour, with an example plugin widget
<!-- AC:END -->
