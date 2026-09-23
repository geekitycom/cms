---
id: TASK-108
title: 'A Navigation screen: every menu this site holds, and what renders it'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 12:32'
updated_date: '2026-09-20 15:46'
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
- [x] #1 A Navigation section is in the admin menu after Pages, and its screen renders in the admin chrome with the section marked current, proven by a test
- [x] #2 The screen lists the areas the active theme declares, in the theme's order, with the theme's labels, including one the site has never filled in, proven by a test
- [x] #3 A menu the active theme does not render is listed separately, says so, and can be deleted, proven by a test
- [x] #4 A menu can be added by name, and a malformed or duplicate name is refused with a message saying why, proven by a test for each
- [x] #5 Editing a menu saves its items to site.json and a malformed item is refused without losing the rest of the box, proven by a test
- [x] #6 The me flag is offered with a label saying what it is for, proven by a test
- [x] #7 Settings > Reading no longer has a Navigation box, and nothing else on that page changed, proven by the existing reading tests passing unedited
- [x] #8 The README documents the screen and what a theme has to declare for an area to appear on it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Seams under test: the admin over real HTTP (a signed-in browser against /admin/navigation and its three POSTs), `content/_data/site.json` as it is written, the menu registry (`ADMIN_SECTIONS`), and the two pure vocabularies in `src/web/navigation.ts` (a menu name, a menu item line). No test reaches into the screen module's internals.

1. Name and line format, in `src/web/navigation.ts` beside `MENU_ITEM_FLAGS`, because a menu name is render-side vocabulary rather than a setting: `MENU_NAME_PATTERN` + `menuNameProblem()`, and the `Label | URL [| flag]` line format moved out of `admin/settings.ts` as `menuItemsFromText()`, `menuItemsText()` and `menuItemLineProblem()`. The URL check becomes a local absolute-http(s) test rather than borrowing `normalizeRelayInbox`, which would make `web/` depend on `admin/`.

2. Naming rules, decided and written down: a menu name is what a theme writes after `menus.` in `{% for item in menus.<name> %}`, so it is lower case, starts with a letter, holds only letters, digits and underscores, and is at most 32 characters. A hyphen is refused because after a dot it is a minus sign, which would render nothing and say nothing. Lower case only is what refuses the confusable spelling: `Footer` cannot sit beside `footer`. A name the site already holds is refused as a duplicate. The rule governs names typed into the Add form; a name a `theme.json` declares is a menu name by declaration and is shown as the theme spells it.

3. `SiteSettings` stops carrying one menu and starts carrying all of them: `navigation` goes, `menus: NavigationMenus` arrives as a setting no form holds (like `taxonomyRedirects`), so `SettingsField` excludes it. `settingsFromForm(form, carried)` takes both carried values; `settingsFromSiteJson` and `siteJsonFor` model `menus` whole rather than merging a primary into it.

4. Settings > Reading loses the Menu box: `SETTINGS_FIELDS.navigation`, `READING_SETTINGS.fields`, the textarea in `reading.njk`, the `navigation` default in the test harness's reading form.

5. The screen, `src/admin/navigation.ts` + `admin/pages/navigation/menus.njk`: GET `/admin/navigation` lists the active theme's areas in the theme's order with the theme's labels, each an editable box (empty when the site has never filled it in), then every other stored menu under a heading saying this theme renders them nowhere, each editable and each with a Delete. POST `/admin/navigation` saves one menu's items; POST `/admin/navigation/add` adds one by name; POST `/admin/navigation/delete` removes one, and refuses to remove a menu the theme declares. A refused save or add is a 400 re-render keeping what was typed.

6. Wiring: a `navigation` section in `src/admin/menu.ts` after Pages, a `ADMIN_TEMPLATES.navigation` entry, `mountNavigationScreen` in `routes.ts`, the exports in `src/admin/index.ts` and `src/index.ts`, and the styles the screen needs in `admin/static/admin.css`.

7. Tests and docs: a new `src/admin/navigation.test.ts` for every criterion; the `site menu setting` block moves out of `settings-reading.test.ts` (that box no longer exists) and the rest of that file stays untouched; `menu.test.ts` and doc-5 gain the twelfth section and the new route; the root README, the package README's Navigation section and the theme README say what the screen is and what a theme declares for an area to appear on it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

**The screen** is `/admin/navigation`, a top-level **Navigation** section between Pages and Media with one child, **Menus** (`src/admin/navigation.ts`, `admin/pages/navigation/menus.njk`). It is the cross product of the theme's declared areas and the site's stored menus:

- *Where <Theme> puts a menu* — one panel per area the active theme declares, in `theme.json` order and under the theme's own labels, each headed by the label, then `menus.<name>` and either "N items" or "empty — nothing has been typed here yet", then a `Label | URL` textarea and a Save menu button. An area the site has never filled in is an empty box, not a missing one. A theme that declares no areas gets a paragraph saying so and how to declare them.
- *Kept, rendered nowhere* — every stored menu no area names, by name, each the same editable panel plus a Delete this menu button under a rule. Shown only when there are any.
- *Add a menu* — one Name field and an Add menu button.

