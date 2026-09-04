---
id: TASK-46
title: 'Site navigation: a menu setting and show-in-navigation on pages'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:34'
updated_date: '2026-09-04 05:49'
labels:
  - theme
  - admin
milestone: m-5
dependencies:
  - TASK-12
  - TASK-14
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 27900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme has no navigation: pages exist but nothing links to them. Add a `navigation` setting, an ordered list of `{ label, url }` items, edited on the settings screen and mirrored to `site.json` so an Eleventy build renders the same menu. A page may also opt in with `navigation: true` (optionally `navigationOrder`) in its front matter, which the editor exposes as a checkbox, and those pages follow the explicit items. The base layout renders the menu and marks the current item; the theme README documents the template variable for a site overriding the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Items from the navigation setting render in the header in order, with the current one marked, on every public page
- [x] #2 A page with navigation: true appears in the menu without being listed in the setting, and the editor checkbox round-trips it
- [x] #3 The setting is mirrored to site.json and read back on seed; an old site.json without it yields an empty menu
- [x] #4 A malformed item (missing label or url) is refused on the settings screen with a message
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test, all through the existing harnesses: a new src/web/navigation.test.ts over the menu builder and the tolerant readers; src/admin/settings.test.ts for the navigation setting (the textarea, the site.json mirror, a malformed line refused with nothing written, the seed); src/admin/pages.test.ts for the editor checkbox and order field round-tripping through the file; src/web/site.test.ts for the rendered header on the home page, a post, a page and an archive, and for an old site.json yielding no menu.

2. The setting. `navigation: readonly NavigationItem[]` ({ label, url }) joins SiteSettings, DEFAULT_SITE_SETTINGS ([]), SETTINGS_FIELDS, the reader/writer, settingsProblems, settingsFromForm, formFromSettings, settingsSiteData, siteJsonFor, seedSiteSettings and SiteData — the exact path `relays` took. Edited as a textarea, one `Label | URL` per line, because that is the shape already on the screen for an ordered list and it needs no JavaScript; stored newline-joined in the settings table and mirrored to site.json as an array of objects so an Eleventy template can loop it. A line with no pipe, an empty label or an empty URL is refused with the offending line quoted, the way a bad relay line is. A URL is a site-root path or an absolute http(s) URL.

3. Front matter. `navigation: true` and the optional `navigationOrder` stay unmodelled keys in Document.extra, exactly as `eleventyExcludeFromCollections` does: the editor is the only writer, the parser and the store already round-trip extra verbatim, Eleventy reads them as ordinary data keys, and no content-index migration is needed. DocumentKind gains `navigable` (pages only), EditorForm gains `navigation` and `navigationOrder`, resolveExtra writes them, formFor reads them, and the editor template gets a checkbox and a small order field beside the Hide-from-collections one. The conflict form and the preview go through the same resolveExtra/documentContext, so they follow.

4. The menu. New src/web/navigation.ts: NavigationItem, MenuItem { label, url, current }, navigationItems(site) reading site.navigation tolerantly (a hand-edited site.json that says something else yields an empty menu rather than a 500, the taxonomyBasesOrDefault pattern), navigationPages(documents) picking the flagged public pages and sorting them by navigationOrder then title, and navigationMenu({ site, pages, url }) putting the explicit items first and marking the one whose URL is the current path. createRenderer gains a `pages()` seam — createCms passes store.listAll({ type: 'page', draft: false, trashed: false, scheduled: false }) — and render() puts `navigation` in every template context, so the header is on the home page, a post, a page, an archive, the 404 and the editor preview alike. themes/default/layouts/base.njk renders a <nav> in the header block with aria-current on the current item, and style.css gets the few rules it needs.

5. Docs. The theme README's context table and a Navigation section; packages/cms/README.md settings; the root README's settings list and field table; doc-2's front-matter table (via the backlog doc CLI); and a `navigation` collection in packages/cms/docs/eleventy.config.example.js so a build renders the same menu from site.json plus the flagged pages.

6. Verify: pnpm build, test, typecheck, lint, format:check from the root, then a live pass on the demo — set navigation items, tick the box on a page, read the menu off the home page, a post, a page and an archive, read site.json, submit a malformed item — restoring the demo and releasing port 3000 afterwards. No post is published live, so rpc.rsscloud.io is never pinged.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

A site menu that is two lists joined: the `navigation` setting, and the pages that put themselves on it.

