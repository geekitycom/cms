---
id: TASK-534
title: Create button on a missing wiki page for signed-in writers
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T20:36:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-531
  - TASK-532
references:
  - decision-66
ordinal: 436800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: a [[link]] to a page that does not exist yet is how a wiki grows. Visitors get a 404; a signed-in writer who follows the link should be one click from writing the page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A request for `/<wiki_base>/<slug>/` with no published wiki page is a 404 for visitors, as today
- [x] #2 For a signed-in user who can write, the 404 offers "Create <title>" linking to `/admin/wiki/new` with the slug and a title made from it (dashes to spaces, first letter capitalised); a draft at that slug links to its editor instead
- [x] #3 The default theme 404 layout draws the button; the .md and .gmi 404s do not
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in packages/cms/src/web/wiki-create.test.ts: visitor 404 without the button (HTML, .md, .gmi); signed-in 404 at /wiki/<slug>/ offers 'Create <Title>' linking to /admin/wiki/new?slug=&title=, private no-store; trashed draft counts as missing; a draft at the slug is previewed with the bar's editor link and no Create button; signed-in .md/.gmi 404 carry no button; a 404 outside the wiki base or at a slug that does not slugify to itself carries no button.
2. site/admin-paths.ts: WIKI_ADMIN_PATH and newWikiPagePath(slug, title); WIKI_SCREENS.basePath uses it (web/ may not import admin/).
3. web: notFound(c, extra) and renderer.renderNotFound(url, extra); resolveRequest passes a createWikiPage {url, title} for a signed-in HTML request at /<wiki_base>/<slug>/ where nothing is.
4. themes/default/layouts/404.njk draws the button when createWikiPage is set; .md/.gmi layouts untouched.
5. Run build, test, test:11ty, typecheck, lint, format:check; curl a dev server signed in and out.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: src/web/wiki-create.ts (createWikiPageAt: the slug must slugify to itself; title = dashes to spaces, first letter capitalised), WIKI_ADMIN_PATH + newWikiPagePath in src/site/admin-paths.ts (web/ may not import admin/; WIKI_SCREENS.basePath now uses the constant), notFound(c, createWikiPage) and renderer.renderNotFound(url, extra) in web, resolveRequest passes it only when c.var.signedIn is set. The default 404.njk draws a .create-wiki-page button styled like the theme's other buttons; 404.md.njk and 404.gmi.njk are untouched and get no context for it.
Every signed-in user can write (users.ts: one role), so signed in is the test, as the admin bar uses. Cache: publicAdminBar already marks every signed-in HTML response private, no-store with no validators, and status pages are rendered per request (no page cache), so a visitor cannot be served the writer's 404.
Draft at the slug: a signed-in HTML request for a draft's URL already gets the draft preview, whose admin bar links to /admin/wiki/<slug> (Edit Wiki), so a writer never reaches a 404 there; the test pins that. A trashed draft is still a 404 and is offered as missing; a trashed published page stays a 410 as before.
Verified: pnpm build, test (cms 7909 pass), test:11ty, typecheck, lint, format:check all exit 0. Live on a scratch site at :3077: anonymous /wiki/potting-shed/ 404 with no button; signed in 404 with cache-control private, no-store and <a href="/admin/wiki/new?slug=potting-shed&amp;title=Potting+shed">Create Potting shed</a>; signed-in index.md and index.gmi 404 with no admin link; the link opens the editor with title Potting shed and slug potting-shed. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A 404 at /<wiki_base>/<slug>/ now offers a signed-in writer a 'Create <Title>' button to /admin/wiki/new?slug=…&title=…, the title made from the slug. Visitors get the same 404 as before; the Markdown and Gemini 404s carry no button. The button is drawn by the default theme's 404.njk from a createWikiPage context value, so other themes can draw it too. Signed-in HTML is already private, no-store, so no visitor can be served it. A draft at the slug is already previewed for a writer with the admin bar's editor link, so that case never reaches the 404. Tests: src/web/wiki-create.test.ts; full suite, 11ty, typecheck, lint and format pass; checked with curl signed in and out.
<!-- SECTION:FINAL_SUMMARY:END -->