Three POSTs, each its own form so a refusal cannot lose what was typed elsewhere: `/admin/navigation` (save one menu's items), `/admin/navigation/add`, `/admin/navigation/delete`. A refused save or add is a 400 re-render with the box holding exactly what was typed; a delete of an area the theme declares, or a save naming a menu the screen does not show, is a flashed refusal and a redirect that writes nothing.

**The naming rules**, decided here and written down in `menuNameProblem` (`src/web/navigation.ts`), the root README, the package README and doc-5: a menu name is lower-case ASCII letters, digits and underscores, starting with a letter, at most 32 characters. A dash is refused because the name is what a theme writes after a dot — `{% for item in menus.footer %}` — where a dash is a minus sign, so `menus.top-bar` would render nothing and raise nothing. Lower case only is what refuses the confusable spellings: `footer` and `Footer` would be two menus nothing could tell apart, so `Footer` is refused rather than quietly lowered. A name the site already holds is refused with a message saying its box is already on the page. The rule governs a name somebody types; a name a `theme.json` declares is a menu name by declaration and is shown as the theme spells it.

**Theme areas.** The areas offered are those of the first theme on the render's own search path that declares any — so a site theme declaring none inherits the packaged theme's `primary`/`footer`, exactly as it inherits every template it has not overridden. Without that, a theme that overrode only `post.njk` would show an empty Navigation screen while its inherited `layouts/base.njk` went on rendering both menus.

**The model.** `SiteSettings.navigation` is gone; `SiteSettings.menus: NavigationMenus` models every menu instead, as a setting no form carries (`SettingsField` now excludes it, as it excludes `taxonomyRedirects`). `settingsFromForm(form, carried)` takes a `CarriedSettings` object, and `mountSettingsPage` passes the settings re-read inside the atomic write, so a settings save carries every menu through untouched. `siteJsonFor` writes `menus` whole rather than merging a primary into it. The `Label | URL` line format moved out of `admin/settings.ts` into `web/navigation.ts` as `menuItemsFromText`, `menuItemsText`, `menuItemOf` and `menuItemLineProblem`, with a local absolute-http(s) test in place of `normalizeRelayInbox`, which would have made `web/` depend on `admin/`.

## Verified

`pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` and `pnpm test:11ty` all pass: 2099 + 30 unit tests, 16 + 5 Eleventy tests, no lint or format findings.

Exercised over real HTTP on a throwaway site (port 3112, a `starlight` theme declaring `utility`/`primary`/`footer`, a stored `sidebar`), server stopped afterwards: the screen drew Utility bar, Site menu, Footer links in the theme's order then `sidebar` under "Kept, rendered nowhere"; adding `top-bar` was a 400 naming the minus-sign reason; adding `social` was a 303 and a new empty block; saving the site menu with a `| me` line was a 303 and the public site served `<a href="https://example.social/@ada" rel="me">Mastodon</a>` on the next request; saving `RSS | feed/` into the footer was a 400 naming the line; deleting `sidebar` was a 303 and the file lost that key and nothing else.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-09-20 15:46
---
AC #7 in the letter and in the spirit: the four describe blocks of settings-reading.test.ts that are about the Reading page — what the homepage displays, the posts page, posts per page, the notify server — are byte-identical and pass unedited, which is the proof that nothing else on that page changed. The fifth block, 'the site menu setting', tested the box the task removes, so it could not survive; it is replaced by one test asserting the box is gone and that a Reading save leaves every stored menu exactly as it was, and its behaviour is now covered on the Navigation screen's own tests.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the Navigation screen at /admin/navigation: a top-level section between Pages and Media holding one child, Menus, which draws the areas the active theme declares (theme order, theme labels, an unfilled one an empty box) and then, under 'Kept, rendered nowhere', every stored menu no area names — editable, each with the Delete that is the only way a menu is removed. Adding asks for a name; the rule, written down in menuNameProblem and in three READMEs and doc-5, is lower-case letters, digits and underscores starting with a letter, up to 32 characters, because the name is what a theme writes after the dot in menus.<name> and a dash there is a minus sign, and because one spelling per menu is what stops two menus nothing can tell apart. SiteSettings.navigation became SiteSettings.menus, a setting no form carries, so Settings > Reading lost its Menu box and every settings save carries the menus through untouched; the Label | URL line format moved from admin/settings.ts to web/navigation.ts. Verified with pnpm build, test (2099 + 30), typecheck, lint, format:check and test:11ty (16 + 5), all passing, and by driving a real server over HTTP: adding a menu, editing one with a rel=me line that the public site served on the next request, refusing a dashed name and a malformed line, and deleting an unused menu.
<!-- SECTION:FINAL_SUMMARY:END -->
