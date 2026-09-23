---
id: TASK-5
title: >-
  Public site: default Nunjucks theme with home, post, page, tag archive, and
  404
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 20:39'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-4
references:
  - backlog/decisions/decision-4 - Nunjucks-templates-for-theme-and-admin.md
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Render the public site from the index using Nunjucks (decision-4). Ship the default theme inside packages/cms/themes/default with a base layout, home listing with pagination, single post, single page, tag archive, and 404. Template lookup checks the site theme directory first and falls back to the package default file by file (decision-6). Template context for a document mirrors what an Eleventy layout receives (title, date, tags, content, page.url). Trailing-slash canonicalisation redirects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET / lists published posts newest first with pagination links at /page/2/
- [x] #2 GET on a post permalink renders title, date, tags, and body HTML through the theme
- [x] #3 GET on a page permalink renders the page template
- [x] #4 GET /tags/{tag}/ lists posts with that tag
- [x] #5 Drafts return 404 on the public site
- [x] #6 A request without a trailing slash redirects 301 to the canonical URL
- [x] #7 Theme static assets are served from /theme/ with cache headers
- [x] #8 A site theme/ directory containing only layouts/post.njk overrides the post template while every other template still comes from the package default
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add nunjucks + @types/nunjucks to packages/cms. Work test-first (tdd skill) with node:test through cms.app.request() against temp content/data dirs, watch: false, await cms.sync().
2. src/web/templates.ts: Nunjucks environment over a FileSystemLoader with two search paths — config.themeDir first, then the packaged themes/default resolved from import.meta.url so it works from dist/. A missing site theme dir is fine. Filters: date, url, absoluteUrl, htmlDate. noCache follows config.watch so theme edits show up in dev.
3. src/web/context.ts: the Eleventy-shaped template context. A document contributes title, date (Date), tags, content (html), page.url/date/fileSlug/inputPath, plus its front matter keys (description, author, draft, permalink and everything in extra). site comes from content/_data/site.json when present, merged over defaults from config, cached on mtime.
4. src/web/render.ts: a Renderer with renderDocument / renderListing / renderNotFound, built once per CMS. This is the single HTML entry point TASK-6 can call for the HTML representation.
5. src/web/assets.ts: /theme/* static serving. Site theme static/ first, then the package default. Path traversal rejected. Cache-Control, Last-Modified and ETag with 304 on If-None-Match.
6. src/web/routes.ts: mountPublicSite(app) registers GET /, GET /page/:n/, GET /tags/:tag/, GET /tags/:tag/page/:n/ and GET /theme/*. Document resolution and 404 live in app.notFound so admin and federation routes registered later still win. Documents are looked up with store.getByPermalink; drafts and trashed documents 404. A path with no trailing slash 301s when the canonical path resolves to a document or a listing.
7. packages/cms/themes/default: layouts/base.njk, home.njk, post.njk, page.njk, tag.njk, 404.njk; partials/post-list.njk and pagination.njk; static/style.css. Plain dependency-free HTML/CSS, no Tailwind. base.njk carries a block for alternate links so TASK-7 can add feeds. Replace the placeholder README with real documentation of the context and lookup order.
8. Replace the placeholder GET / and notFound handlers in src/index.ts with mountPublicSite; export the web types from the package entry point.
9. Add sample posts to apps/demo/content/posts plus posts.json so the demo renders a real listing.
10. Verify: pnpm test, pnpm typecheck, pnpm build, then pnpm dev and curl /, a post permalink, a page, /tags/x/, a no-trailing-slash URL, /theme/style.css, a draft (404). Confirm pnpm pack still ships the theme files.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What shipped

`packages/cms/src/web/` is the public site module:

- `templates.ts` — a Nunjucks environment over a `FileSystemLoader` with two search paths, `config.themeDir` then `PACKAGED_THEME_DIR`. The packaged theme is resolved from `import.meta.url` (`../../themes/default/`), which is the same relative position from `src/web/` and `dist/web/`, so it works from source under tsx and from an installed tarball. A missing site theme directory costs nothing: the loader just never finds anything there. Filters are `date`, `url` and `absoluteUrl`; `noCache` follows `config.watch`, so a template edit shows up in dev without a restart.
- `context.ts` — the Eleventy-shaped context and the `content/_data/site.json` source, cached on mtime and falling back to defaults when the file is missing or will not parse.
- `pagination.ts`, `render.ts` — `createRenderer({ config })` returns `renderDocument`, `renderListing`, `renderNotFound`, `render`, `site()` and `pageSize()`, none of which touch a request.
- `documents.ts` — `isPublicDocument` and `publicDocumentAt(store, permalink)`, the single lookup every representation shares.
- `assets.ts`, `routes.ts` — `/theme/*`, `/`, `/page/N/`, `/tags/{tag}/`, `/tags/{tag}/page/N/`.

`createCms` builds the renderer, puts it on the context as `c.var.renderer` alongside `store` and `config` (the env moved to `src/env.ts`), and calls `mountPublicSite(app)`. The placeholder `GET /` and `notFound` handlers are gone.

## Decisions worth recording

- **Documents resolve in `app.notFound`, not in a catch-all route.** A `app.get('*')` registered at construction time would shadow every admin and federation route added later. Resolving after the router has failed means a permalink can never collide with them, and TASK-6 extends the same handler.
- **Trailing-slash redirects only fire when the canonical URL resolves.** A missing address 404s in one request instead of bouncing first. The target is the canonical URL itself rather than the path with a slash appended, so `/page/1` lands on `/` in one hop.
- **Dates are formatted in UTC**, which is what an Eleventy starter using Luxon with `zone: 'utc'` does. The front matter keeps its offset; only the display is normalised.
- **`pagination.pageNumber` is zero-based**, as it is in Eleventy, so a ported layout does the same arithmetic.
- **A document context carries both `url` and `page.url`.** Eleventy collection items have `.url` and rendered pages have `page.url`; one shape serving both listings and pages needs both.
- **Path traversal is checked after `path.resolve`**, not by inspecting the request, so an encoded `..` cannot slip past.
- nunjucks names chokidar an optional peer and only uses it for `FileSystemLoader({ watch: true })`, which this never sets; `pnpm-workspace.yaml` records that so the workspace's chokidar 5 does not warn.

## Validation

- `pnpm test` — 190 tests, 190 pass, 0 fail (40 of them new, in `src/web/site.test.ts` and `src/web/render.test.ts`).
- `pnpm typecheck` — clean across both workspace projects.
- `pnpm build` — clean.
- `pnpm start` (demo, running the built `dist/`), then curl: `GET /` 200 with two posts newest first and `Page 1 of 2`; `/page/2/` 200 with the third; `/2026/09/the-theme-is-just-templates/` 200 with title, `<time datetime>`, tag links and rendered `<h2 id>`; `/about/` 200 through the page layout; `/tags/theme/` 200 listing one entry (the draft with the same tag excluded); `/about`, `/tags/theme` and `/2026/08/markdown-on-disk` all 301 to their trailing-slash form; `/theme/style.css` 200 with `cache-control: public, max-age=3600`, `etag` and `last-modified`, and 304 on a matching `If-None-Match`; `/theme/..%2F..%2Fpackage.json` 404; the draft permalink 404. Server stopped, port 3000 confirmed free with `lsof -nP -iTCP:3000`.
- `pnpm pack` — the tarball ships `themes/default/{README.md,layouts/*.njk,partials/*.njk,static/style.css}`, and `../../themes/default` from the packed `dist/web/templates.js` resolves to them.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the public site as `packages/cms/src/web/`: a Nunjucks environment whose loader searches the site's `themeDir` before the packaged theme file by file, an Eleventy-shaped template context (`title`, `date`, `tags`, `content`, `page.url`, the front matter, and `site` from `content/_data/site.json`), a request-free `Renderer`, `/theme/*` asset serving with cache validators and traversal refused, and routes for `/`, `/page/N/`, `/tags/{tag}/` and `/tags/{tag}/page/N/`. Documents resolve by permalink in `app.notFound` so later admin and federation routes still win; drafts and trashed documents 404; a path missing its trailing slash 301s only when the canonical URL resolves. Shipped the default theme in `packages/cms/themes/default` (base, home, post, page, tag, 404, three partials, plain CSS) with a README documenting the context, blocks and filters, replaced the placeholder handlers in `src/index.ts`, and gave the demo three posts, a draft and a `site.json`.

Verified with `pnpm test` (190 pass, 0 fail; 40 new tests across `src/web/site.test.ts` and `src/web/render.test.ts`), `pnpm typecheck`, `pnpm build`, and curl against the demo running the built `dist/`: home listing and `/page/2/`, a post, a page, `/tags/theme/`, three no-trailing-slash 301s, `/theme/style.css` with cache headers and a 304, a refused traversal, and a draft 404. `pnpm pack` confirms the theme files ship and resolve from the packed `dist/web/`.
<!-- SECTION:FINAL_SUMMARY:END -->
