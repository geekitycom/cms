---
id: TASK-267
title: 'Per-user admin theme: any built-in DaisyUI theme, or follow the system'
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-265
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 226800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: each user picks the admin's theme for themselves, any of DaisyUI's built-in themes or Follow the system, on their own screen under Users, stored in data/users.json beside their notification preferences. The server renders the choice as data-theme on <html> on every admin page for that user and renders nothing when they follow the system, where the light and dark defaults from TASK-265 follow prefers-color-scheme. There is no client-side theme switch. The same choice decides whether the admin bar is drawn light or dark (the admin bar task consumes it): one table says which built-in theme is light and which is dark, and the choice reduces to light, dark or auto for whatever renders the bar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The user's own edit screen has a select listing Follow the system and every built-in DaisyUI theme by name; saving stores the choice in data/users.json and a user with no choice follows the system
- [ ] #2 Every admin page rendered for a signed-in user carries data-theme on <html> with their chosen theme, and no data-theme when they follow the system; the login, setup, forgot and reset screens carry none
- [ ] #3 A function reduces a theme choice to light, dark or auto from a table of the built-in themes, with a test that every theme the select offers is in the table
- [ ] #4 Choosing a dark theme and loading the dashboard renders the DaisyUI dark palette (checked over HTTP in a test by the data-theme attribute and by the compiled stylesheet carrying that theme)
<!-- AC:END -->
