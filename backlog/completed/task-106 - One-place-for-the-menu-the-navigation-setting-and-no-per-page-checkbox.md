---
id: TASK-106
title: 'One place for the menu: the navigation setting, and no per-page checkbox'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 12:18'
updated_date: '2026-09-20 14:43'
labels:
  - web
  - admin
milestone: m-16
dependencies: []
references:
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/admin/documents.ts
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/src/index.ts
  - packages/cms/src/web/index.ts
type: feature
ordinal: 131800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The menu comes from two places that cannot see each other. `navigationMenu` (web/navigation.ts) concatenates the lines typed into the `navigation` setting with every page whose front matter says `navigation: true`, which the page editor offers as a checkbox and an order number.

The two sources cannot be reconciled by anybody using them:

- A checked page can never sit between two typed lines. The comment at navigation.ts:62 says so outright: pages 'come after the items the setting names', so a page opting in appends itself.
- Ordering works differently in each. Typed lines keep the order they were typed; checked pages sort by `navigationOrder` and then by title, with pages naming no order last.
- Nothing dedupes. A page both typed into the setting and ticked in its editor appears in the menu twice, and neither screen says the other exists.

Keep the setting and drop the checkbox. The `navigation` box in Settings > Reading becomes the whole menu: what it says, in the order it says it, and nothing else. One screen, one order, no duplicates.

What goes:
- `navigation` and `navigationOrder` as front matter, and `NAVIGATION_KEY`, `NAVIGATION_ORDER_KEY`, `navigationPages` and `navigationOrder` in web/navigation.ts.
- The checkbox and the order box in the page editor, and the two fields the editor writes in admin/documents.ts.
- The `homepage` rewriting inside `navigationPages`, which existed so a page serving as the front page was linked at `/` rather than at the permalink that redirects there. With a typed menu that is the admin's business: they type `Home | /`.

What stays: `navigationMenu`, which becomes the setting's items with `current` marked, and everything about how a line is parsed and refused.

shll.me is the only live site and it uses no checkbox, so nothing needs migrating. A page that still carries `navigation: true` in its front matter simply stops meaning anything, which is worth a line in the release notes rather than a migration.

