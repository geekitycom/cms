---
id: TASK-107
title: 'Named menus: the site stores them, the theme declares which it renders'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 12:31'
updated_date: '2026-09-20 15:02'
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
- [x] #1 site.json holds menus by name, each item a label, a URL and its flags, and a malformed item is refused the way a navigation line is today, proven by a test
- [x] #2 An item marked me renders with rel="me" and an unmarked one does not, proven by a test
- [x] #3 theme.json declares the areas a theme renders, and an unreadable or missing declaration leaves a theme with none rather than failing to load, proven by a test
- [x] #4 The packaged default theme declares primary and footer, and renders each from menus, proven by a test
- [x] #5 menus is on the template context keyed by name, with current marked for the path being rendered, proven by a test
- [x] #6 A menu stored under a name no theme declares is kept in site.json and rendered nowhere, proven by a test
- [x] #7 The navigation setting is read as menus.primary and the old key is no longer read, with the starter site and the README updated to match
- [x] #8 The theme README documents theme.json's areas and how a theme renders one
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Model. `packages/cms/src/web/navigation.ts` becomes the one place that knows what
   a menu is. `NavigationItem` grows `me?: true`, present only when the item is
   marked, so an unmarked item is spelled exactly as it is today. `navigationItemsOf`
   reads `me === true` and nothing else, keeping its "drop what it cannot read"
   tolerance. New `siteMenus(site)` reads `site.menus`, an object keyed by name, and
   returns every stored menu; `navigationItems(site, name)` is one of them, defaulting
   to `primary`. `navigationMenu({ site, url, name })` marks `current` on one menu;
   new `navigationMenus({ site, url })` marks every stored one and is what the render
   context carries. `site.navigation` stops being read.
2. Theme declaration. `packages/cms/src/web/themes.ts` grows `ThemeArea { name, label }`
   and `Theme.areas`, read from `theme.json`'s `areas` array with the same tolerance
   the rest of the manifest is read with: not an array, or an entry that is not an
   object with a name, leaves the theme with no areas rather than refusing to load it.
   A missing label falls back to the name. `packages/cms/themes/default/theme.json`
   declares `primary` and `footer`.
3. Rendering. `packages/cms/src/web/render.ts` puts `menus` on the context in place of
   `menu`. A new `partials/menu.njk` macro is the one loop that draws a menu, emitting
   `rel="me"` for a marked item and `aria-current` for the current one;
   `layouts/base.njk` and `partials/bio.njk` call it. `menus.primary` renders where
   `menu` renders today — the bio, else the page footer — and `menus.footer` renders
   in the footer beside the identity links. Nothing else moves; placement is TASK-105.
4. Storage and the screen. `packages/cms/src/admin/settings.ts` reads and writes
   `menus.primary` instead of `navigation`, and drops a stale `navigation` key when it
   next writes the file, because this is a rename. The Reading textarea line grows an
   optional third part: `Label | URL | me`. The flag is stripped off the end only when
   it is a flag this CMS has, so a URL holding a bar still survives and every existing
   refusal stands.
5. The rest of the rename: the three `site.json` files, the starter site, the Eleventy
   example's `collections.menu`, the fixture layout, the root README, the package
   README and the theme README, which also gains the `areas` documentation.
6. Verify: pnpm build, test, typecheck, lint, format:check and test:11ty.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What a menu is now

**In `site.json`** — a `menus` object keyed by name, each name an ordered list
of items:

```json
{
  "menus": {
    "primary": [{ "label": "About", "url": "/about/" }],
    "footer": [{ "label": "Mastodon", "url": "https://example.social/@me", "me": true }]
  }
}
```

The `navigation` array is gone: `siteMenus`/`navigationItems` read `menus` and
nothing else, and `siteJsonFor` deletes a `navigation` key when it next writes
the file, because this is a rename rather than a migration.

**In `theme.json`** — an `areas` list, each entry a `name` (the key under
`menus`) and a `label` a person reads. The packaged theme declares
`primary` → "Site menu" and `footer` → "Footer links"; the demo theme declares
the same two. A missing or unreadable `areas` leaves a theme with no areas
rather than refusing to load it, and a per-entry `label` falls back to the
name.

## How the me flag is stored and parsed

