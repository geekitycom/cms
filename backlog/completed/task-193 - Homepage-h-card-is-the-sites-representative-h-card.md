---
id: TASK-193
title: Homepage h-card is the site's representative h-card
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:01'
updated_date: '2026-10-02 06:56'
labels:
  - indieweb
  - microformats
  - theme
milestone: m-27
dependencies:
  - TASK-192
references:
  - packages/cms/themes/default/partials/bio.njk
  - packages/cms/themes/default/layouts/home.njk
  - packages/cms/themes/default/layouts/front-page.njk
  - 'https://microformats.org/wiki/representative-h-card-parsing'
priority: medium
type: bug
ordinal: 209800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a solo-author site the homepage shows the author's bio h-card, but its u-url is the author archive (/author/a/ on shll.me), not the homepage. The representative h-card algorithm picks the h-card whose u-url (and ideally u-uid) equals the page URL, or one whose u-url matches a rel=me link, so a parser reading https://shll.me/ may find no representative h-card. IndieAuth clients, IndieMark level 2 checks and reply-context fetchers on other sites read it to show who the site is. On the homepage of a solo-author site, give the bio h-card u-url and u-uid equal to the site URL, keeping the link to the author archive (rel=author) as a plain link or an extra u-url. Other pages keep today's markup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On a solo-author site the homepage's bio h-card has u-url and u-uid equal to the homepage URL, for both a listing homepage and a static front page
- [x] #2 A microformats2 parser run on the homepage with the representative h-card algorithm returns that h-card with name, url and photo
- [x] #3 The author archive link and rel=me links still appear, and other pages' h-cards are unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add microformats-parser as a devDependency of @geekity/cms for the test.
2. Tests in packages/cms/src/web/solo-author.test.ts: on a solo-author site's listing homepage and static front page, the bio h-card has u-url and u-uid equal to the homepage URL; a representative h-card helper (microformats.org/wiki/representative-h-card-parsing: uid+url match page URL, else url in rels.me, else lone h-card with url = page URL) over microformats-parser output returns that card with name, url and photo; the archive link and rel=me links remain; author archive, post and several-authors homepage cards carry no u-uid and keep the archive as their first url.
3. partials/bio.njk: a bioHome variable, when set, prints <data class="u-url u-uid" value="..."> as the card's first url; home.njk and front-page.njk set it to the absolute homepage URL only when soloAuthor. The name link keeps class u-url and rel=author me to the archive.
4. Document bioHome in bio.njk's header comment and the theme README.
5. pnpm build, test, typecheck, lint, format:check; curl a running dev site and run the parser over it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
partials/bio.njk takes bioHome: when set it prints <data class="u-url u-uid" value="{bioHome}"></data> inside the card's first paragraph, so the homepage is the card's uid and first url. layouts/home.njk (atRoot and soloAuthor) and layouts/front-page.njk (soloAuthor only) set it to "/" | absoluteUrl, the same value partials/jsonld.njk uses for home. The name link keeps class u-url and rel="author me" to the archive, so the archive is a second url; rel=me profile links unchanged. Without bioHome the rendered card is byte-for-byte what it was (the Nunjucks whitespace control moves, the output does not).
Before this change the homepage card was already found by rule 2 of the algorithm (its archive url is in rels.me since TASK-180); it is now found by rule 1 (uid and url equal the page URL), which is the one the task asks for.
microformats-parser ^2.0.6 added as a devDependency of @geekity/cms; the test implements the representative h-card algorithm over its output (all h-cards including nested, WHATWG URL matching).
Validation: pnpm build && pnpm test (3088 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Live check: a copy of the demo content with author "ada" served on port 3591 from packages/cms/dist; microformats-parser + the algorithm on curl'd http://localhost:3591/ picked Ada's card by rule 1 with name, url [home, archive, mastodon], uid [home], photo, for both the static front page (homepage: about) and the listing homepage; /author/ada/ and a post kept their cards with no uid and the archive as first url. Server stopped.

2026-10-02, 0.14.0 on shll.me: pin13.net/mf2 on https://shll.me/ returns the h-card with uid [https://shll.me/], url [https://shll.me/, https://shll.me/author/a/, https://me.dm/@andrewshell], name Andrew Shell and photo.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
On a solo-author site the homepage bio h-card now carries u-url and u-uid equal to the absolute homepage URL (a data element first in the card, set via a new bioHome variable in partials/bio.njk from home.njk and front-page.njk), so the representative h-card algorithm picks it by its first rule. The archive link and rel=me links stay; cards on other pages render unchanged. Verified with new tests in src/web/solo-author.test.ts that run microformats-parser plus the representative h-card algorithm, the full build/test/typecheck/lint/format suite, and the same parser over a live server's homepage in both homepage shapes.
<!-- SECTION:FINAL_SUMMARY:END -->