Coordinate with TASK-104, which was going to put `navigation: true` on the starter About page: with this in, the starter site types About into the setting instead. TASK-105 is the theme side and does not care where the items come from.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The menu is exactly the navigation setting's items, in the order the setting gives them, proven by a test
- [x] #2 A page carrying navigation: true in its front matter is not in the menu, proven by a test
- [x] #3 The page editor offers no navigation checkbox or order box, and saving a page writes neither key, proven by a test
- [x] #4 navigationPages, navigationOrder, NAVIGATION_KEY and NAVIGATION_ORDER_KEY are gone from the package's exports and from the codebase
- [x] #5 A page served as the front page is reachable from the menu by typing Home | /, and the README says so where it described the checkbox
- [x] #6 The starter site types its About line into the setting rather than ticking a box
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Red first. Rewrite src/web/navigation.test.ts so the menu is exactly the setting's items (AC #1) and a page carrying navigation: true is absent (AC #2); rewrite src/web/site.test.ts's opt-in case as an end-to-end proof over a real site; add an admin/pages.test.ts case proving the editor offers no checkbox or order box and that a POST carrying navigation=1 and navigation_order=2 writes neither key (AC #3).
2. web/navigation.ts: delete NAVIGATION_KEY, NAVIGATION_ORDER_KEY, navigationPages and navigationOrder. navigationMenu becomes navigationItems(site) with current marked; NavigationMenuOptions loses `pages`, so it takes only { site, url }. navigationItems/navigationItemsOf/comparablePath are untouched.
3. web/render.ts: call navigationMenu({ site, url }). The renderer's `pages()` seam stays — postsPageContext still needs it — but its doc comment stops claiming the menu reads it.
4. admin/documents.ts: drop DocumentKind.navigable (and it from POST_KIND/PAGE_KIND), EditorForm.navigation and .navigationOrder, their blankForm/formFor values, the body parse of `navigation`/`navigation_order`, the menu-order validation, and the navigable branch of resolveExtra. admin/pages/documents/editor.njk loses the whole `{% if kind.navigable %}` block.
5. Exports: remove navigationOrder, navigationPages, NAVIGATION_KEY and NAVIGATION_ORDER_KEY from src/web/index.ts and src/index.ts (AC #4).
6. Content and fixtures: take navigation/navigationOrder out of apps/demo pages (archive, posts, contact) and type the lines into apps/demo/content/_data/site.json instead, including Home | / for the About page that serves as the front page (AC #5); same for test/fixtures/content (about, colophon) and its site.json and _includes/page.njk; update test/eleventy.test.ts's menu case and docs/eleventy.config.example.js's collections.menu, which loses its pages half.
7. Starter site: packages/cms/templates/site/content/_data/site.json gains navigation with an About line (AC #6), with a starter-site test to prove it.
8. Docs: README.md, packages/cms/README.md (both places), packages/cms/themes/default/README.md and admin/pages/settings/reading.njk stop describing the checkbox and describe Home | / for a front page instead (AC #5); doc-2 loses the navigationOrder row and doc-5 loses Show in navigation, both through the backlog CLI.
9. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The menu now has one source. `navigationMenu` is `navigationItems(site)` with `current` marked, and `NavigationMenuOptions` is `{ site, url }`.

Removed:
- `NAVIGATION_KEY`, `NAVIGATION_ORDER_KEY`, `navigationPages` and `navigationOrder` from web/navigation.ts, and all four from the `web` barrel and the package root.
- The `homepage` rewriting that lived inside `navigationPages`. A front page is now typed `Home | /`.
- `DocumentKind.navigable`, `EditorForm.navigation`, `EditorForm.navigationOrder`, their blankForm/formFor values, the `navigation`/`navigation_order` body parse, the "A menu order is a number" refusal, and the `kind.navigable` branch of `resolveExtra`.
- The `{% if kind.navigable %}` block of admin/pages/documents/editor.njk, which was the checkbox and the order box.
- The pages half of `collections.menu` in docs/eleventy.config.example.js.

Kept: `navigationItems`, `navigationItemsOf`, `comparablePath` and every rule about parsing and refusing a line; the settings screen; the renderer's `pages()` seam, which `postsPageContext` still needs.

A page that still carries `navigation: true` keeps it. `resolveExtra` spreads `document.extra`, so after this change the key is an ordinary hand-added key and doc-2's round-trip rule applies: the editor writes it back untouched and nothing reads it. Proven by a pages.test.ts case.

Content and fixtures typed their lines instead of ticking boxes: apps/demo (Home | /, Posts, Archive, Contact — the demo's homepage is the About page, so it is the worked example of AC #5), test/fixtures/content (About and Colophon appended to the two items already there, so the Eleventy suite asserts the same four links it did before), and templates/site (About).

Docs: README.md (two places), packages/cms/README.md (the Navigation section and the Eleventy collections table), themes/default/README.md, admin/pages/settings/reading.njk's hint, docs/eleventy.config.example.js's comment, test/fixtures/content/_includes/page.njk's comment, doc-2 (the `navigation` front-matter row and the `navigationOrder` extra-key row) and doc-5 (Show in navigation), the last two through the backlog CLI.

Test bookkeeping. src/admin/pages.test.ts lost three cases — the two that proved the checkbox round-tripped and the one that proved a post never got the keys — and gained two: the editor offers neither field and saves neither key, and an older file's keys are left alone. Its `submit` helper stopped carrying `navigation`/`navigation_order`. src/web/navigation.test.ts lost the `navigationPages` ordering case and gained an empty-setting case. src/web/site.test.ts's opt-in case became the case that proves the front matter is inert, plus a Home | / case. src/web/front-page.test.ts's homepage/posts-page menu case types its two lines now. Net across the suite is +1 (2061 to 2062), so no count dropped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The site menu is the `navigation` setting and nothing else. `navigationMenu` is now `navigationItems(site)` with `current` marked, and `NAVIGATION_KEY`, `NAVIGATION_ORDER_KEY`, `navigationPages` and `navigationOrder` are gone from web/navigation.ts and from both barrels; the page editor's Show in navigation checkbox and Menu order box are gone with `DocumentKind.navigable`, the two `EditorForm` fields, the menu-order refusal and the `resolveExtra` branch that wrote the keys. A page a site serves at `/` is typed `Home | /` now that the `homepage` rewriting inside `navigationPages` is gone, and README.md, packages/cms/README.md, themes/default/README.md, the Reading settings hint, the example Eleventy config, doc-2 and doc-5 all say so. The demo, the Eleventy fixtures and the starter site.json type their lines instead of ticking boxes.

Breaking: `navigation: true` and `navigationOrder` in front matter stop meaning anything. They are not stripped — after this change they are ordinary hand-added keys, and doc-2's round-trip rule keeps them in the file untouched.

Verified with pnpm build, pnpm test (2062 unit + 30 demo, 0 failing), pnpm test:11ty (16 + 5, 0 failing), pnpm typecheck, pnpm lint and pnpm format:check, all green. AC #1 by src/web/navigation.test.ts and the site.test.ts menu suite; AC #2 by site.test.ts 'leaves out a page whose front matter still says navigation'; AC #3 by admin/pages.test.ts 'offers no checkbox or order box, and saves neither key', which fetches the real editor HTML and posts the two fields back; AC #4 by a grep of the tree outside backlog/ and the CHANGELOG; AC #5 by site.test.ts 'links the page serving as the front page by typing Home | /'; AC #6 by seed.test.ts 'types the About page into the navigation setting'.
<!-- SECTION:FINAL_SUMMARY:END -->
