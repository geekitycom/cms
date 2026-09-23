---
id: TASK-37
title: >-
  RSS 2.0 at /feed/, Atom at /feed/atom/, JSON Feed at /feed/json/, per-taxonomy
  feeds, WordPress ?feed= redirects
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-04 00:31'
updated_date: '2026-09-04 02:49'
labels:
  - web
milestone: m-5
dependencies:
  - TASK-7
  - TASK-35
  - TASK-36
references:
  - backlog/docs/doc-3 - Content-Negotiation.md
  - 'https://andrewshell.org/feed/'
  - 'https://www.rssboard.org/rss-specification'
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the `/feed.xml` and `/feed.json` routes with the WordPress layout that https://andrewshell.org/ serves, so subscribers of a migrated site keep working. `/feed/` is RSS 2.0, the format nearly every existing subscriber holds: channel `title`, `link`, `description` (tagline), `language`, `lastBuildDate`, `generator`, `atom:link rel="self"`, and an `image` from the avatar setting when one is set; each item carries `title`, `link`, `guid isPermaLink="false"` (the post's ActivityStreams object id, which is stable across renames), RFC 822 `pubDate`, `dc:creator` from the author setting, one `category` per category and per tag, `description` holding an excerpt (the `description` front matter, else the first paragraph of the rendered text, plain, truncated) and `content:encoded` holding the full HTML. `/feed/atom/` and `/feed/json/` serve what the two old routes serve now. Per-taxonomy feeds follow: `/{tagBase}/{tag}/feed/`, `/feed/atom/`, `/feed/json/` and the same under `/{categoryBase}/{slug}/`. The trailing-slash canonical redirect covers `/feed` and friends. WordPress's query forms redirect permanently the way the reference site does: `/?feed=rss2` and `/?feed=rss` to `/feed/`, `/?feed=atom` to `/feed/atom/`, and `/feed/rss/` to `/feed/`. A `language` setting (default `en`) feeds the channel and the Atom `xml:lang`; the feeds keep honouring `feedSize`. The base layout advertises all three with `rel="alternate"`, RSS first. There are no production deployments, so the old `/feed.xml` and `/feed.json` are dropped without redirects. Update doc-3's feeds section, the theme README and the package README.

