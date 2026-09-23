---
id: TASK-104
title: 'The starter site links its About page, so a new site has a menu'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 11:54'
updated_date: '2026-09-20 15:27'
labels:
  - web
  - content
milestone: m-16
dependencies:
  - TASK-105
  - TASK-107
references:
  - packages/cms/templates/site/content/pages/about.md
  - packages/cms/templates/site/content/_data/site.json
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/init.ts
type: bug
ordinal: 129800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new site gets one page, About, and nothing links to it. `templates/site/content/pages/about.md` carries only `title` and `permalink`, and a page joins the menu only by setting `navigation: true` in its front matter or by being listed in `navigation` in `site.json` — so the page is served at /about/ and is reachable only by somebody who already knows it is there.

Found on a real install: the About page on a site seeded by the Docker image is invisible from the home page, and the reason took reading navigation.ts to work out.

It also means the menu itself never appears. The default theme draws `<nav class="site-nav">` only when there is something in it, so a new site shows no navigation at all, and somebody evaluating Geekity cannot tell whether it has menus.

The fix is one line of front matter in the starter About page. Worth doing on top: the page's own words are about where page files live, which is right for somebody reading the file on disk, and says nothing about the menu they are now in. A sentence saying how it got into the menu and how to take it out turns the starter page into the documentation of the feature it is demonstrating.

Check while there whether the starter post and site.json have the same shape of problem — something the starter ships that a new site cannot find.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A site seeded from the template draws a menu with About in it, proven by a test over a freshly seeded content directory
- [x] #2 geekity init and the serve-time seeding both produce it, since they share one template
- [x] #3 The About page says how it put itself in the menu and how to take it out
- [x] #4 Any other starter file that ships unreachable is named in the implementation notes, fixed or with a reason not to
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the starter template as shipped: About is already in `menus.primary` and RSS in `menus.footer` (TASK-105/107 landed). What is left is the `Search | /search/` line — a new site has no front page, so `/` renders layouts/home.njk, which carries no search form and no link to one, and the box lives only on /search/.
2. Red: extend packages/cms/src/seed.test.ts with a test that seeds the starter content, boots a CMS over it and reads the rendered '/', asserting the header nav links both /about/ and /search/, and that both URLs answer 200. Run it over the content 'geekity init' writes as well as the content serve-time seeding writes, so AC #2 is proved rather than inferred from the two sharing a template.
3. Green: add { label: 'Search', url: '/search/' } to menus.primary in packages/cms/templates/site/content/_data/site.json, and update the deepEqual in the existing 'types the About page into the primary menu and the feed into the footer' test to match.
4. Rewrite the body of packages/cms/templates/site/content/pages/about.md so the starter page documents the feature it is demonstrating: it is in the menu because a line in the Menu box on Settings > Reading (menus.primary in content/_data/site.json) names it, and deleting that line takes it out without touching the page. Assert in the seed test that the seeded page says so.
5. Crawl a real seeded site for anything else it ships that nothing links to: the hello-world post, its /tag/introductions/ archive, /feed/, /comments/feed/, /search/, /admin/, /sitemap.xml, /robots.txt. Name each in the implementation notes, fixed or with the reason not to.
6. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, and pnpm test:11ty.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Superseded in part by TASK-106, which removes the per-page navigation checkbox: the starter About page must be linked by typing a line into the navigation setting in the starter site.json, not by putting navigation: true in its front matter. The defaults the maintainer asked for on 2026-09-20 are Search and About in the menu and RSS in the footer, so the starter site.json carries navigation with About and Search, and footerLinks with RSS (TASK-105).

With TASK-107 in, the starter site's menus live in site.json under menus: primary holding About and Search, footer holding RSS. Not a navigation setting and not front matter.

## What was already in place

TASK-105 and TASK-107 had landed before this one started, so the starter `content/_data/site.json` already held `menus.primary = [About | /about/]` and `menus.footer = [RSS | /feed/]`, and the default theme already drew the primary menu in the header on every page and the footer menu in the footer. The About half of AC #1 was therefore already true on disk; what was missing was Search, and any proof over a rendered page.

## What changed

