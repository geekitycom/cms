---
id: TASK-81
title: >-
  Head: description, Open Graph and Twitter card tags, icons from the site
  avatar, and one JSON-LD graph from a partial
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 13:36'
updated_date: '2026-09-13 17:24'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-80
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/media
  - /Users/andrewshell/code/wordpress/asdo-theme/functions.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 106800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The source theme emits, in the head of every page, a meta description, Open Graph tags (title, description, url, type website or article, site_name, image), Twitter card tags (summary card with title, description, image), icon links and one JSON-LD graph (decision-16). Add the same to the default theme. The description is the page description or the entry summary (TASK-79), else the tagline. The image is the entry image when the front matter names one, else the site avatar. Icon links (icon at 32 and 16, apple-touch-icon at 180) come from the site avatar through the image variants the media module already derives (decision-10), and are omitted when the site has no avatar; a web manifest is not needed. JSON-LD lives in partials/jsonld.njk, included from the base head block, and prints one @graph: WebSite with the SearchAction only once search exists, Person from siteAuthor (name, url, image, description, jobTitle, address, sameAs from the links and the actor id), ProfilePage on an author archive, BlogPosting on a post and Article on a page with headline, url, mainEntityOfPage, datePublished, dateModified, description, image, author and publisher pointing at the Person. Nothing is printed for a Person when there is no siteAuthor. No Microdata anywhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every page has a meta description, og:title, og:description, og:url, og:type (article on a post or page, website elsewhere), og:site_name, og:image, twitter:card summary, twitter:title, twitter:description and twitter:image, with the description and image chosen by the rules in the description