Every RSS 2.0 feed also declares the `source` namespace (`xmlns:source="https://source.scripting.com/"`, which TASK-38 reuses for `source:cloud`) and each item carries `<source:markdown>` holding the post's Markdown body, the source of the item per the namespace: a reader that understands Markdown should render from it rather than from `content:encoded`. It is the same text the ActivityStreams Article exposes as `source`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /feed/ validates as RSS 2.0 with the channel and item elements listed in the description, full HTML in content:encoded and an excerpt in description; a validator such as the W3C feed validator or a strict parser accepts it
- [x] #2 /feed/atom/ and /feed/json/ serve exactly what /feed.xml and /feed.json served, and those two old paths are gone
- [x] #3 Per-tag and per-category feeds exist in all three formats under the configured bases, 404 for an unknown term
- [x] #4 /feed, /feed/atom and /feed/json redirect 301 to their slashed forms, and /?feed=rss2, /?feed=rss, /?feed=atom and /feed/rss/ redirect 301 to the matching new feed
- [x] #5 The HTML layout advertises RSS, Atom and JSON Feed with link rel=alternate, RSS first, and a post page keeps its ActivityStreams alternate
- [x] #6 Drafts and trashed posts never appear in any feed and feedSize still caps every feed
- [x] #7 Every RSS item carries source:markdown holding the post's Markdown body verbatim (CDATA or escaped), with the source namespace declared on the rss element
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `FeedFormat` widens to `rss | atom | json` in src/web/feeds.ts. `FEED_FILES` (feed.xml/feed.json) is replaced by the WordPress directory layout: `FEED_SEGMENT = 'feed'`, `FEED_SEGMENTS = { rss: '', atom: 'atom', json: 'json' }`, `FEED_ALIASES = { rss: 'rss' }` for the /feed/rss/ spelling WordPress also served, plus `feedPathUnder(root, format)` and its inverse `splitFeedPath(pathname)` returning { root, format, canonical } so a non-canonical spelling redirects rather than serving. `splitFeedPath` is deliberately general over any listing root, so TASK-39's per-post {permalink}feed/ reuses it. FEED_CONTENT_TYPES gains application/rss+xml.
2. `rssFeed(source)` joins atomFeed/jsonFeed: an `<rss version="2.0">` declaring the atom, content, dc and source namespaces; channel title, link, description (tagline), language, lastBuildDate, generator, atom:link rel=self, and an `<image>` built from the avatar setting when there is one; each item title, link, guid isPermaLink="false" (the post's ActivityStreams object id), RFC 822 pubDate (Date#toUTCString), dc:creator, one `<category>` per category and per tag, `<description>` holding an excerpt and `<content:encoded>` plus `<source:markdown>` in CDATA. New helpers: `rfc822(date)`, `cdata(text)` (splitting any ]]> run), and `feedExcerpt(document)` — the description front matter, else the first rendered paragraph stripped to text and cut at 55 words the way WordPress cuts an excerpt.
3. `activityStreamsId(document, baseUrl)` in src/web/documents.ts starts preferring the stored `activitypub.id`, exactly as federation's `articleObjectId` does, so the guid (and the page's ActivityStreams alternate) is stable across a rename. It is the one id helper the feeds may reach without a Fedify context.
4. A `language` setting joins SiteSettings, DEFAULT_SITE_SETTINGS ('en'), SETTINGS_FIELDS, the reader, the writer, settingsProblems (a BCP 47-shaped tag), settingsFromForm, formFromSettings, settingsSiteData, siteJsonFor, seedSiteSettings and the settings screen, and `SiteData.language`; base.njk already reads site.language. `feedLanguage(site)` in feeds.ts falls back to 'en'.
5. Routes: /feed/, /feed/atom/ and /feed/json/ become real routes (fixed paths, so the route table can hold them, and a real route means a careless Accept header and a document permalinked at /feed/ both lose). /feed.xml and /feed.json are dropped outright. `parseTaxonomyFeedPath` becomes `parseFeedPath` over both taxonomies via splitFeedPath, and resolveRequest serves the canonical spellings and 301s the others; `canonicalTarget` gains a feed branch so /feed, /feed/atom, /feed/rss and /tag/x/feed each land on their canonical URL in one hop, and a term nothing published carries still costs one 404. `feed()` takes a TaxonomyTerm rather than a tag string. `feedHref` follows.
6. WordPress's query forms: `queryFeedFormat(c)` maps ?feed=rss2|rss|atom|json and `listing()` 301s to the matching feed for whichever listing root the request named, so /?feed=rss2 and /tag/x/?feed=atom both work.
7. Theme: a `partials/feeds.njk` macro renders the three rel=alternate links, RSS first; base.njk uses it for the site feeds, and layouts/tag.njk and layouts/category.njk (which advertised none) use it for the term's. The post page keeps its ActivityStreams alternate.
8. Red-green in src/web/feeds.test.ts throughout, with the test-owned strict XML reader extended to accept CDATA sections so the RSS body is proved well formed rather than assumed: the channel and item elements, the excerpt, source:markdown, the avatar image, drafts and trash, feedSize, both taxonomies in all three formats, every redirect, and the alternates. Plus settings tests for `language`.
9. Docs: doc-3's Feeds section, the public-site route table and Feeds section of packages/cms/README.md, themes/default/README.md, and the root README where it lists site.json keys.
10. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check from the root, then the running demo over curl — every feed URL and every redirect in the acceptance criteria, xmllint --noout on all four XML feeds, and a strict re-parse of /feed/ proving the required channel and item elements.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

The feeds moved to WordPress's URL layout and gained RSS 2.0, so a site migrated off WordPress keeps every subscriber it had.