- **`src/web/navigation.ts`** (new) — `NavigationItem {label,url}`, `MenuItem {label,url,current}`, `navigationMenu({site,pages,url})`, `navigationItems(site)`, `navigationItemsOf(value)`, `navigationPages(documents)`, `navigationOrder(document)`, and the two front-matter key constants `NAVIGATION_KEY` / `NAVIGATION_ORDER_KEY`. Exported from the `web` barrel and the package root.
- **Setting.** `navigation: readonly NavigationItem[]` follows the path `relays` took — `SiteSettings`, `DEFAULT_SITE_SETTINGS` (`[]`), `SETTINGS_FIELDS.navigation`, the reader, the writer, `settingsProblems`, `settingsFromForm`, `formFromSettings`, `settingsSiteData`, `siteJsonFor` (written even when empty), `seedSiteSettings`, `SiteData`, and a textarea under a new **Navigation** heading on the settings screen. New private helpers `navigationLines`, `navigationItem`, `navigationList`, `navigationText`.
- **Renderer.** `CreateRendererOptions.pages?: () => readonly Document[]`, and `render()` now puts `menu` on every template context, built from the site data and that seam against the path it reads off `page.url` (then `url`). `createCms` passes `store.listAll({ type: 'page', draft: false, trashed: false, scheduled: false })`.
- **Theme.** `layouts/base.njk` renders a `<nav class="site-nav" aria-label="Site">` inside the `header` block, with `class="is-current" aria-current="page"` on the current item; `static/style.css` gained the rules for it.
- **Editor.** `DocumentKind.navigable` (pages only), `EditorForm.navigation` / `.navigationOrder`, a **Show in navigation** checkbox and a **Menu order** field in `admin/layouts/document-editor.njk`, and `resolveExtra` now takes the form rather than one boolean. The conflict form and the preview go through the same `resolveExtra`/`documentContext`, so they follow with no change of their own.
- **Docs.** A Navigation section in the theme README and a `menu` row in its context table; a Navigation section in `packages/cms/README.md` plus the settings/route lines and the Eleventy collections paragraph; the root README's settings prose, key list and field table; doc-2's two front-matter tables; and a `menu` collection in `docs/eleventy.config.example.js`.

## Decisions

- **`navigation`/`navigationOrder` are unmodelled keys in `Document.extra`, not `KNOWN_FRONT_MATTER_KEYS`.** `eleventyExcludeFromCollections` is the precedent and it is exactly the same shape: a page-only boolean the editor is the only writer of. Modelling them would have meant two columns on the `documents` table and a migration that empties the index to re-read every file, and would have bought nothing: `extra` already round-trips through the index verbatim, Eleventy sees both keys as ordinary data, and the menu is built from a handful of pages in memory rather than by a query.
- **The template variable is `menu`, not `navigation`.** This cost a red test to find. `documentContext` spreads a document's front matter over the globals — Eleventy's data cascade — so a page carrying `navigation: true` replaced the menu on its own page with the boolean `true`, and the header vanished from exactly the pages that had opted into it. Under the Eleventy example config the same collision would have been worse: `collections.navigation` would be the menu while `navigation` was the page's flag, so one line of layout would mean two things. `menu` cannot collide with the key a page opts in with.
- **The setting is a textarea of `Label | URL` lines.** The same shape as the relays field, which is the screen's existing answer for an ordered list, and it needs no JavaScript. The split is at the *first* bar, so a URL holding one survives and a label cannot hold one. Stored newline-joined in the settings table and mirrored to `site.json` as an array of objects, because the file is what an Eleventy template loops over.
- **Explicit items first, then the flagged pages.** A menu somebody typed out stays in the order they typed it, and a page opting in appends itself rather than landing in the middle. Among themselves the pages go by `navigationOrder` then title, and a page with no order sorts after every page that has one: an order pulls one page forward, it is not something every page must carry before any of them can.
- **Clearing the checkbox deletes both keys rather than writing `navigation: false`.** This is where it parts company with `eleventyExcludeFromCollections`, which is written `false` when the file already had it. That one is Eleventy's key and a site may have hand-written it for a build of its own, so a `false` says something; these two are the CMS's own, absent and false mean the same to everything that reads them, and an order on a page that is not in the menu means nothing at all.
- **An item that is not a path is never current.** `comparablePath` returns `undefined` for anything not starting with `/`, so an absolute URL naming this very origin is still a link off the site as far as the menu is concerned — which is what a site typing it out meant. Paths compare without their trailing slash, so `/about` and `/about/` are the same item.
- **The pages are read per render, not cached.** One indexed `listAll` over a site's handful of pages, which is what makes a page flagged in the editor appear in the menu on the very next request rather than after a restart or an invalidation somebody has to remember to fire.
- **A bad stored value yields an empty menu, not a 500.** `navigationItemsOf` drops what it cannot read, the way `taxonomyBasesOrDefault` falls back: the settings screen refuses a malformed item, so anything unreadable came from a hand-edited `site.json`.

## Verification

