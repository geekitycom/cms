---
id: TASK-35
title: 'Categories: a second taxonomy alongside tags'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:31'
updated_date: '2026-09-04 02:05'
labels:
  - content
  - admin
  - theme
milestone: m-5
dependencies:
  - TASK-3
  - TASK-5
  - TASK-6
  - TASK-11
references:
  - backlog/docs/doc-2 - Content-Format-(11ty-compatible-Markdown).md
  - 'https://andrewshell.org/category/general/'
type: feature
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WordPress posts carry categories as well as tags, and https://andrewshell.org/ (the site this CMS is to replace) files every post under one or more categories with archives at `/category/{slug}/`. Add `categories` as a front-matter array on posts, parsed, indexed and written like `tags` (an Eleventy build sees it as an ordinary data key). The index gains a categories table and the store gains list-by-category, counts and paging exactly as tags have. The public site gains a category archive with the same paging as the tag archive, the theme a category layout (or one taxonomy layout for both), the editor a categories field next to tags, the JSON representation and the document context the new array, and the ActivityStreams Article a Hashtag per category the same way tags produce them. Category slugs derive from the name the way tag slugs do. Archive paths use the fixed `category` base in this task; the configurable bases arrive in the next one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post with categories in its front matter round-trips through parse, index and write unchanged, and a post without the key still works
- [x] #2 /category/{slug}/ lists that category's published posts newest first with paging and a 404 for an unknown category
- [x] #3 The post editor saves categories and shows them on reload; the posts list and the post page show them with links to the archive
- [x] #4 The .json representation, the document context and the Article's tags include categories
- [x] #5 Drafts and trashed posts never appear in a category archive
- [x] #6 The packaged Eleventy example config exposes a categories collection and test/eleventy.test.ts proves it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Content model: add `categories: string[]` to Document/DocumentContent and `categories` to KNOWN_FRONT_MATTER_KEYS (right after `tags`). Parser reads it with the same string-or-list coercion tags get; writer emits it after `tags` only when non-empty, so a file without the key hashes exactly as it does today. `documentContent` carries it through.
2. Index: migration 2 adds `document_categories` (path, category, position) mirroring `document_tags`, and clears `documents` so the next boot scan re-indexes every file (the hash is unchanged by this release, so nothing else would make an existing index learn its categories). Store gains `listByCategory`, `countByCategory`, `listCategories` (CategoryCount) and a `category` filter on `listAll`; hydration fills `categories`.
3. Public routes: `CATEGORY_SEGMENT = 'category'` and `categoryHref(category, index)` beside the tag pair; the listing request becomes a taxonomy term ({taxonomy, term}) so `/category/{slug}/`, `/category/{slug}/page/N/`, the canonical trailing-slash redirect, the `.json` listing escape hatch and the unknown-term 404 all mirror the tag archive. No category feeds: TASK-37 owns per-taxonomy feeds.
4. Theme: `layouts/category.njk` mirroring `layouts/tag.njk` (no feed alternates yet), a second macro in `partials/tags.njk` for category links, and categories shown on the post layout and in `partials/post-list.njk`. Renderer gains `Listing.category` and `TEMPLATES.category`; `documentContext` gains `categories`.
5. Admin: `DocumentKind.categorised` beside `tagged`; a Categories field in the editor next to Tags, carried through the conflict form and the preview; a Categories column in the posts list; `EditorForm.categories`, `blankForm`, `formFor`, `DocumentRow.categories`.
6. Federation: the Article's `tags` gain a Hashtag per category, built from `categoryHref` the way tag hashtags are built.
7. Eleventy: the example config exposes a `categories` collection (every category in use, sorted) and documents the archive template; the package fixtures gain that template so `test/eleventy.test.ts` proves Eleventy writes `/category/{slug}/index.html` at exactly the URL `categoryHref` computes.
8. Demo content gets categories on several posts and the demo post layout prints them; README (route table, theme section), the theme README and doc-2's front-matter table gain `categories`.
9. Red-green throughout: parser/writer, store, site routes, admin editor/list, article and eleventy tests first. Verify with pnpm build/test/typecheck/lint/format:check plus a live dev server curl of /category/{slug}/, its .json and an unknown category.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

`categories` is a second taxonomy modelled exactly as `tags` is, end to end.