- **`src/web/feeds.ts`** — `FeedFormat` widens to `rss | atom | json`. `FEED_FILES` (feed.xml/feed.json) is gone; its replacement is the directory vocabulary: `FEED_SEGMENT` (`feed`), `FEED_SEGMENTS` (`{ rss: '', atom: 'atom', json: 'json' }` — RSS has no segment, so the bare `/feed/` is RSS), `FEED_ALIASES` (`rss` → RSS, WordPress's other spelling), `feedPathUnder(root, format)` and its inverse `splitFeedPath(pathname)` returning `{ root, format, canonical }`. New builder `rssFeed(source)` beside `atomFeed`/`jsonFeed`, plus `feedLanguage`, `feedExcerpt`, `rfc822`, `cdata`, `contentTypeOf` and `SOURCE_NAMESPACE`.
- **RSS shape.** `<rss version="2.0">` declaring the atom, content, dc and source namespaces on the root. Channel: `title`, `link`, `description` (the tagline, written empty rather than omitted because the spec requires it), `language`, `lastBuildDate`, `generator`, `atom:link rel="self"`, and an `<image>` from the avatar when the site has one. Item: `title`, `link`, `guid isPermaLink="false"`, RFC 822 `pubDate`, `dc:creator`, one `<category>` per category then per tag, `description` (the excerpt), `content:encoded` and `source:markdown`.
- **Routes** (`src/web/routes.ts`): the three site feeds are real routes (`/feed/`, `/feed/atom/`, `/feed/json/`); `/feed.xml` and `/feed.json` are gone with no redirect. `parseTaxonomyFeedPath` became `parseFeedPath`, which is over both taxonomies and returns the alias case too, so `resolveRequest` serves the canonical spelling and 301s the rest. `canonicalTarget` gained a feed branch, so `/feed`, `/feed/atom`, `/feed/rss` and `/tag/x/feed` each reach their canonical URL in one hop. `queryFeedFormat` plus a check at the top of `listing()` turns `?feed=rss2|rss|atom|json` into a 301 to whichever listing's feed the request named. `feed()` and `feedHref()` take a `TaxonomyTerm` rather than a tag string.
- **`language` setting**: `SiteSettings.language` (default `en`), `LANGUAGE_TAG_PATTERN`, the form field, the reader, the writer, the validator, `settingsSiteData`, `siteJsonFor`, `seedSiteSettings`, `SiteData.language` and a field on the settings screen. `base.njk` already read `site.language`; the RSS channel and the Atom `xml:lang` now do too.
- **`activityStreamsId`** (`src/web/documents.ts`) now prefers the stored `activitypub.id` over the one the slug implies, exactly as federation's `articleObjectId` does. That is what makes the `guid` stable across a rename, and the page's ActivityStreams alternate now agrees with the object the dispatcher answers under.
- **Theme**: new `partials/feeds.njk` with a `feedLinks(root, title)` macro writing the three `rel=alternate` links, RSS first. `base.njk` uses it for the site's; `tag.njk` and `category.njk` — which advertised none — use it for the archive's.

## Decisions

- **The site's three feeds are real routes; the archives' are not.** `/feed/` is a fixed path, so the route table can hold it, and a real route means neither a careless `Accept` header (doc-3) nor a document permalinked at `/feed/` can take the subscribers' URL. The taxonomy feeds hang off a base that is a setting, so they stay in the not-found handler with the archives (TASK-36).
- **`splitFeedPath` is deliberately ignorant of what the root is.** It takes any path ending in `/` and hands back the listing root and the format, leaving the caller to decide whether that root is something it serves. TASK-39's per-post `{permalink}feed/` is the same shape over a different root and needs no second parser.
- **A non-canonical spelling is data, not a special case.** `splitFeedPath` returns `canonical: false` for `/feed/rss/`, so one branch in `resolveRequest` covers every alias at every root: `/tag/x/feed/rss/` redirects for the same reason `/feed/rss/` does, without a second rule.
- **The `?feed=` redirect lives in `listing()`, not in a middleware.** A middleware registered by `mountPublicSite` runs after the admin's and federation's routes have already matched, so it would be both useless there and a trap later. Putting it at the top of `listing()` means it fires for exactly the URLs that have a feed — the home listing and both archives — and names the right one for each.
- **`guid` is the ActivityStreams object id, not the permalink.** That is the whole point of `isPermaLink="false"`: the id is minted from the slug and written into the front matter on the first delivery, so moving a post does not hand every subscriber the item a second time. Reaching it meant teaching `activityStreamsId` to prefer the stored id, which the theme's alternate link wanted anyway.
- **CDATA for `content:encoded` and `source:markdown`, escaping everywhere else.** WordPress's own shape, and a human reading the feed sees the Markdown as written. `cdata()` splits any `]]>` across two sections, and still drops the characters XML 1.0 cannot represent, because CDATA suspends escaping and not the character set.
- **The excerpt is WordPress's.** The `description` front matter when there is one, else the first rendered paragraph stripped to text and cut at 55 words — `the_excerpt`'s length. Tags are dropped rather than replaced by a space, because the markup inside a paragraph is inline; the words stay apart because of the whitespace the renderer already put between its block tags.
- **A language tag is checked for shape, not membership.** A well-formed tag this CMS has never heard of is harmless in `<html lang>`, `<language>` and `xml:lang`; refusing one because the package predates its registration would not be.
- **Breaking API changes**, at 0.x: `FEED_FILES` is gone (a file name is a lie once a feed is a directory), `FeedFormat` has a third member, and `feedHref` takes a `TaxonomyTerm | undefined` where it took a tag string. `/feed.xml` and `/feed.json` 404 with no redirect: nothing is deployed on them.

## Verification

Tests first and at the existing seams: `cms.app.request` through the public site and the admin, the bytes of `content/_data/site.json` on disk. The test-owned strict XML reader in `feeds.test.ts` gained CDATA support, so the RSS body is proved well formed rather than assumed. `src/web/feeds.test.ts` went from 19 cases to 32; `src/admin/settings.test.ts` gained 2 for the language setting.

Mutation-checked, each failing exactly the tests that name it: replacing the `guid` with the permalink, returning the whole text instead of an excerpt, disabling the `?feed=` redirect, and serving the alias spellings instead of redirecting them.

From the repository root: `pnpm build` clean; `pnpm test` 641 pass / 0 fail (`@geekity/cms`) and 11 pass / 0 fail (demo); `pnpm test:11ty` 9 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean.

Live demo on port 3000 over curl, signed in as `ada`:

- **AC #1.** `/feed/` 200 `application/rss+xml; charset=utf-8`. `xmllint --noout` clean. An independent strict parser (a throwaway Node script over `xml2js`, which is sax-based) accepted `/feed/`, `/tag/web/feed/` and `/category/general/feed/` and found every element the description lists: the channel's title/link/description/language/lastBuildDate/generator/image with its url, title and link, the `atom:link rel="self"` pointing at the feed's own URL, and per item title, link, `guid isPermaLink="false"`, a parseable `pubDate`, `dc:creator`, `description`, `content:encoded` holding markup and `source:markdown`, with all four namespaces declared on the root. The same script over a deliberately damaged copy reported the missing `<language>`, the flipped `isPermaLink` and the wrong namespace, so it is not vacuous.
- **AC #2.** `/feed/atom/` 200 `application/atom+xml` and `/feed/json/` 200 `application/feed+json`, both `xmllint`/JSON clean and carrying the same five posts; `/feed.xml` and `/feed.json` 404.
- **AC #3.** `/tag/web/feed/`, `/feed/atom/`, `/feed/json/` and the same three under `/category/general/` all 200 with the right self links and item sets; `/tag/nope/feed/` and `/category/nope/feed/` 404, and `/tag/eleventy/feed/` — a tag no published post carries — 404 in all three formats.
- **AC #4.** 301s, each in one hop: `/feed`→`/feed/`, `/feed/atom`→`/feed/atom/`, `/feed/json`→`/feed/json/`, `/feed/rss/`→`/feed/`, `/feed/rss`→`/feed/`, `/tag/web/feed`→`/tag/web/feed/`, `/tag/web/feed/rss/`→`/tag/web/feed/`, `/category/general/feed/json`→`/category/general/feed/json/`, `/?feed=rss2`→`/feed/`, `/?feed=rss`→`/feed/`, `/?feed=atom`→`/feed/atom/`, `/?feed=json`→`/feed/json/`, `/tag/web/?feed=rss2`→`/tag/web/feed/`, `/category/general/?feed=atom`→`/category/general/feed/atom/`. `/tag/nope/feed` is one 404 rather than a redirect and then a 404.
- **AC #5.** `/`, `/about/`, a post, `/tag/web/` and `/category/general/` each carry the three `rel=alternate` links in the order rss, atom, json; the two archives carry their own three after the site's; the post page still carries `<link rel="alternate" type="application/activity+json" href="http://localhost:3000/ap/posts/the-theme-is-just-templates">`.
- **AC #6.** The demo's draft appears in none of the three; `grep -c '<item>'` on `/feed/` matched the JSON feed's item count exactly. Setting `feedSize: 2` in the demo's `site.json` capped `/feed/`, `/feed/atom/`, `/feed/json/` and `/tag/web/feed/` at two on the next request. All five feeds carry an `ETag` and answer their own `If-None-Match` with 304, and six feed URLs produced six distinct ETags.
- **AC #7.** Every one of the five items in the live `/feed/` carries a `source:markdown`, holding the post's Markdown verbatim — fenced code blocks, backticks and em dashes intact — in a CDATA section, with `xmlns:source="https://source.scripting.com/"` on the `<rss>` element. A unit test proves a `]]>` in a body survives the CDATA split.

The `language` setting was exercised live: the settings screen showed the field, saving `en-GB` put `<html lang="en-GB">` on the page, `<language>en-GB</language>` in the RSS channel and `xml:lang="en-GB"` on the Atom feed on the next request, and mirrored `"language": "en-GB"` into `content/_data/site.json` while keeping `feedSize` and `avatar`; `not a language` was a 400 with the message under the field and `en-GB` still stored.

The demo was then put back — `language` returned to `en`, `feedSize` to 20, and `apps/demo/content/_data/site.json` restored so `git diff` shows only the pre-existing `timezone` and `avatar` lines — and the server stopped: `pgrep -fl "tsx watch"` and `lsof -nP -iTCP:3000` both report nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the feeds to WordPress's URL layout and added RSS 2.0, so the subscribers of a site migrated off WordPress keep working: `/feed/` is RSS 2.0, `/feed/atom/` and `/feed/json/` serve what `/feed.xml` and `/feed.json` served, and every tag and category archive has the same three under it. The old two paths are dropped outright — nothing is deployed on them — while WordPress's own older spellings redirect 301: `/feed/rss/` at any root, and `?feed=rss2|rss|atom|json` on any listing, plus the trailing-slash canonical redirect, each in a single hop.

The RSS channel carries title, link, description, a new `language` setting (default `en`, which also becomes the page's `lang` and the Atom feed's `xml:lang`), lastBuildDate, generator, an `atom:link rel="self"` and an `<image>` from the avatar; each item carries title, link, `guid isPermaLink="false"`, RFC 822 pubDate, dc:creator, one category per category and per tag, an excerpt as `description`, the whole post as `content:encoded` and the Markdown it was written from as `source:markdown` under Dave Winer's source namespace — the same text the ActivityStreams Article carries as its `source`, and the namespace TASK-38's `source:cloud` will reuse.

Two decisions carry the design. The URL vocabulary is one pair of functions, `feedPathUnder(root, format)` and `splitFeedPath(pathname)`, which are ignorant of what the root turns out to be — so the site's feeds, both archives' feeds and, later, a post's comments feed are the same shape over a different root, and a non-canonical spelling is a `canonical: false` flag rather than a special case per alias. And the `guid` is the post's ActivityStreams object id rather than its permalink, which is the whole point of `isPermaLink="false"`: `activityStreamsId` now prefers the id written into the front matter on the first delivery, so a renamed post is not handed to every subscriber a second time, and the page's ActivityStreams alternate agrees with the object the dispatcher answers under.

Verified by 15 new node:test cases (13 in `src/web/feeds.test.ts`, 2 in `src/admin/settings.test.ts`) whose strict test-owned XML reader gained CDATA support so the RSS body is proved well formed rather than assumed, four of them mutation-checked; and by a curl pass against the running demo covering all seven criteria — `xmllint --noout` on all four XML feeds, an independent sax-based parser accepting three RSS feeds and finding every required channel and item element (and reporting all three faults in a deliberately damaged copy), fourteen redirects landing where they should, the alternates in RSS-Atom-JSON order on five kinds of page with the post's ActivityStreams link intact, the draft in no feed, `feedSize` capping all three formats, and `source:markdown` on every item with the namespace on the root. `pnpm build`, `test` (641 + 11), `test:11ty` (9 + 5), `typecheck`, `lint` and `format:check` all pass; the demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
