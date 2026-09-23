---
id: TASK-105
title: >-
  The header carries the menu, the bio carries the person, the footer carries
  the site
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 12:05'
updated_date: '2026-09-20 15:18'
labels:
  - web
  - theme
milestone: m-16
dependencies:
  - TASK-107
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/partials/bio.njk
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/admin/settings-reading.ts
  - packages/cms/src/web/authors.ts
  - packages/cms/themes/default/README.md
type: feature
ordinal: 130800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three things sit around a page in the default theme — the menu, a person's profile links, and the site's own links — and each of them is currently in the wrong place, or in more than one place.

**The menu moves into the header, on every page.** Today it is inside the bio on an entry and an author archive, and in the footer everywhere else, so where a reader looks for it depends on what they are reading. It goes in `<header class="global-header">`:

- At the root, where the header is the site title as an `h1` and the tagline under it, the menu is a line of its own under the tagline.
- Everywhere else, where the header is the small `header-link-home` link, the menu sits beside it on the same line.

**The bio carries the person, and only the person.** `partials/bio.njk` stops printing the menu and keeps what it should have been about all along: the profile of whoever the page is by — their name, their note and their `rel="me"` links. It shows at the top of that person's author archive and under each of their posts, so a reader who has just read somebody finds that person's links right there.

**The footer carries the site.** The footer builds its list from `siteAuthor`, the one account Settings > General names as the author, so on a site with more than one user it prints somebody's personal links as the site's, and nobody else's appear at all. Add a **Footer links** box to Settings > Reading beside Navigation, the same `Label | /url` syntax, with a third field marking a link as `rel="me"`:

    RSS | /feed/
    GitHub | https://github.com/andrewshell | me
    Mastodon | https://shll.me/@a | me

The marker matters: `rel="me"` on a link back to a profile is what Mastodon reads to verify it, so a box that could not emit it would quietly break verification for anybody moving their links into it. RSS is a line like any other, so a site that does not want it drops it. The footer prints that box and nothing derived from any account, on every page.

**The search box leaves the footer.** Search becomes a line in the Navigation box (`Search | /search/`), which already works, so it is a menu item like any other. The search page keeps its own box at the top.

shll.me is the only live site, so none of this needs a fallback: the behaviour being replaced goes away rather than becoming a default. The starter site carries the lines a new site needs instead — RSS in Footer links, and the Navigation lines TASK-104 adds.

All of this is the packaged default theme, which a site theme may override, so the theme README's sections on the header, the bio, the menu, the footer and the search form have to match what the theme now does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The menu is in the global header on every page: under the tagline at the root, beside the home link everywhere else, proven by a test for each
- [x] #2 No page carries the menu twice, and no page carries it outside the header, proven by a test that counts it across a post, a listing, an author archive and a 404
- [x] #3 The bio prints the profile links of whoever the page is by, with rel="me", at the top of their author archive and under each of their posts, and carries no menu, proven by a test
- [x] #4 The footer prints menus.footer on every page and nothing derived from any account, proven by a test
- [x] #5 An empty or missing footer menu prints no list at all, and the footer keeps its copyright line, proven by a test
- [x] #6 No page but the search page carries a search form, proven by a test
- [x] #7 The theme README describes the header menu, what the bio prints, the footer menu and that the footer has no search form
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Red first, in the tests that own each claim:
   - `src/web/page-shell.test.ts`: rewrite `puts no navigation in the header` into a pair — the menu under the tagline at the root, beside `header-link-home` everywhere else; rewrite `moves the menu into the bio on a page that has one` into a count across a post, a listing, an author archive and a 404 (once, and inside `<header class="global-header">`); rewrite the footer describe so it asserts the copyright, the colophon, `menus.footer`, no `rel="me"` and no RSS from any account, and add the empty/missing footer menu case.
   - `src/web/entry.test.ts`: the `site menu` describe becomes "the menu is in the header, never in the bio or the page footer"; the bio describe gains the profile links under a post.
   - `src/web/search.test.ts`: `is in the footer of an ordinary page` becomes "only the search page has a form".