- **Content model** (`packages/cms/src/content/document.ts`, `parser.ts`, `writer.ts`): `Document.categories`/`DocumentContent.categories` and `categories` in `KNOWN_FRONT_MATTER_KEYS`, between `tags` and `draft`. The parser's tag coercion became `asTerms` and reads both keys, so a single category written as a bare string is a one-element list the way Eleventy accepts one tag. The writer emits `categories` only when it is non-empty, so a file that has never had one hashes exactly as it did before this release — proved by a parser test that recomputes the pre-existing SHA-256 independently.
- **Index** (`content/store.ts`): migration 2 adds `document_categories` (path, category, position) mirroring `document_tags`. Because the hash of an uncategorised file is unchanged, a v1 index would have been left alone by the next sync and would never have learned any categories, so migration 2 also `DELETE FROM documents` — the files are the source of truth and `serve()` scans before the first request. `listByCategory`, `countByCategory`, `listCategories` (`CategoryCount`) and a `category` filter on `listAll`; `listByTag`/`listByCategory` and `countByTag`/`countByCategory` are now one private `selectByTerm`/`countByTerm` over two tables, so they cannot drift.
- **Public routes** (`web/routes.ts`): `CATEGORY_SEGMENT = 'category'` and a `TaxonomyTerm = { taxonomy, term }` shape. The archive routes are registered from one loop over both taxonomies, and `ListingRequest` carries a term rather than a tag, so the archive, its paging, the canonical trailing-slash redirect, the `.json` listing escape hatch, the unknown-term 404 and the past-the-end 404 are literally the same code for both. `termHref` is the only place an archive URL is spelled; `tagHref` and the new `categoryHref` are one-liners over it.
- **Theme**: `layouts/category.njk` (a mirror of `tag.njk`, with no feed alternates — per-taxonomy feeds are TASK-37's), a `categories` macro added to `partials/tags.njk`, and category links on the post layout and in `partials/post-list.njk`. `TEMPLATES.category` and `Listing.category` on the renderer, `categories` on `documentContext`.
- **Admin**: `DocumentKind.categorised` beside `tagged` (true for posts, false for pages), a Categories field in the editor next to Tags, carried through the conflict form and the preview, a Categories column in the posts list, and `EditorForm.categories`/`DocumentRow.categories`.
- **Federation** (`federation/article.ts`): the Article's `tags` are now the tag hashtags followed by one `Hashtag` per category, each pointing at its own archive.
- **Eleventy** (`docs/eleventy.config.example.js`): a `categories` collection holding `{ name, posts }` per category in use, sorted by name with each category's documents newest first, plus the documented pagination snippet that turns it into `/category/{name}/` archives. `test/fixtures/content/categories.njk` is that snippet, so `test/eleventy.test.ts` builds real archives with real Eleventy and compares every URL with `categoryHref`.

## Decisions

- **Category URL segments are the term itself, percent-encoded**, exactly as tag segments are ("category slugs derive from the name the way tag slugs do"). There is no separate slug field for either taxonomy.
- **No category feeds.** TASK-37 explicitly owns per-taxonomy feeds under both configurable bases, so adding them here would have been duplicate work in a shape TASK-36 is about to move.
- **`layouts/tag.njk` was left untouched** and `category.njk` added beside it rather than collapsing both into one taxonomy layout: `tag.njk` is part of the theme's semver contract and a site may already override it.
- **The `/category/` base is hard-coded in one constant** (`CATEGORY_SEGMENT`) reached only through `termHref`, which is what TASK-36 has to turn into a setting.

## Verification

Every command from the repository root:

- `pnpm build` — clean.
- `pnpm test` — 605 pass / 0 fail (`@geekity/cms`), 11 pass / 0 fail (demo).
- `pnpm test:11ty` — 9 pass / 0 fail (fixtures), 5 pass / 0 fail (demo).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — all clean (`pnpm format` was run once for two files).

Live demo server on port 3000, signed in as `ada`:

- `GET /category/engineering/` → 200, headed "Filed under “engineering”", listing only the posts filed there.
- `GET /category/engineering` → 301 to `/category/engineering/`.
- `GET /category/engineering/page/2/` → 200.
- `GET /category/nope/` → 404.
- `GET /category/engineering/index.json` → 200 `application/json`, each entry's `frontMatter.categories` present.
- `GET /2026/08/markdown-on-disk/index.json` → `frontMatter.categories: ["general","engineering"]`.
- `GET /admin/posts` → a Categories column beside Tags.
- Posting the editor for `markdown-on-disk` with `categories=general, engineering, housekeeping` → 303, the file gained the third category in canonical order, `/category/housekeeping/` answered 200, and the editor reloaded showing `general, engineering, housekeeping`. The demo post was then restored to its two intended categories and the watcher took `/category/housekeeping/` back to 404.

The dev server was stopped afterwards; `pgrep -fl "tsx watch"` reports nothing running.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `categories` as a second taxonomy alongside `tags`, modelled the same way end to end: front matter parsed and written (only when non-empty, so an uncategorised file's hash is unchanged), a `document_categories` table in migration 2 that also empties the index so an upgraded site re-reads its files, `listByCategory`/`countByCategory`/`listCategories` sharing one query helper with their tag twins, a `/category/{name}/` archive whose routes, paging, canonical redirect, JSON representation and 404s are the same code as the tag archive through a new `TaxonomyTerm` shape and `termHref`, a `layouts/category.njk` and a `categories` macro in the theme, a Categories field and column in the admin, a `Hashtag` per category on the ActivityStreams Article, and a `categories` collection in the packaged Eleventy example config. Verified with pnpm build/test/test:11ty/typecheck/lint/format:check (605+11 and 9+5 tests, all passing) and against a live demo server: the archive, its paging, its trailing-slash 301, its .json, an unknown category's 404, the document .json, the admin listing column, and an editor save that added a category, created its archive and reloaded showing it.
<!-- SECTION:FINAL_SUMMARY:END -->
