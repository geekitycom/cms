---
id: TASK-107
title: 'Named menus: the site stores them, the theme declares which it renders'
status: To Do
assignee: []
created_date: '2026-09-20 12:31'
updated_date: '2026-09-20 12:32'
labels:
  - web
  - theme
milestone: m-16
dependencies:
  - TASK-106
references:
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/web/themes.ts
  - packages/cms/themes/default/theme.json
  - packages/cms/src/admin/settings-reading.ts
  - packages/cms/themes/default/layouts/base.njk
type: feature
ordinal: 132800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A site has one menu, held in the `navigation` setting, and TASK-105 was about to add a second hardcoded box beside it for the footer. Two boxes is already one too many hardcoded: the theme decides where a menu can go, and the settings screen cannot know what a theme wants.

Turn a menu into a named thing the site stores and the theme asks for.

**The site stores menus by name.** `site.json` grows a `menus` object — `{ "primary": [...], "footer": [...] }` — each holding the items that `navigation` holds today. An item is a label, a URL and the flags it needs, of which the first is `me`, so a footer link can carry `rel="me"` for Mastodon to verify. The existing `navigation` setting becomes `menus.primary`; shll.me is the only live site, so this is a rename rather than a migration, and the old key stops being read.

**The theme declares the areas it renders.** `theme.json` grows a list of areas, each a name and a label a person reads: the packaged default declares `primary` and `footer`. A theme that wants a third declares it; a theme that renders none declares none.

**A theme renders a menu by name.** The template context carries `menus`, keyed by name, each item already marked `current` for the path being rendered the way `menu` is today. `{% for item in menus.footer %}` is the whole interface, so a site theme can render a menu the packaged theme has never heard of.

**A stored menu whose area no theme declares is kept.** It is not an error and not deleted: somebody writing a theme, or about to switch to one, fills in the menu it will use before that theme is active. What makes it visible and removable is the admin screen, which is TASK-108.

This replaces the Footer links box TASK-105 was going to put in Settings > Reading: the footer's links are `menus.footer`, and TASK-105 keeps only the theme-side placement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 site.json holds menus by name, each item a label, a URL and its flags, and a malformed item is refused the way a navigation line is today, proven by a test
- [ ] #2 An item marked me renders with rel="me" and an unmarked one does not, proven by a test
- [ ] #3 theme.json declares the areas a theme renders, and an unreadable or missing declaration leaves a theme with none rather than failing to load, proven by a test
- [ ] #4 The packaged default theme declares primary and footer, and renders each from menus, proven by a test
- [ ] #5 menus is on the template context keyed by name, with current marked for the path being rendered, proven by a test
- [ ] #6 A menu stored under a name no theme declares is kept in site.json and rendered nowhere, proven by a test
- [ ] #7 The navigation setting is read as menus.primary and the old key is no longer read, with the starter site and the README updated to match
- [ ] #8 The theme README documents theme.json's areas and how a theme renders one
<!-- AC:END -->