2. Green in the theme:
   - `layouts/base.njk`: print `nav.list(menus.primary, "Site")` inside `header.global-header` — under the tagline at the root, after the home link elsewhere. Strip from the `footer` block the `ul.hlist` of RSS + `siteAuthor.links`, the `search-form` include and the `{% if not bioAuthor %}` primary menu, leaving the copyright line and `menus.footer`. Drop the `bioAuthor` cross-file contract from the file's comment.
   - `partials/bio.njk`: stop importing and printing the menu; print the `p-note` and the `rel=\"me\"` links for every bio rather than only where `bioProfile` was set, and drop that switch. `layouts/author.njk` and `layouts/front-page.njk` lose their `bioProfile` / menu comments.
3. CSS, `themes/default/static/style.css`: a `.global-header .site-nav` rule — a line of its own under the tagline at the root; and, under `.global-wrapper:not([data-is-root-path='true'])`, a one-line flex header so the menu sits beside the home link. Retire `.bio .site-nav` from the rule it shares with `.bio-links`.
4. The starter site, `templates/site/content/_data/site.json`, gains `menus.footer` with the RSS line, since the footer no longer prints one of its own; the demo's `site.json` gains the same line so the demo still links its feed, and `apps/demo/test/site.test.ts` moves its RSS assertion onto the footer menu.
5. `themes/default/README.md`: the header, the bio, the footer, the search form and the `Where this theme prints them` section all say what the theme now does.
6. Verify: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`, `pnpm test:11ty`, and render the real pages of a running site to read the header, the bio and the footer on each kind of page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope settled on 2026-09-20: shll.me is the only live site, so there is no upgrade path to protect. The earlier plan kept today's footer — RSS plus the site author's profile links — whenever the Footer links box was empty, so that no existing site lost its footer by upgrading. That hedge is dropped. The footer prints the box and nothing else; empty means no list.

The behaviour it replaces is therefore going away rather than becoming a fallback, so the existing footer tests that assert RSS and the site author's rel="me" links in the footer are expected to change. That is the one place in this task where an existing assertion should be edited rather than preserved, and the notes should say which tests moved and why.

The starter site carries the links a new site needs instead: an RSS line in Footer links, and the Navigation lines TASK-104 is already adding.

Arrangement revised on 2026-09-20 before any code was written. The earlier plan put the menu in the header at the root only, leaving it in the bio on an entry and in the footer elsewhere — three places, which is what prompted the rethink. It is now in the header on every page, which also means the bio stops being two things at once: it carries the person, their note and their rel="me" links, and nothing about the site's navigation.

The result is one home for each kind of link. The header has the menu, the bio has the person whose page or post it is, the footer has the site's own links on every page.

The menu's items come from the navigation setting alone once TASK-106 lands; this task is the theme side and does not care where they come from. Default arrangement the maintainer asked for: Search in the menu, RSS in the footer, About in the menu.

Narrowed on 2026-09-20 to the theme side alone. The Footer links box this task was going to add to Settings > Reading is now TASK-107 and TASK-108: a menu is a named thing the site stores and the theme declares, so the footer renders menus.footer rather than a setting of its own. What stays here is where the theme puts things — the menu in the header, the person in the bio, the site's links in the footer, and no search form outside the search page.

## Built 2026-09-20

**What each page now holds.** The header is `menus.primary` on every page: at the root, under the `h1.main-heading` and the tagline, as a line of its own; everywhere else, after `a.header-link-home`, with the stylesheet laying `.global-wrapper:not([data-is-root-path='true']) .global-header` out as a wrapping flex row so the two share a line. The bio is the person — avatar, "Written by"/"Posts by" linked `rel="author me"`, job title, locality, `p-note` and `ul.hlist.bio-links` of `rel="me"` links — at the top of an author archive and under each of their posts and pages, and no menu. The footer is the copyright line and `menus.footer`, and nothing else.

**`bioProfile` is gone.** It gated the note and the links so that only an author archive printed them; the reason given was that the page footer already carried the site's identity links. It does not carry anybody's now, so the card is the same wherever it appears and the switch had nothing left to decide. `layouts/author.njk` no longer sets it. A site theme that set it is unaffected beyond getting the fuller card.

**Existing assertions that moved, and why.**
- `src/web/page-shell.test.ts`: `puts no navigation in the header` and `moves the menu into the bio on a page that has one` asserted the old two-place arrangement; they are replaced by three tests — the menu under the tagline at the root, the menu beside the link home elsewhere (with the stylesheet's flex rule read off disk, since the two placements are different layouts), and a count of one, inside the header, across the front page, a post, a page, a tag archive, an author archive and a 404.
- `src/web/page-shell.test.ts` footer describe: `prints the year, the site author, the colophon and an RSS link` loses the RSS assertion, and `lists the site author's links as rel="me" in an hlist` is replaced by `prints menus.footer on every page and nothing off an account`, which sets up a site author who does have profile links and proves none of them reach the footer. A new test covers the empty, missing and other-menu-only cases keeping the copyright and printing no list.
- `src/web/entry.test.ts`: the `site menu` describe asserted the menu in the bio on an entry and in the footer on a listing; it is one test now — in the header, in neither the bio nor the page footer, once — across both shapes. A new bio test proves the note and the `rel="me"` links are under a post.
- `src/web/author-archive.test.ts`: `heads the archive with the profile` asserted the link URL was somewhere on the page; it now asserts it inside the bio, `rel="me"`, with no menu in the card.
- `src/web/search.test.ts`: `is in the footer of an ordinary page, but only once on the search page` becomes `is on the search page and on no other page at all`, over a listing, a post, a page and a 404.
- `src/seed.test.ts`: the starter's `menus` is now `primary` plus a `footer` holding `RSS | /feed/`, since the footer prints no feed link of its own.
- `apps/demo/test/site.test.ts`: `degrades the footer for a site author no user answers to` becomes `links the footer out of menus.footer and off no account`; the demo's `site.json` gains the same RSS line so the demo still links its feed.