- `packages/cms/templates/site/content/_data/site.json`: `Search | /search/` added to `menus.primary`, after About. A new site has no front page, so `/` renders `layouts/home.njk`, which carries no search form and no link to one — `layouts/front-page.njk` is the only template with a standing Search link and it is used only when the Reading settings name a homepage. Without the menu line, `/search/` answers 200 and nothing on the site points at it.
- `packages/cms/templates/site/content/pages/about.md`: a paragraph between the two it had, saying that the link is in the menu because Settings > Reading has a Menu box with `About | /about/` in it, that deleting the line leaves the page served at /about/ and merely unlinked, and that the box writes `menus.primary` in `content/_data/site.json`. The page's other words are unchanged.
- `packages/cms/src/seed.test.ts`: a new `describe('the starter site, served')` with three tests that boot a real CMS over a starter content directory and read the markup — the menu links on `/` over a serve-time seeded directory, the same over the directory `geekity init` writes, and the About page's own words. The file now closes the CMS instances it started in its `after` hook.

## Existing test changed

`types the About page into the primary menu and the feed into the footer` in the same file: its `deepEqual` over `menus` gained the Search entry, which is the one assertion TASK-105's handoff said a primary line would have to touch. Its comment says why the line is there.

## AC #4: what else the starter ships, and whether a reader can find it

Crawled a real seeded site in process from `/`, following every same-origin `href`/`src`. Reached: `/`, `/about/`, `/search/`, `/2026/01/hello-world/`, `/tag/introductions/`, the three site feeds, the three tag feeds, the post's own comments feed, `/comments/feed/`, and the two theme assets. Nothing the starter ships as content is now unreachable.

Served but deliberately not linked, with the reason:

- `/admin/` and `/admin/login` — the editor. A link on every public page would advertise the login form to everybody who ever reads the site; `robots.txt` disallows `/admin/` for the same reason, and the README is where a new owner is told the URL. Left alone on purpose.
- `/sitemap.xml` and `/robots.txt` — machine-facing, and `robots.txt` names the sitemap, which is how a crawler is meant to find it. Nothing to link.
- `/2026/01/hello-world/index.json` and the `Accept: text/markdown` representation of the same URL (both 200) — the starter post's own words tell the reader to curl them, which is the right home for a representation that is not a page.
- `/comments/feed/` — reachable, but only as a `<link rel="alternate">`. That is how a feed reader finds it and a new site has no comments to read, so no visible link is wanted.
- `/author/…` — 404 on a new site, because the starter `author` is the string "You" and no account exists. No template renders a link to it, so the starter ships no dead link; a bio and its author archive appear once somebody creates an account.

## Verification

- `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`: all pass (2086 + 30 tests, 0 failures).
- `pnpm test:11ty`: 16 + 5 pass, 0 failures.
- A real `geekity serve` with `GEEKITY_SEED_CONTENT=true` in an empty directory on a free port: `/` renders `<nav class="site-nav" aria-label="Site">` with About and Search in it and the Footer nav with RSS, `/about/` renders the new paragraph, `/search/` answers 200. Server stopped afterwards.
- A real `geekity init`: the written `content/_data/site.json` and `content/pages/about.md` carry the same menu and the same words.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A new site now ships a menu that reaches everything it has. `menus.primary` in the starter `content/_data/site.json` gained `Search | /search/` beside the `About | /about/` TASK-105 put there — the search box lives only on /search/ and `/` is the post listing on a site with no front page, so without the line search was unreachable. The starter About page now says in its own words that the link is a line in the Menu box on Settings > Reading, that it writes `menus.primary` in site.json, and that deleting the line unlinks the page without removing it. Verified by booting a CMS over a freshly seeded content directory and over the directory `geekity init` writes and reading the rendered header menu out of the markup (three new tests in packages/cms/src/seed.test.ts), and by a real `geekity serve` with seeding on, whose `/` draws About and Search and whose /about/ carries the new paragraph. A crawl of the seeded site from `/` reaches every page, tag archive and feed it ships; /admin/, the sitemap, robots.txt, the post's JSON and Markdown representations and the site comments feed are unlinked on purpose, each with its reason in the notes. pnpm build, test, typecheck, lint, format:check and test:11ty all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
