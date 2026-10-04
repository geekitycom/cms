---
id: TASK-274
title: >-
  The remaining screens: comments, messages, themes, navigation, federation,
  tools, IndieAuth and errors
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
ordinal: 233800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: everything not covered by the list, dashboard and editor tasks is redrawn through the macros: Comments and Messages (cards per row with their actions and the folded reply box), Appearance > Themes (one card per theme, the active one marked), Navigation > Menus (one panel per menu with the add and delete forms), Federation > Settings and the settings panels (mail state and test message, Akismet state, permalink redirects, personal data), Tools, the IndieAuth consent and refused screens, the error page and the placeholder. Each keeps its behaviour and its test file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Comments and Messages rows are cards with the author line, the body, the where line and the action row; unread is marked by more than colour; the reply box still folds; comments.test.ts and messages.test.ts pass
- [ ] #2 Themes are cards with the active one marked and Activate on every other; Navigation is one card per menu with add and delete working; appearance.test.ts and navigation.test.ts pass
- [ ] #3 The federation settings, the mail, Akismet, permalink and personal-data panels, Tools, the IndieAuth consent and refused screens, the error page and the placeholder render through the macros and their test files pass
- [ ] #4 None of these templates carries a legacy admin-* class
<!-- AC:END -->