**Tests.** 12 new cases, all green. 6 in the new `src/web/navigation.test.ts` (the setting's order, current marking with and without the trailing slash and never on an absolute URL, the flagged pages after the items ordered then titled, and three over the tolerant reader); 3 in `src/web/site.test.ts` (the menu on the home page, a post, a page and a tag archive with the current one marked; a `site.json` from before the setting yielding no `<nav>` at all; a flagged page joining the menu and marking itself); 3 in `src/admin/settings.test.ts` (the textarea round trip through the store, the mirror and the form; five malformed lines each refused 400 with nothing written; the seed from a `site.json` that has a menu and from one that has not); 3 in `src/admin/pages.test.ts` (the checkbox and the order writing and reading back and reaching the public menu; clearing the box removing both keys and keeping a hand-added one; a post refusing both keys even when they are posted by hand); and 1 in `test/eleventy.test.ts`, where the fixtures now carry a menu and `_includes/page.njk` renders `collections.menu`, so a real Eleventy build is checked to produce the same four items in the same order with the same one marked.

Mutation-checked rather than trusted. Each of these failed exactly the tests that name that behaviour and nothing else: `current` hard-coded to `false` (4 tests), the flagged pages left out of the menu (3), `navigation` dropped from `siteJsonFor` (3, including the mirror's whole-object assertion), and the line validator answering "nothing wrong" (1, the AC #4 test).

**Checks, from the repository root.** `pnpm build` clean; `pnpm test` 782 pass / 0 fail (`@geekity/cms`) and 11 / 0 (demo); `pnpm test:11ty` 10 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean.

**Live, against the demo on port 3000**, signed in as `ada`. No post was published, so `rpc.rsscloud.io` was never contacted — the server log stayed at its three startup lines throughout.

- **AC #1.** Saving `Home | /`, `About | /about/`, `Colophon | /colophon/` and `Fediverse | https://tags.pub/` put all four in the header, in that order, on `/`, on `/2026/09/the-theme-is-just-templates/`, on `/about/`, on `/tag/markdown/` and on `/page/2/`. `class="is-current" aria-current="page"` was on Home on `/`, on About on `/about/`, and on nothing at all on the post, the archive and page 2.
- **AC #2.** `/admin/pages/now` carried the checkbox and the order field; `/admin/posts/the-theme-is-just-templates` carried neither. Ticking it with order 1 wrote `navigation: true` and `navigationOrder: 1` into `content/pages/now.md`, put Now on the menu after the four typed items on the very next request, and marked it current on `/now/`; reloading the editor came back `checked` with `value="1"`. Clearing the box took both keys back out of the file and Now off the menu.
- **AC #3.** `content/_data/site.json` was rewritten with `"navigation"` as the four `{label, url}` objects in order, with `feedSize` and every other key it already had untouched.
- **AC #4.** `Broken item with no url` came back 400 with "Nothing was saved. Fix the fields marked below and try again." and, under the field, `A menu item is "Label | URL", one per line, where the URL is a path like /about/ or an absolute http:// or https:// URL. "Broken item with no url" is not one.` `About |`, `| /about/` and `About | not-a-url` were each refused the same way, and the four stored items and the mirrored file were unchanged after all four attempts.

The demo was put back: `data/geekity.db`, `content/_data/site.json` and `content/pages/now.md` restored from the backups taken before the run, leaving only the pre-existing uncommitted `site.json` edit and `content/uploads/`. `pgrep -fl "tsx watch"`, `pgrep -fl server.ts` and `lsof -nP -iTCP:3000` all report nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave the site a menu, and gave a page a way onto it.

`/admin/settings` has a Navigation field: one `Label | URL` per line, in the order the header should render them, the URL a site-root path or an absolute URL for somewhere else. It is stored in the settings table beside the other settings and mirrored to `content/_data/site.json` as a list of `{ label, url }`, so an Eleventy build of the same content renders the same menu — the example config assembles it as `collections.menu`, and the fixtures suite builds it with Eleventy and checks the result. A page can put itself on the end of the menu by ticking Show in navigation in the editor, which writes `navigation: true` into its front matter, with a Menu order field for `navigationOrder`; the flagged pages come after every item the setting names, sorted by order and then by title, and a page with no order sorts after every page that has one. Posts have neither field.

Two decisions carry the design. The keys stay unmodelled front matter in `Document.extra`, exactly as `eleventyExcludeFromCollections` does, because `extra` already round-trips through the index verbatim and Eleventy reads both as ordinary data — so a menu costs no column and no migration that would empty every site's index. And the template variable is `menu` rather than `navigation`: front matter goes over the globals as Eleventy's data cascade does, so a global called `navigation` was replaced by the boolean `true` on exactly the pages that had opted in, and the header vanished from them. A red test found it.

The menu is built in the renderer, so it is on every page the theme serves — a listing, a document, the 404 and the editor's preview alike — with the item whose path is being read marked `aria-current="page"`. Paths compare without their trailing slash; an item pointing off the site is never current. A `navigation` in a hand-edited `site.json` that is not a list of items yields an empty menu rather than an error.

Verified with 12 new tests, every one mutation-checked — hard-coding `current` to false, dropping the flagged pages, dropping the mirror and disabling the line validator each failed exactly the tests that name that behaviour — including one that runs a real Eleventy build over the fixtures and reads the same four items back off the built page. Then a live pass on the demo covering all four criteria: the menu in order on the home page, a post, a page and two archives with the current one marked; the Now page ticked into the menu and back out again, front-matter keys and all, round-tripping through the editor; the four items in the rewritten `site.json` with `feedSize` untouched; and four malformed lines each refused 400 with the offending line quoted and nothing written. `pnpm build`, `test` (782 + 11), `test:11ty` (10 + 5), `typecheck`, `lint` and `format:check` all pass; the demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
