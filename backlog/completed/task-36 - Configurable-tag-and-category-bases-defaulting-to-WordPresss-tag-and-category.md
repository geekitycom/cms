---
id: TASK-36
title: >-
  Configurable tag and category bases, defaulting to WordPress's /tag/ and
  /category/
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:31'
updated_date: '2026-09-04 02:25'
labels:
  - theme
  - admin
milestone: m-5
dependencies:
  - TASK-14
  - TASK-35
references:
  - backlog/docs/doc-5 - Admin-UI.md
  - 'https://andrewshell.org/category/general/'
type: feature
ordinal: 26500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tag archives live at `/tags/{tag}/` today and WordPress puts them at `/tag/{tag}/`, with categories at `/category/{slug}/`. Make both bases settings (`tagBase`, `categoryBase`) on the settings screen and in `site.json`, validated as one URL-safe path segment, defaulting to `tag` and `category` so a WordPress site keeps its URLs without touching anything. Every place that builds or parses a taxonomy URL reads the setting: the public routes and their canonical trailing-slash redirects, `tagHref` and its category twin, the theme templates, the editor links, the feed hrefs and the Article Hashtag hrefs. Since there are no production deployments, the old `/tags/` default is simply replaced; no redirect from it. The two bases may not be equal to each other, to `page`, or to a reserved top-level path such as `feed`, `admin` or `ap`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With no setting the tag archive answers at /tag/{tag}/ and the category archive at /category/{slug}/, and /tags/{tag}/ is a 404
- [x] #2 Changing either base on the settings screen moves the archive, its paging and its feeds to the new base on the next request, and every link the theme, the editor and the feeds render follows
- [x] #3 The bases are mirrored to site.json and read back from it on seed; an old site.json without them gets the defaults
- [x] #4 A base that is empty, contains a slash, equals the other base, or names a reserved path is refused with a message and the previous value kept
- [x] #5 The Article's Hashtag hrefs and the outbox point at the current bases
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module `src/web/taxonomy.ts` holds the whole taxonomy-URL vocabulary, moved out of routes.ts: `Taxonomy`, `TAXONOMIES`, `TaxonomyTerm`, a `TaxonomyBases = Readonly<Record<Taxonomy,string>>`, `DEFAULT_TAXONOMY_BASES = { tag: 'tag', category: 'category' }` (WordPress's, replacing today's `/tags/`), `termHref`/`tagHref`/`categoryHref` which now take the bases as a required argument, `taxonomyForSegment(segment, bases)`, and the validator. `TAG_SEGMENT` and `CATEGORY_SEGMENT` go: a fixed segment constant is a lie once the base is a setting. Breaking, and 0.x.
2. Validation: `TAXONOMY_BASE_PATTERN` (one URL-safe segment: a letter or digit then letters, digits, dashes and underscores, 1-64) plus `RESERVED_TOP_LEVEL_PATHS` (`page`, `feed`, `admin`, `ap`, `theme`, `uploads`, `nodeinfo`), and `taxonomyBaseProblems({tag,category})` returning one message per bad base including 'the two may not be the same'. A test pins the reserved list against the real prefixes (PAGE_SEGMENT, ADMIN_PREFIX, FEDERATION_PREFIX, THEME_ASSET_PREFIX, UPLOAD_ASSET_PREFIX) so it cannot drift.
3. Settings: `tagBase` and `categoryBase` join `SiteSettings`, `DEFAULT_SITE_SETTINGS`, `SETTINGS_FIELDS` (`tag_base`, `category_base`), `readSiteSettings`, `writeSiteSettings`, `settingsProblems`, `settingsFromForm`, `formFromSettings`, `settingsSiteData`, `siteJsonFor` and `seedSiteSettings`, plus two fields on admin/layouts/settings.njk. A bad base is a 400 that re-renders and writes neither SQLite nor site.json, exactly as the other fields.
4. Site data: `SiteData.tagBase`/`categoryBase`, defaulted in `createSiteDataSource` so a theme may always read them, and `taxonomyBases(site)` in context.ts alongside `postsPerPage` (falls back to the default for a missing or invalid value). `Renderer.taxonomyBases()` exposes it to the routes.
5. Routes: the archive and tag-feed routes stop being registered paths - a route table is fixed at boot and the base is not - and move into the not-found resolution, which already resolves documents there and already parses listing paths. `resolveDocument` becomes: taxonomy feed, taxonomy archive (trailing slash only, and only once the term has something published, so a missing archive still costs one 404 rather than a redirect and a 404), then the document, the representation escape hatches, the canonical redirect and the theme's 404. `/{base}/x/page/1/` collapses to the archive root by comparing the parsed request with `termHref`, which is what the old route's explicit redirect did. Admin and federation routes still win because they are real routes and this is the not-found handler.
6. Federation: `postArticle` reads the bases from `readSiteSettings(context.data.admin)` so the Hashtag hrefs and the outbox follow the setting.
7. Theme: `partials/tags.njk` and `layouts/tag.njk` build their hrefs from `site.tagBase`/`site.categoryBase` instead of literals, which works both under the CMS and under an Eleventy build reading the mirrored site.json.
8. Eleventy: the example config's category archive permalink and test/fixtures/content/categories.njk read `site.categoryBase`; `test/eleventy.test.ts` keeps comparing against `categoryHref` with the default bases.
9. Docs: README route tables, packages/cms/README.md (routes, feeds, negotiation), the theme README and the init template's hello-world post move to /tag/, and the settings section gains the two bases.
10. Red-green throughout with node:test through `app.request`: the default bases, /tags/ now a 404, a changed base moving the archive, its paging, its feeds, its links and the Article hashtags, the site.json mirror and the seed, and each refusal in AC #4. Then pnpm build/test/test:11ty/typecheck/lint/format:check and a live curl pass against the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