A flag is a boolean key on the item, written only when it is set: `me: true`,
never `me: false`. `navigationItemsOf` reads it only when it is spelled exactly
`true`, so `"yes"`, `1` and `false` all leave the item unmarked, and the type
is `me?: true` — the value cannot be anything else. An item with no flags is
spelled exactly as it was before flags existed, so no file has to be rewritten
to mean nothing. `MENU_ITEM_FLAGS` in `web/navigation.ts` is the list, so a
second flag is one entry plus its handling in the theme.

On the Reading textarea a flag is a third part of the line: `Mastodon |
https://example.social/@me | me`. `navigationItem` strips flags off the end
from the right, and only while the last part is the name of a flag this CMS
has. That is what keeps a URL holding a bar working — `Odd | /odd/?a=1|2`
round-trips — and what makes a trailing word that is not a flag stay part of
the URL rather than being read as one. Every refusal that stood before stands:
no bar, no label, no URL, or a URL that is neither a path nor an absolute
http(s) URL.

## What the template context carries

`menus`, keyed by name, each item `{ label, url, current }` plus `me: true`
where it is set. `menu` is gone. Every menu the site stores is on the context,
not only the ones the active theme declared an area for: the declaration is
what the Navigation screen (TASK-108) reads, and a menu nothing loops over is
rendered nowhere and kept — which is what lets somebody fill in the menu a
theme will use before switching to it.

## Decisions worth writing down

- `SiteSettings.navigation` keeps its name; only where it is read and written
  moved. It is the primary menu, and the Reading form is unchanged apart from
  the flag on a line — the screen that manages menus by name is TASK-108.
- `siteJsonFor` merges rather than replaces: `{ ...menusOf(existing.menus),
  primary: … }`, so a save of the Reading form leaves `footer` and any other
  stored menu exactly as it was.
- `partials/menu.njk` is one macro, `list(items, label)`, so the markup of a
  menu is written once and `rel="me"`/`aria-current` cannot drift between the
  bio and the footer. `label` is the `aria-label`, so two navs on one page are
  distinguishable.
- Placement did not move: `menus.primary` renders where `menu` rendered — the
  bio, else the page footer — and `menus.footer` is new, in the footer beside
  the identity links. TASK-105 owns any further placement.

## Validation

All from a clean tree at the end of the work:

- `pnpm build` — ok
- `pnpm test` — 2081 pass / 0 fail (@geekity/cms), 30 pass / 0 fail (demo)
- `pnpm typecheck` — ok
- `pnpm lint` — ok
- `pnpm format:check` — ok
- `pnpm test:11ty` — 16 pass / 0 fail, 5 pass / 0 fail; the example config's
  `collections.menus` builds the fixture's `menus.primary`, `rel="me"` and all

Also rendered the demo through `cms.app.request` to see the two navs in the
page footer with the right labels, order, `aria-current` and markup.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A menu is now a named thing the site stores and the theme asks for.

`content/_data/site.json` holds a `menus` object keyed by name — `primary`,
`footer`, anything a theme declares — each an ordered list of `{ label, url }`
items plus `me: true` on a link that should carry `rel="me"`. The `navigation`
array is no longer read anywhere, and `siteJsonFor` drops it on the next write:
a rename, not a migration. `theme.json` grows an `areas` list, each a `name`
and a `label`, and the packaged theme declares `primary` and `footer`; an
`areas` that is missing or will not read leaves a theme with none rather than
failing to load it. Every render carries `menus` on the template context, keyed
by name and marked `current`, in place of `menu` — every stored menu, so one
under a name no theme declares is kept in the file and rendered nowhere.
`partials/menu.njk` is the one macro that draws a menu, and `menus.primary`
renders where `menu` rendered while `menus.footer` joins the page footer.

Verified with `pnpm build && pnpm test && pnpm typecheck && pnpm lint &&
pnpm format:check` (2081 + 30 tests, none failing) and `pnpm test:11ty`, which
builds the fixture's `menus.primary` through the example config's
`collections.menus`. New tests prove each criterion: `web/navigation.test.ts`
for the model and the `me` flag, `web/themes.test.ts` for the declaration and
its tolerance, `web/page-shell.test.ts` for both menus rendered, `rel="me"`,
`current`, a menu kept and rendered nowhere and the old key ignored, and
`admin/settings-reading.test.ts` for the `Label | URL | me` line, its refusals
and the other menus surviving a save.
<!-- SECTION:FINAL_SUMMARY:END -->
