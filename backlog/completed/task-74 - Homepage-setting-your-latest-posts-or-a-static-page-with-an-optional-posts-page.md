---
id: TASK-74
title: >-
  Homepage setting: your latest posts or a static page, with an optional posts
  page
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 14:04'
updated_date: '2026-09-13 03:19'
labels:
  - admin
  - web
  - content
milestone: m-12
dependencies:
  - TASK-73
references:
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/admin/settings.ts
  - packages/cms/docs/eleventy.config.example.js
  - packages/cms/test/eleventy.test.ts
  - /Users/andrewshell/Desktop/Screenshot 2026-09-05 at 9.03.22 AM.png
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
  - backlog/docs/doc-3 - Content-Negotiation.md
type: feature
ordinal: 99800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site root is always the latest posts. WordPress's Reading settings let a site choose what the homepage shows: your latest posts, or a static page picked from the published pages, with a second optional pick, the posts page, whose URL then carries the listing. Add the same choice to the Reading settings page (TASK-73) and to site.json as two settings holding page slugs, homepage and postsPage, absent when the site shows its latest posts, so an Eleventy build of the same directory can read them. When a homepage is set, the root renders that page with the page's own template context and a template a theme may override for the front page alone, falling back to the page template, and the page's own permalink answers with a permanent redirect to the root so there is one URL. When a posts page is set, its permalink renders the listing the root used to, paginated under it as {permalink}page/N/, showing the page's title and body above the posts, with a template a theme may override, falling back to the listing template; the feeds stay at /feed/ and its siblings and the posts page advertises them; the root's /page/N/ redirects to the posts page's pagination. A posts page with no homepage set is refused, as WordPress refuses it. If the chosen page is later drafted, trashed or deleted the site falls back to the latest posts and the Reading page says so beside the empty pick; the pages list marks the two pages the way WordPress does. The sitemap and the site menu follow: the homepage is / and the posts page is its own URL. The Eleventy example config honours both settings so the compatibility build shows the same front page and posts page. Reference: the WordPress Reading screen, 'Your homepage displays: Your latest posts / A static page (select below), Homepage, Posts page'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Reading settings page offers Your latest posts or A static page with Homepage and Posts page picks listing published pages; the choice is stored as homepage and postsPage slugs in site.json and absent when latest posts is chosen; a posts page without a homepage is refused with a message
- [x] #2 With a homepage set, GET / renders that page, its own permalink redirects 301 to /, and a theme can override the front page template with fallback to the page template
- [x] #3 With a posts page set, its permalink renders the listing with the page's title and body above it, paginated at {permalink}page/N/ with canonical redirects, /page/N/ under the root redirects there, and the feeds stay at /feed/, /feed/atom/ and /feed/json/ and are advertised on it
- [x] #4 Drafting, trashing or deleting a chosen page falls the site back to latest posts without a 500, and the Reading page shows why the pick is empty; the pages list marks the homepage and the posts page
- [x] #5 The sitemap lists / once and the posts page at its own URL; the site menu links the posts page when it opts in like any page
- [x] #6 docs/eleventy.config.example.js honours homepage and postsPage and test/eleventy.test.ts proves an Eleventy build of a site with both set renders the same front page and listing; doc-2, doc-3 and doc-5 describe the setting
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Settings model (src/admin/settings.ts): add `homepage` and `postsPage` to SiteSettings, DEFAULT_SITE_SETTINGS (empty), SETTINGS_FIELDS (`homepage`, `posts_page`), settingsFromSiteJson, settingsFromForm, formFromSettings, and siteJsonFor — where the two keys are written only when a page is named, so a site showing its latest posts has neither key in site.json. FIELD_CHECKS: a shape check on each (a slug, or empty), plus the two refusals a pair needs — a posts page with no homepage, and one page named as both.
2. Reading page (src/admin/settings-reading.ts + admin/layouts/settings/reading.njk): list the two fields, and a `panels:` hook that reads the published pages off `c.var.store` and reports, per pick, the slug stored and whether it still names a published page. The template renders "Your homepage displays" as a select whose empty option is Your latest posts, a Posts page select beside it, and the note that says why a pick came up empty.
3. Read side (src/web/context.ts, render.ts): `frontPage(site)` reads the two slugs off site.json, `renderer.frontPage()` exposes them, `TEMPLATES.frontPage` / `TEMPLATES.postsPage` name the two override points, and `renderer.hasTemplate()` decides the fallback to the page and listing templates. `Listing.document` carries the posts page so its title and body render above the listing.
4. Routes (src/web/routes.ts): resolve the two slugs to public page documents per request. `/` renders the homepage document through the front-page template; the listing root becomes the posts page's permalink when there is one, so `parseListingPath` takes it as a parameter and `{permalink}page/N/` paginates there with the same canonical redirects; the homepage's own permalink 301s to `/`; `/page/N/` 301s to the posts page's pagination. Feeds stay at `/feed/` and its siblings, which the base layout already advertises on every page.
5. Fallback: a slug that no longer names a published page resolves to nothing, so the site is back to its latest posts with no 500 anywhere.
6. Sitemap and menu: `/` once (the homepage document's own permalink is not listed, because it redirects), the listing's pages under the posts page's URL, and a homepage that opted into the menu linked at `/`.
7. Pages list (src/admin/documents.ts + admin/layouts/document-list.njk): mark the two rows the way WordPress does.
8. Eleventy (docs/eleventy.config.example.js, test/eleventy.test.ts, test/fixtures): the build honours both settings — the homepage page is written at `/` and the posts page carries the listing — and the fixtures site.json sets both so the test proves it.
9. Docs: doc-2 (the two keys), doc-3 (what `/` and the posts page serve) and doc-5 (the Reading page), plus the package README where it lists the settings.
Test-first at the established seams: the admin HTTP tests in src/admin/settings-reading.test.ts and pages.test.ts, the public HTTP tests in src/web (a new front-page.test.ts), and the Eleventy build in test/eleventy.test.ts.

10. As built, the names in steps 3 and 4 settled as: `frontPageSlugs(site)` in context.ts and `renderer.frontPageSlugs()`; `OPTIONAL_TEMPLATES` for the two theme override points, chosen by a private `themeTemplate` fallback rather than a public `hasTemplate`; and `listingHref`/`listingPageHref` taking the listing's root rather than `parseListingPath`, with `listingRequestAt` and `listingRoot` answering where the listing is for every caller.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

**The setting.** `homepage` and `postsPage` are two page slugs on `SiteSettings`, on the Reading page, and in `content/_data/site.json`. They are the one pair of keys `siteJsonFor` writes only when they have a value: a site showing its latest posts has no static front page rather than an empty one, and an older `site.json` already reads that way. `FIELD_CHECKS` checks them as a pair, the way the two archive bases are checked — a slug's shape, a posts page with no homepage refused, and one page picked as both refused — because a page that both redirected to `/` and carried the listing would be a loop. Neither check asks whether the slug still names a published page: the select only offers ones that do, and a page drafted after it was picked must not be a settings screen that will not save.

**The Reading screen.** `READING_SETTINGS.panels` reads the published pages off `c.var.store` and reports, per pick, whether the stored slug is still among them. Two selects, the homepage's empty option reading "Your latest posts". A pick whose page has gone is off the list, the setting keeps the slug — publishing the page again puts the front page back — and the page says which one has gone, because a select that had quietly reset itself would be the screen lying about what is stored.

**The site.** `frontPages(c)` resolves the two slugs to public page documents once per request; a slug naming nothing resolves to nothing, and that is the whole of the fallback — there is no state to repair. `/` renders the homepage document through `renderFrontPage` (the theme's `layouts/front-page.njk`, falling back to `layouts/page.njk`) at the URL `/`, negotiated like any document, so `/index.md` and `/index.json` are its representations too. The page's own permalink answers 301 to `/`, in one hop from the unslashed spelling as well. The posts page is answered before the document lookup that would otherwise render it as the page it also is: `listingHref` and the new `listingPageHref` take the listing's root, so `{permalink}page/N/` paginates, `{permalink}page/1/` collapses, `/page/N/` at the root redirects, and `Listing.document` puts the page's title and body above the posts. With a homepage and no posts page the listing has no page at all, which is WordPress's own answer, and `listingRoot` says so once for every caller.

**Everything that follows.** The sitemap lists `/` once, the listing's pages under whichever root it has, and neither picked page at a URL that redirects or is already listed. `navigationMenu` links a homepage that opted into the menu at `/`. The pages list marks the two rows Front Page and Posts Page. The feeds never move: they are routes at `/feed/` and its siblings and `parseFeedPath` still reads every listing feed from `/`, so a subscriber's URL is the one they already hold.

**Eleventy.** A `geekity-front-page` preprocessor reads the same two keys, puts the homepage at `permalink: '/'` and flags `isPostsPage`, which the fixtures' page layout turns into the listing. The fixtures set both, and `test/eleventy.test.ts` builds them and reads the front page and the listing back.

## Decisions worth knowing

- The two keys are absent rather than empty in `site.json`, which is the one exception to "every key the settings model is written". The description asked for it and it is what a file written before this version already means.
- `front-page.njk` and `posts-page.njk` are override points the default theme does not ship (`OPTIONAL_TEMPLATES`), resolved per render with one `stat` per theme directory, so adding one to a theme shows on the next request.
- `layouts/home.njk` prints `{{ content | safe }}` when there is any, so the fallback from `posts-page.njk` still shows the page's words. The home listing has none and prints nothing.
- The page's own `.md` and `.json` at its permalink (`/welcome/index.md`) are left alone: only the HTML front page has one URL.

## Validation

`pnpm build`, `pnpm test` (1498 + 14 pass), `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test:11ty` (16 + 5 pass) all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
WordPress's Reading choice: `/` is the site's latest posts until `homepage` names a page, and `postsPage` then gives the listing a page of its own. Both are slugs in content/_data/site.json, absent for the latest posts, refused as a pair the way WordPress refuses them. The homepage is served at `/` through an optional front-page template and redirects 301 from its own permalink; the posts page carries the listing under its title and words, paginated at {permalink}page/N/, with /page/N/ redirecting there and the feeds staying at /feed/. A pick whose page stops being published resolves to nothing, so the site is back to its latest posts and the Reading page says which page has gone; the pages list marks Front Page and Posts Page, and the sitemap and menu follow. The Eleventy example config reads the same two keys. Verified by HTTP tests in src/web/front-page.test.ts, the admin tests in settings-reading.test.ts and pages.test.ts, and a real Eleventy build in test/eleventy.test.ts; pnpm build, test, typecheck, lint, format:check and test:11ty all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