The two archive bases are settings, defaulting to WordPress's `tag` and `category`, and every place that builds or parses a taxonomy URL now reads them.

- **`packages/cms/src/web/taxonomy.ts`** is new and holds the whole vocabulary, moved out of `routes.ts`: `Taxonomy`, `TAXONOMIES`, `TaxonomyTerm`, `TaxonomyBases` (`Readonly<Record<Taxonomy, string>>`), `DEFAULT_TAXONOMY_BASES`, `PAGE_SEGMENT`, `TAXONOMY_BASE_PATTERN`, `RESERVED_TOP_LEVEL_PATHS`, `termHref`/`tagHref`/`categoryHref`, `taxonomyForSegment`, `taxonomyBaseProblems` and `taxonomyBasesOrDefault`. The three href builders take the bases as a **required** argument, so the compiler names every call site rather than letting one quietly keep the default.
- **Settings** (`src/admin/settings.ts`): `tagBase` and `categoryBase` join `SiteSettings`, the defaults, `SETTINGS_FIELDS` (`tag_base`, `category_base`), the reader, the writer, the validator, `settingsSiteData`, `siteJsonFor` and `seedSiteSettings`; `taxonomyBasesFromSettings` is the accessor federation uses. An Archives section on `admin/layouts/settings.njk` holds the two fields with their per-field errors. A bad base is a 400 that re-renders and writes neither SQLite nor `site.json`, exactly as the other fields.
- **Site data** (`src/web/context.ts`): `SiteData.tagBase`/`categoryBase`, filled in among the defaults so a theme may always read them, and `taxonomyBases(site)` beside `postsPerPage`. `Renderer.taxonomyBases()` hands them to the routes, read per request.
- **Routes** (`src/web/routes.ts`): the archive and tag-feed routes are no longer registered paths. A route table is fixed when the app is built and the bases are not, so they are resolved in the not-found handler — which already resolved documents and already parsed listing paths — ahead of the document lookup, from the bases the site holds at that moment. `parseTaxonomyFeedPath` and `taxonomyArchive` are the two new steps; `parseListingPath`, `canonicalPath`, `canonicalTarget`, `listingHref`, `listing`, `feed` and `feedHref` all take the bases.
- **Federation** (`src/federation/article.ts`): `postArticle` reads the bases from `readSiteSettings(context.data.admin)`, so the `Hashtag` hrefs and the outbox follow the setting.
- **Theme**: `partials/tags.njk` and `layouts/tag.njk` build their hrefs from `site.tagBase`/`site.categoryBase`.
- **Eleventy**: the example config's category permalink and `test/fixtures/content/categories.njk` use `{{ site.categoryBase or 'category' }}`, which works both under the CMS's mirror and under an old `site.json` that has no such key.
- **Docs**: both READMEs, the theme README and the init template's hello-world post.

