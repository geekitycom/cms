---
id: TASK-270
title: 'Layouts and account screens: the shell, the menu, the flash and the login card'
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-266
  - TASK-268
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 229800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the chrome every screen is drawn inside is redrawn with DaisyUI, as its own layout rather than the WordPress one. layouts/base.njk, shell.njk and settings-page.njk, components/flash.njk and the four account screens (login, setup, forgot, reset) compose the macros from TASK-266 under the new bar from TASK-268. The section menu stays server-rendered from the registry in src/admin/menu.ts: the open section is a nested list, the current screen carries aria-current, and no script is needed to expand anything; on a narrow screen the menu stacks or sits in a drawer. The MCP server's page architect (pages/sign-in, pages/settings-page, pages/admin-dashboard) is worth consulting for the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Signed-in screens are drawn in a DaisyUI shell: a side menu (menu component) rendering the registry with the open section as a nested list and aria-current on the current screen, and a main column; navigation.test.ts and menu.test.ts pass
- [ ] #2 On a narrow viewport the menu stacks above the screen or opens from a drawer without JavaScript deciding which section is open
- [ ] #3 The flash is a DaisyUI alert in the semantic colour of its kind (notice, error, warning), and the login, setup, forgot and reset screens are one centred card each
- [ ] #4 The skip link, the focus ring and every keyboard test in keyboard.test.ts pass in the new shell, and the shell carries no legacy admin-* class
- [ ] #5 The settings page layout (heading, summary, form, panels) renders through the macros and every settings page still saves
<!-- AC:END -->
