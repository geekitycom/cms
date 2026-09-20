---
id: TASK-108
title: 'A Navigation screen: every menu this site holds, and what renders it'
status: To Do
assignee: []
created_date: '2026-09-20 12:32'
updated_date: '2026-09-20 12:32'
labels:
  - admin
  - web
milestone: m-16
dependencies:
  - TASK-107
references:
  - packages/cms/src/admin/menu.ts
  - packages/cms/src/admin/settings-reading.ts
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/web/themes.ts
  - packages/cms/admin/pages/settings
  - packages/cms/admin/components/fields.njk
type: feature
ordinal: 133800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-107 makes a menu a named thing the site stores and the theme asks for. This is where somebody manages them.

A top-level **Navigation** section in the admin menu, after Pages, holding one screen. It is not a settings page: a menu is content a site arranges, the way its pages are, rather than a switch that changes how the site behaves — and Settings > Reading is the wrong home for a screen whose shape comes from the active theme.

The screen lists, in this order:

1. **The areas the active theme declares**, in the order `theme.json` declares them, each with the theme's own label and a box holding that menu's items. An area the theme declares and the site has never filled in is an empty box, not a missing one.
2. **Every other menu the site holds**, under a heading saying the active theme does not render them. Each says so plainly and offers Delete, which is the only way a menu is removed.

Adding a menu asks for a name. A name the theme declares moves that menu into place above; a name it does not is a block waiting for the theme that will use it — which is what the maintainer wants it for: fill in the menu before switching to the theme that renders it.

Naming rules are worth deciding once and writing down: a menu name is the thing a theme writes in `{% for item in menus.<name> %}`, so it should look like a slug, be unique, and refuse the spellings that would confuse it with another.

An item is a label, a URL and its flags. The `me` flag is the one that exists, and it needs a visible label saying what it does — a person adding their Mastodon link has no reason to know what `rel="me"` is for, only that it is how verification works.

Settings > Reading loses its Navigation box, which moves here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Navigation section is in the admin menu after Pages, and its screen renders in the admin chrome with the section marked current, proven by a test
- [ ] #2 The screen lists the areas the active theme declares, in the theme's order, with the theme's labels, including one the site has never filled in, proven by a test
- [ ] #3 A menu the active theme does not render is listed separately, says so, and can be deleted, proven by a test
- [ ] #4 A menu can be added by name, and a malformed or duplicate name is refused with a message saying why, proven by a test for each
- [ ] #5 Editing a menu saves its items to site.json and a malformed item is refused without losing the rest of the box, proven by a test
- [ ] #6 The me flag is offered with a label saying what it is for, proven by a test
- [ ] #7 Settings > Reading no longer has a Navigation box, and nothing else on that page changed, proven by the existing reading tests passing unedited
- [ ] #8 The README documents the screen and what a theme has to declare for an area to appear on it
<!-- AC:END -->
