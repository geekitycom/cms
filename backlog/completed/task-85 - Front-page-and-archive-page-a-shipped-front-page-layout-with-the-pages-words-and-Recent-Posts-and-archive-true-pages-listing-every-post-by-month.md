---
id: TASK-85
title: >-
  Front page and archive page: a shipped front-page layout with the page's words
  and Recent Posts, and archive: true pages listing every post by month
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 13:37'
updated_date: '2026-09-13 19:20'
labels:
  - web
  - content
milestone: m-14
dependencies:
  - TASK-84
references:
  - packages/cms/themes/default/README.md
  - packages/cms/src/web/render.ts
  - packages/cms/src/web/routes.ts
  - apps/demo/content
  - /Users/andrewshell/code/wordpress/asdo-theme/front-page.php
  - /Users/andrewshell/code/wordpress/asdo-theme/page-essays.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 110800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two page kinds from the source theme (decision-16). Front page: the default theme ships layouts/front-page.njk, until now an override point only. It renders the homepage page (the Reading setting) as the page body without the Published line or the bio, then an h2 Recent Posts over a .feed.h-feed of recentPosts (TASK-79) with h3 titles, then a line of links to the posts page when one is set and to search once it exists, then the bio. The site with no homepage set keeps the listing at / as now. Archive page: a page whose front matter says archive: true renders its body and then every published post grouped by month, newest first, each month an h2 of Month Year over an ol.list-none of permalink links, the source theme essays page; the front matter key is documented beside contact: true and the Eleventy example config is unaffected because the page still builds as a page there. The demo gains an archive page and sets its about page as the homepage so both render; the demo tests cover them. The theme README documents both layouts and the front-page and posts-page table is updated to say front-page.njk now ships.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a homepage set, GET / renders the page body, then h2 Recent Posts and a .feed.h-feed of recentPosts with h3.feed-title entries, then the link line and the bio; the page permalink still redirects to / and the posts page link appears only when one is set
- [x] #2 A site theme that ships its own layouts/front-page.njk still wins over the packaged one
- [x] #3 A page with archive: true renders its body and then every published post grouped by month, newest first, as h2 Month Year headings over ol.list-none links; drafts and future posts are absent and a page without the key is unchanged
- [x] #4 The demo content has an archive page and a homepage set, and apps/demo/test/site.test.ts proves both render; the Eleventy compatibility test still passes
- [x] #5 themes/default/README.md documents archive: true beside contact: true, and its front-page table says the layout ships; front-page.test.ts is updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `web/archive.ts`: `ARCHIVE_FRONT_MATTER_KEY` ('archive'), `archiveOpen(document)` and `archiveMonths(posts, timezone)` grouping published posts, newest first, into `{ month, posts: [{ title, url, date }] }` by the calendar month of the site's zone (decision-11). Unit test beside it, the way `recent.ts` has one.
2. `templates.ts`: `formatDate` gains a `month` format ("September 2026") so the month name lives in one table; mirror it in `docs/eleventy.config.example.js` so the two filters stay the same filter.
3. `render.ts`: an `archivePosts` source option, asked only for a document whose front matter says `archive: true`, putting `archiveMonths` on the context the way `contactForm` goes on; `renderFrontPage` also puts `postsPage` ({ title, url }) on the context when the site names a published posts page. `index.ts` wires `archivePosts: () => store.listPosts()`.
4. Theme: ship `layouts/front-page.njk` — the page body, `h2` Recent Posts over `partials/post-list.njk` with `posts = recentPosts` and `feedHeading = 3`, the link line (posts page when there is one, search left to TASK-22), then the bio — and `partials/archive.njk`, included by `layouts/page.njk` after the content. Stylesheet rules for the archive list and the link line.
5. Tests: `web/page-kinds.test.ts` over HTTP against the packaged theme for both page kinds; rewrite the two assertions in `front-page.test.ts` that the shipped layout changes.
6. Demo: `pages/archive.md` (archive: true) and `pages/posts.md`, `homepage: about` and `postsPage: posts` in `site.json`, the listing tests moved to `/posts/`, and matching rules in the demo stylesheet.
7. Docs: the theme README's front-page table, a front-page layout section, `archive: true` beside `contact: true`, the `month` date format; grep `front-page` in the package and root READMEs.
8. Verify: pnpm build, test, typecheck, lint, format:check, test:11ty, and curl the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**The front page now ships.** `packages/cms/themes/default/layouts/front-page.njk` is a real layout rather than an override point: the page body in `div.page-body.e-content` with no title and no Published line, `<h2>Recent Posts</h2>` over `partials/post-list.njk` with `posts = recentPosts` and `feedHeading = 3`, `p.front-links`, then the rule and the bio, and the contact form after it for a homepage that asks for one. `OPTIONAL_TEMPLATES.frontPage` is unchanged in mechanism — the fallback to `layouts/page.njk` is now only reached by a theme that replaced the file with nothing, and `themeTemplate` still lets a site theme's own file win.

