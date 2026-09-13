---
id: TASK-77
title: >-
  Appearance > Themes: list the packaged default and the site themes, mark the
  active one, and activate another
status: To Do
assignee: []
created_date: '2026-09-13 12:49'
updated_date: '2026-09-13 12:56'
labels:
  - admin
milestone: m-13
dependencies:
  - TASK-76
references:
  - packages/cms/src/admin/menu.ts
  - packages/cms/src/admin/settings-page.ts
  - packages/cms/src/admin/settings-pages.ts
  - packages/cms/src/admin/settings.ts
  - >-
    backlog/decisions/decision-15 -
    Themes-are-named-and-site.json-chooses-one.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 102800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The theme setting (TASK-76) has no screen. Add an Appearance section to the admin menu, with Themes as its one child so the m-12 menu rule holds, at /admin/appearance/themes. The screen lists the packaged default first, then each folder under themesDir whose theme.json is valid, showing the display name and the description from the manifest with the folder name as the id. The active theme is marked; the packaged default is marked when the setting is absent. Each other theme has an Activate action that posts through updateSiteSettings, so the change lands in site.json and takes effect on the next request; activating the packaged default clears the setting. A folder under themesDir with a missing or broken manifest is listed once as unreadable with the reason rather than silently skipped, so a typo in theme.json is visible, but cannot be activated. Reference: the WordPress Appearance > Themes screen, one card per theme with the active one first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The admin menu has an Appearance section whose child Themes lands at /admin/appearance/themes, expands when current and marks the child, like every other section
- [ ] #2 The screen lists the packaged default first and every valid folder under themesDir after it, showing name, description and folder name from theme.json, with the active one marked
- [ ] #3 Activate on a theme stores its folder name as theme in site.json through updateSiteSettings with CSRF, redirects back with a flash, and the next public request renders with it; activating the packaged default removes the key
- [ ] #4 A folder with no valid manifest is listed as unreadable with the reason and cannot be activated; an activation naming it, forged in a POST, is refused with a message
- [ ] #5 doc-5 Admin UI describes the Appearance section and the screen; tests cover the listing, activation, clearing to the packaged default and the refusal
<!-- AC:END -->