- [x] #2 With a site avatar, the head links icon 32x32, icon 16x16 and apple-touch-icon 180x180 to derived variants that answer 200 as image/png; without one, no icon links are printed and nothing 404s
- [x] #3 partials/jsonld.njk prints one script of type application/ld+json whose @graph holds WebSite and Person on every page, adds ProfilePage on an author archive and BlogPosting or Article on a post or page, and validates as JSON; with no siteAuthor the Person and the author and publisher references are absent
- [x] #4 No itemscope, itemtype or itemprop attribute appears in any packaged template
- [x] #5 A site theme that ships its own partials/jsonld.njk replaces the graph, proven by a test; themes/default/README.md documents the partial and the meta rules
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Site icons in the images module (`src/images/icons.ts`): three square PNGs — 32, 16 and 180 — derived from an upload with sharp under the existing variant prefix as `icon-<size>.png`, cropped to an exact square with `fit: cover` because the responsive variants are width-only and never square. `findImageVariant` learns the icon filename so one is encoded on demand and then served from disk like every other derived file (decision-9: the directory stays disposable). `siteIcons(config, avatar)` answers the link descriptors — rel, sizes, href — and answers nothing when the site has no avatar, when the avatar is not an upload, or when image optimization is off, so the head never links something that 404s.
2. `icons` goes on every render's context in `web/render.ts`, beside `menu` and `siteAuthor`, so no template has to know the derived-URL scheme.
3. `layouts/base.njk`: the existing `<meta name="description">` follows the rule page description, else the entry `summary`, else `site.tagline`; the `head` block gains og:title, og:description, og:url, og:type (article on a rendered post or page, website elsewhere), og:site_name, og:image, the four twitter:* tags, the icon links and `{% include "partials/jsonld.njk" %}`. The image is the front matter's `image`, else `site.avatar`; with neither, the image tags are left out rather than printed empty.
4. `partials/jsonld.njk`: one `<script type="application/ld+json">` holding one \@graph — WebSite (publisher pointing at the Person), Person from `siteAuthor` with name, url, image, description, jobTitle, address and sameAs from the profile links and the actor id, ProfilePage on an author archive, BlogPosting on a post and Article on a page. Values are printed through `| dump` with `<` escaped as \u003C so nothing can close the script element, and optional members are printed by a macro that writes a leading comma, which keeps the JSON valid without a template-side JSON builder. The WebSite's SearchAction waits for TASK-22, with a comment saying so.
5. `themes/default/README.md`: the head beside The page shell — the description and image rules, the icon links, the `icons` context key and the jsonld partial as an override point.
6. Tests, all over HTTP in `src/web/page-shell.test.ts`: the meta and card tags on a post, a page, a listing and the 404 (AC #1); a real PNG avatar, the three icon links and a GET of each answering 200 as image/png, and a site without one linking none (AC #2); the graph parsed with JSON.parse on every page kind and with no siteAuthor (AC #3); no itemscope, itemtype or itemprop in any packaged template (AC #4); a site theme shipping its own `partials/jsonld.njk` replacing the graph (AC #5).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

**The head** (`themes/default/layouts/base.njk`). Five values are settled once at the top of the layout — `metaDescription`, `metaTitle`, `metaUrl`, `metaImage` and `isEntry` — and the `head` block prints the description, og:title/description/url/type/site_name/image, the four twitter:* tags, the icon links and `{% include "partials/jsonld.njk" %}`. The description is the page's own, else the entry's `summary`, else the tagline, and it is still printed once: the existing `<meta name="description">` now follows the rule rather than a second one being added. The image is the front matter's `image`, else `site.avatar`; with neither, og:image and twitter:image are left out rather than printed empty. `og:type` is `article` on a rendered post or page and `website` elsewhere — a listing is detected by `pagination`, so the posts page, which carries a page's front matter, is a website like every other listing.

**Icons** (`src/images/icons.ts`, new). The responsive variants are width-only and never square, and the default widths and formats hold neither 16/32/180 nor PNG, so `32.png` would have been a 404. The module derives the icons instead: three square PNGs cropped from the middle of the avatar with sharp's `fit: cover`, named `icon-32.png` and so on so they can never be mistaken for the width of that number, written into the same disposable derived directory and encoded on demand by `findImageVariant`. Nothing is added to any `srcset`. Enlarging is allowed here, unlike a width variant: 180 is what the touch icon has to be. `siteIcons(config, avatar)` answers `{ rel, sizes, href }` for each, and answers nothing when the site has no avatar, when the avatar is not an upload or not a file an icon can be made of, or when image optimization is off — so the head can never link a URL this server would 404.

`src/images/paths.ts` is new and small: `IMAGE_DIRECTORY`, `VARIANT_ASSET_PREFIX`, `ImageConfig`, `derivedDir` and `sourceFile` moved there so `variants.ts` and `icons.ts` can share them without importing each other. `variants.ts` re-exports the three public names, so nothing else in the package changed its imports.

**The context** gains `icons`, put on every render in `web/render.ts` beside `menu` and `siteAuthor`. A theme should not have to know the derived-URL scheme, and only this side knows whether the site can derive anything at all.

**The graph** (`themes/default/partials/jsonld.njk`, new). One `@graph`: WebSite always, Person from `siteAuthor`, ProfilePage on an author archive, BlogPosting on a post and Article on a page. Values go through `| dump` with `<` escaped to \\u003C, so nothing in a title or a summary can close the script element; each node opens with the never-optional `@type` and every later member carries a leading comma, and the nodes themselves are collected and joined, so the comma between two of them is never a question of which one happened to print. The WebSite's SearchAction is left out with a comment naming TASK-22.

## Decisions worth knowing

- **The Person needs a profile.** `siteAuthor` with no `url` is a byline naming somebody with no account here: there is no id to anchor a Person to, so none is printed and the author and publisher references go with it. That is decision-16's rule — identity comes from user profiles — and it is the demo's case, whose `author` is `Joe Blog`.
- **An author archive is detected in the template** as a listing whose `author.url` is inside the URL being served. No new context key was invented for it.
- **The tags live inside the `head` block**, so a site theme that only wants to add one calls `{{ super() }}`, as an `alternates` override already does. Documented in the layout's own comment and in the README.
- One existing assertion changed: `src/contact/site.test.ts` asserted the contact page carries no `<script>` at all, meaning the form needs no JavaScript. Every page now carries the JSON-LD script, which is data rather than code, so the assertion now strips it and still refuses any script that runs.

## Verification

`pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass: 1758 package tests and 21 demo tests, 0 failures.

New tests, all over HTTP against the packaged theme, in `src/web/page-shell.test.ts`:

- **AC #1** — five tests: the description falls back page description → entry summary → tagline and is printed once; a post and a page are `article` and a listing and the 404 are `website`; og:title, og:url, og:site_name, the image and the four twitter tags; the entry's own `image` beats the site avatar; a site with neither prints no image tags and still cards as a summary.
- **AC #2** — the three icon links in order with their rels and sizes, each fetched over HTTP: 200, `content-type: image/png`, and sharp reading the returned bytes back as exactly 32x32, 16x16 and 180x180. A site with no avatar links none, and every root-relative link in its head answers something other than 404.
- **AC #3** — the graph is pulled out and run through `JSON.parse` on the front page, a page, a post, a tag archive and an author archive: WebSite and Person everywhere with the ids, sameAs and address; ProfilePage only on the archive; BlogPosting on a post and Article on a page with every member; with no siteAuthor, no Person and no author or publisher; and a site title holding `</script><script>alert(1)</script>` still parses as JSON and reads back verbatim.
- **AC #4** — a walk over every `.njk` under `themes/`, `admin/` and `templates/` asserting no `itemscope`, `itemtype` or `itemprop`.
- **AC #5** — a site theme shipping its own `partials/jsonld.njk` whose graph is what the page serves.

A mutation check confirmed the graph tests bite: deleting the `sameAs` member failed AC #3's first test.

Against the running demo (`tsx server.ts` on port 3111, stopped afterwards):

- `/`, `/about/` and a post serve a valid head with no icons and no image tags — the demo has no avatar and no user behind `Joe Blog` — and each graph was parsed with `node`'s `JSON.parse`: `WebSite` on the front page, `WebSite, Article` on the page, `WebSite, BlogPosting` on the post.
- With `avatar` temporarily added to the demo's `site.json` (reverted afterwards; the derived files land under the gitignored `data/`), `curl` of each icon URL answered 200 `image/png`, and the PNG headers read 32x32, 16x16 and 180x180. `icon-64.png`, a size the site does not offer, answered 404 and encoded nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme's head now carries what the source theme's did: a meta description (page description, else the entry summary, else the tagline), Open Graph and Twitter summary-card tags with the entry's image or the site avatar, icon links at 32, 16 and 180 pixels, and one JSON-LD @graph from the new `themes/default/partials/jsonld.njk` — WebSite and Person, plus ProfilePage on an author archive and BlogPosting or Article on an entry — all inside the base layout's `head` block. The icons are a new kind of derived image: `src/images/icons.ts` crops square PNGs from the site's avatar with sharp and `findImageVariant` encodes one the first time a browser asks, because the responsive variants are width-only and offer neither these sizes nor PNG; `siteIcons` answers nothing when there is no avatar to derive from, so the head links no icon rather than three 404s, and `src/images/paths.ts` now holds the paths both kinds of derived file share. The context gains `icons`. No Microdata anywhere. Verified with `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` (1758 + 21 tests, 0 failures), 15 new HTTP tests in `src/web/page-shell.test.ts` that parse the graph with JSON.parse and read the icon bytes back through sharp, and curl against the running demo, whose graphs parse and whose icon URLs answer 200 image/png at exactly 32x32, 16x16 and 180x180.
<!-- SECTION:FINAL_SUMMARY:END -->