## Decisions

- **The old `/tags/` base is simply gone, with no redirect**, as the task says: there are no production deployments, and a permanent redirect from a URL nobody published would be a permanent cost. `/tags/x/` is a 404.
- **The archives left the route table.** This is the load-bearing change. Hono's routes are registered once in `mountPublicSite`, so a base held in SQLite could not have decided one; the alternatives were a `/:base/:term/` route that falls through (which would have had to be ordered against the admin's and the federation's own routes) or re-registering the app on every save. Resolving them in `app.notFound` is neither: admin and federation routes still win because they are real routes, and the archive still wins over a permalink that collides with it because it is checked first inside that handler. `/{base}/x/page/1/` collapses onto the archive root by comparing the parsed request with `termHref`, which is what the old route's explicit redirect did, and an archive nothing carries still 404s rather than redirecting first.
- **The bases are required arguments, not defaulted ones.** `termHref(term, index, bases)` would have been friendlier with a default, and would also have let a forgotten call site keep serving `/tag/` on a site that had moved it. The type error is the point.
- **The theme reads the bases off `site`, not off a Nunjucks global.** A global would not exist in an Eleventy build of the same content; `site.tagBase` does, because the settings screen mirrors both keys into `content/_data/site.json` beside `title` and `postsPerPage`. The cost is that `partials/tags.njk` has to be imported `with context` — a macro import without it cannot see `site` — so the packaged theme, the demo's override and the theme README all say `{% import "partials/tags.njk" as taxonomy with context %}`. The macros keep an `or "tag"` fallback so a third-party theme that imports without the context degrades to the default rather than to `/undefined/`.
- **A base that could not work falls back rather than taking the archives down.** `taxonomyBasesOrDefault` is only for reading a value back out of storage or a hand-edited `site.json`; a value on its way in through the form goes through `taxonomyBaseProblems` and is refused. Two bases that collide fall back as a pair, because serving one of them and not the other would be worse than serving neither.
- **`feed` is reserved before anything serves it.** TASK-37 puts the WordPress feed URLs at `/feed/`, and a site that had taken the word would find its archives shadowed by an upgrade. `taxonomy.test.ts` pins `RESERVED_TOP_LEVEL_PATHS` against `PAGE_SEGMENT`, `ADMIN_PREFIX`, `FEDERATION_PREFIX`, `THEME_ASSET_PREFIX` and `UPLOAD_ASSET_PREFIX`, so the list cannot fall behind the routes it is protecting.
- **Breaking API changes**, at 0.x: `TAG_SEGMENT` and `CATEGORY_SEGMENT` are gone (a fixed segment constant is a lie once the base is a setting; `DEFAULT_TAXONOMY_BASES` replaces both), and `termHref`, `tagHref`, `categoryHref` and `feedHref` each take one more argument. `Taxonomy`, `TaxonomyTerm`, `PAGE_SEGMENT` and the href builders now come from `web/taxonomy.ts` and are re-exported from both barrels.

## Verification

Package tests are written first and at the seams: `app.request` through the public site and the admin, the pure functions in `web/taxonomy.ts`, the `Article` and the outbox over Fedify, and the bytes of `content/_data/site.json` on disk. New tests: 10 in `src/web/taxonomy.test.ts`, 5 in `src/web/site.test.ts` (`the taxonomy bases`, plus `/tags/` being a 404), 4 in `src/admin/settings.test.ts` and 1 in `src/federation/article.test.ts`.

From the repository root: `pnpm build` clean; `pnpm test` 625 pass / 0 fail (`@geekity/cms`) and 11 pass / 0 fail (demo); `pnpm test:11ty` 9 pass and 5 pass; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean (`pnpm format` run once, for nine files).

Live demo server on port 3000, signed in as `ada`, over curl:

- **AC #1.** `/tag/theme/` and `/category/general/` 200; `/tags/theme/` 404. `/tag/theme` 301 to `/tag/theme/`, `/tag/theme/page/1/` 301 to `/tag/theme/`, `/category/nope/` 404, `/tag/theme/feed.xml` 200.
- **AC #2.** The settings screen showed an Archives section with `tag_base` and `category_base`. Saving `topics` and `filed-under` moved everything on the next request: `/topics/theme/` and `/filed-under/general/` 200 while `/tag/theme/` and `/category/general/` became 404; `/topics/theme/feed.xml` 200 and the archive's `<head>` advertising `/topics/theme/feed.xml` and `.json`; `/topics/theme/index.json` 200; the post page's links reading `/topics/content/`, `/filed-under/general/` and `/filed-under/engineering/`; and, at one post per page, `/filed-under/general/` linking `/filed-under/general/page/2/` which answered 200, with `/filed-under/general/page/1/` 301 back to the root.
- **AC #3.** `apps/demo/content/_data/site.json` gained `"tagBase": "topics"` and `"categoryBase": "filed-under"` on that save, keeping `feedSize` and every other key. A unit test proves the reverse: an old `site.json` carrying only `tagBase` seeds that one and defaults `categoryBase` to `category`.
- **AC #4.** An empty base, `a/b`, `admin`, `page`, `feed`, and the two set to the same word were each a 400 with a message under the field, and after every one of them the settings screen still read `topics` / `filed-under`.
- **AC #5.** `GET /ap/posts/markdown-on-disk` as `application/activity+json` came back with hashtag hrefs `http://localhost:3000/topics/content/`, `/filed-under/general/` and `/filed-under/engineering/`. The outbox is covered by the new `article.test.ts` case, which reads the first outbox page and finds the same moved archive URL in it.

The demo was then put back to `tag` / `category` at two posts per page, `apps/demo/content/_data/site.json` was restored to the state it was in before this task (`git diff` shows only the pre-existing `timezone` and `avatar` lines), and the dev server was stopped — `pgrep -fl "tsx watch"` reports nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the tag and category archive bases settings, defaulting to WordPress's `tag` and `category` so a site imported from it keeps every archive URL it published; the old `/tags/` base is replaced outright, with no redirect, because nothing is deployed on it.

A new `src/web/taxonomy.ts` holds the whole taxonomy-URL vocabulary — the bases, their validation, and `termHref`/`tagHref`/`categoryHref`, each of which now takes the bases as a required argument so the compiler names every call site. `tagBase` and `categoryBase` join `SiteSettings` and the settings screen, are mirrored into `content/_data/site.json` beside `title` and `postsPerPage`, and are seeded back from it, so an old file without them gets the defaults and an Eleventy build of the same content directory can put its archives at the same URLs. The theme reads them off `site` for that reason rather than through a Nunjucks global, which cost `partials/tags.njk` a `with context` on its import.

The load-bearing change is that the archives left the route table. A Hono route table is fixed when the app is built and the bases are not, so `/{base}/{term}/`, its paging, its canonical redirects and the tag feeds are resolved in the not-found handler — which already resolved documents and already parsed listing paths — ahead of the document lookup and from the bases the site holds at that moment. Admin and federation routes still win, because they are real routes. The federation's `Article` reads the bases from the settings, so its `Hashtag` hrefs and the outbox follow too. A base is one URL-safe path segment, may not be the other base, and may not take a path the site already answers on — `feed` included, before TASK-37 serves it — with a test pinning that reserved list against the prefixes the routes actually register.

Verified with 20 new node:test tests at the public-site, admin, federation and file seams, and a curl pass against the running demo covering all five criteria: the defaults answering and `/tags/` 404ing, a saved pair of bases moving the archives, their paging, their feeds, the JSON listing, every theme link and the ActivityStreams hashtags on the next request, the two keys appearing in the mirrored site.json, and six bad bases each refused 400 with the stored values untouched. `pnpm build`, `test` (625 + 11), `test:11ty` (9 + 5), `typecheck`, `lint` and `format:check` all pass; the demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