**Verified** with `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` (2083 + 30 tests, 0 failures) and `pnpm test:11ty` (16 + 5, 0 failures), and by booting two real sites over HTTP and reading the markup: a seeded starter site (`/`, `/about/`, `/author/you/`, `/search/?q=a`, `/nothing-here/`) and the demo's own content and theme (`/`, a post, `/posts/`, `/author/andrew/`). Every one of those pages carried exactly two navs — the header's `aria-label="Site"` and the footer's `aria-label="Footer"` — with the header one under the tagline at the root and after the home link elsewhere, and a search form only on `/search/`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme now has one home for each kind of link. `menus.primary` prints inside `header.global-header` on every page — a line of its own under the tagline at the root, beside `a.header-link-home` everywhere else, the second laid out by a flex rule on `.global-wrapper:not([data-is-root-path='true']) .global-header`. `partials/bio.njk` carries the person and only the person: it no longer prints the menu, and the `bioProfile` switch is gone so the note and the `rel="me"` links appear wherever the card does — at the top of somebody's archive and under each of their posts. The footer is the copyright line and `menus.footer`, having lost the `ul.hlist` of RSS plus `siteAuthor.links` (one nominated user's profile presented as the site's) and the search form; the starter and demo sites type `RSS | /feed/` into their footer menus instead, and `partials/search-form.njk` is included by `layouts/search.njk` alone. The theme README, the package README and the root README say what the theme now does. Verified with pnpm build, test (2083 + 30 pass), typecheck, lint, format:check and test:11ty (16 + 5 pass), and by booting a seeded starter site and the demo over HTTP and reading the header, bio and footer of the front page, a post, a page, a listing, an author archive, the search page and a 404.
<!-- SECTION:FINAL_SUMMARY:END -->