**`postsPage` is a new front-page context key**, `{ title, url }` for the page carrying the listing, resolved in `render.ts` from the setting and the published pages the renderer already holds. Absent when the site names none, so the link line is not drawn at all. No search link: a comment in the template names TASK-22.

**`archive: true` follows the `contact: true` pattern exactly.** New `packages/cms/src/web/archive.ts` holds the front matter key, `archiveOpen` and `archiveMonths(posts, timezone)`; `createRenderer` takes an `archivePosts` source and puts `archiveMonths` on the context only for a document that asked for it; `createCms` wires `store.listPosts()`. `partials/archive.njk` draws `section.archive` of `h2` + `ol.list-none`, included by `layouts/page.njk` after the `e-content`.

**The month is the CMS's answer, not the template's.** The grouping and the heading both go through the site's `timezone` (decision-11), so a post cannot be filed under one month and dated in another. That needed a month-name table, so the `date` filter gained a `month` format ("September 2026") and `docs/eleventy.config.example.js` mirrors it; `siteTimezone(site)` moved into `context.ts` beside the other site-data readers.

**The demo sets both Reading picks.** `homepage: about` and `postsPage: posts`, a new `pages/posts.md` carrying the listing and a new `pages/archive.md` with `archive: true`; both are in the menu. The demo's listing tests moved to `/posts/`, and the demo stylesheet — an all-or-nothing override — gained `.front-links` and `.archive` rules.

**Two test changes that were not mechanical.** `front-page.test.ts`'s fallback assertion is now "the packaged front page renders it", and its override test had to be split in two: the theme file can no longer be written mid-run, because with template caching on (watch off) the first render of `layouts/front-page.njk` compiles the packaged file and caches it under that name, where before the two renders used two different names. The demo's Eleventy test now compares against where the CMS *serves* a document rather than its permalink, the way `packages/cms/test/eleventy.test.ts` already did, because the example config builds the homepage at `/`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme ships a front page and gained an archive page, the two page kinds decision-16 turns into front matter and settings.

`layouts/front-page.njk` is now a packaged layout: the homepage's own words, then `Recent Posts` as an h-feed of h3 entries over `recentPosts`, then a line of links to the posts page when the site names one (search is TASK-22), then the bio with the site menu. A site theme's own `front-page.njk` still wins. A page whose front matter says `archive: true` gets `archiveMonths` on its context — every published post grouped by the calendar month of the site's timezone, newest first — and `partials/archive.njk`, included by `layouts/page.njk`, draws it as `h2` Month Year over `ol.list-none` links; drafts and future posts are absent and a page without the key is unchanged. Behind them: `web/archive.ts`, an `archivePosts` renderer source wired to `store.listPosts()`, a `postsPage` key on the front page context, a `month` format on the `date` filter mirrored in the Eleventy example config, and `siteTimezone` in `context.ts`.

The demo now sets both Reading picks — About at `/`, a new Posts page carrying the listing, a new Archive page — with matching rules in its stylesheet.

Verified with 15 new tests written failing first (`web/archive.test.ts` for the grouping, `web/page-kinds.test.ts` over HTTP against the packaged theme), the rewritten `front-page.test.ts` assertions, three new demo tests, and full `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` (1859 + 30 tests, 0 failures) and `pnpm test:11ty` (21, 0 failures), plus curls of `/`, `/archive/`, `/posts/`, `/posts/page/2/` and the `/about/` redirect against the booted demo.
<!-- SECTION:FINAL_SUMMARY:END -->
