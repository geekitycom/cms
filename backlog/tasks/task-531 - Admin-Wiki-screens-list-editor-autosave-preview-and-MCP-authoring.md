---
id: TASK-531
title: 'Admin Wiki screens: list, editor, autosave, preview and MCP authoring'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T19:57:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-530
references:
  - decision-66
ordinal: 433800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: the operator writes wiki pages in the admin like posts and pages. /admin/posts and /admin/pages are both mountDocumentScreens with a different DocumentKind (src/admin/documents.ts); several admin paths still branch on post vs page with a ternary (editor-actions, autosave, preview, comments, media editUrl) and need a third case.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Wiki entry in the admin sidebar opens /admin/wiki: a list of wiki pages with drafts and trash, and new/edit screens using the wiki kind (title, slug, body; no date, tags, categories, reply or location fields)
- [x] #2 `/admin/wiki/new?slug=…&title=…` opens the editor with those filled in
- [x] #3 Autosave, preview, editor actions and links from the comments and media screens work for wiki pages
- [x] #4 The dashboard content counts include wiki pages
- [x] #5 The MCP authoring tools can create, read and update wiki pages; Micropub is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Lookups by type instead of post/page ternaries: isDocumentType in content/document.ts, DOCUMENT_KINDS in document-kind.ts, DOCUMENT_SCREENS/screensFor in admin/documents.ts (admin bar, comments, media, editor actions, autosave, preview and autosave store use them).
2. Mount WIKI_SCREENS in admin routes; add a Wiki section (All wiki pages, Add new) to the admin menu after Pages.
3. Editor: no permalink field for wiki (its URL is the base and slug), title required for page and wiki; new-editor route prefills title and slug from the query string.
4. Comments site-default label and unsaved-copy label name wiki pages.
5. Preview renders a wiki page through the wiki layout at its wiki permalink.
6. Dashboard: counts gain wiki (published listed wiki pages) and the At a glance row shows Wiki pages.
7. MCP: create_wiki_page, get_wiki_page, update_wiki_page tools (title/slug/body/draft, hash-checked update, publish scope to publish), registered in CORE_TOOLS and in docs/mcp.md; test that Micropub still refuses a wiki URL.
8. Tests first for each, then full verification (build, test, test:11ty, typecheck, lint, format:check) and a curl check of /admin/wiki on a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first. New tests: src/admin/wiki.test.ts (menu, list with drafts/trash, editor fields, save/edit/trash, ?slug&title prefill, autosave new + existing, preview through the wiki layout, comment and media edit links), editor-actions.test.ts (wiki draft handed to a plugin), dashboard.test.ts (Wiki pages count), MCP authoring.test.ts 'the wiki tools' (create/get/update, publish scope, stale hash, schemas, Micropub q=source still refuses a wiki URL with 'is not a post on this site').

Post/page ternaries replaced by lookups: isDocumentType + DOCUMENT_TYPES (content/document.ts), DOCUMENT_KINDS (document-kind.ts), DOCUMENT_SCREENS (admin/documents.ts, now also used by the admin bar), DOCUMENT_DIRECTORIES exported from content-tree.ts (preview path). The editor hides the Permalink field for wiki and requires a title for page and wiki. ContentCounts gains wiki (published, listed); the dashboard shows Wiki pages and its stat grid went to 4/7 columns. MCP gets create_wiki_page, get_wiki_page, update_wiki_page in src/mcp/authoring/wiki.ts, documented in docs/mcp.md; micropub/ untouched.

Verified: pnpm build, test (cms 7873 pass), test:11ty, typecheck, lint, format:check all exit 0. Live check on a scratch site at :3417: signed in, GET /admin/wiki 200 listing the page, /admin/wiki/new?slug=rain-barrel&title=Rain%20barrel prefilled, no permalink/date/tags fields, dashboard Wiki pages = 1, POST /admin/wiki/new 303 to /admin/wiki/rain-barrel and wiki/rain-barrel.md served at /wiki/rain-barrel/ 200, preview drew the wiki layout, the public admin bar's Edit Wiki page link now resolves. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Mounted the Wiki admin screens (/admin/wiki: list with drafts, trash and unsaved; new/edit editor with title, slug and body, no date, taxonomy, reply, location or permalink) and a Wiki menu section after Pages. /admin/wiki/new takes ?slug= and ?title= to prefill the form, ready for the create button on a missing wiki page. Autosave, preview, plugin editor actions, the autosave store and the comments and media edit links now look up the type in DOCUMENT_KINDS / DOCUMENT_SCREENS instead of post/page ternaries. Dashboard counts include published wiki pages. MCP gains create_wiki_page, get_wiki_page and update_wiki_page (hash-checked, publish scope to publish), documented in docs/mcp.md; Micropub is unchanged and still refuses a wiki URL. All suites, typecheck, lint and format pass; verified live with curl on a scratch site. Note for plugin authors: ContentCounts gains a wiki field.
<!-- SECTION:FINAL_SUMMARY:END -->
