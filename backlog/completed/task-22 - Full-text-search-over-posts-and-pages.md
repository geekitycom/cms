---
id: TASK-22
title: Full-text search over posts and pages
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-19 14:31'
labels:
  - web
  - content
dependencies:
  - TASK-6
type: feature
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deferred past phase one. Add an SQLite FTS5 table maintained by the sync layer, a /search route that negotiates HTML and JSON, and a theme search form. Captured now so the index schema and sync events stay search-friendly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /search?q=term returns matching published posts and pages ranked by relevance
- [x] #2 The FTS index is rebuilt as part of the boot scan and updated on every sync event
- [x] #3 Drafts and trashed documents are never returned
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. content/search.ts: turn reader input into a safe FTS5 MATCH expression (bare words and quoted phrases, every term quoted so no FTS syntax leaks through) and derive the plain text a document is indexed by from its rendered HTML.
2. Content store migration 4: documents_fts FTS5 table (path unindexed, title, description, terms, body; porter unicode61 remove_diacritics). Empty documents so the next boot scan re-indexes every file (the established pattern for derived data SQL cannot compute).
3. Store writes keep it in step: writeOne replaces the document's FTS row, remove drops it. The sync writes only through the store, so the boot scan and every watch/admin/schedule event update the index. New store methods search(query, paging) and countSearch(query): bm25 with title weighted over description/terms over body, restricted to draft = 0, trashed = 0 and the due clause; each hit carries a highlighted snippet.
4. Web: GET /search/ (and /search redirecting to it, query kept) negotiating HTML and JSON via Accept, plus /search/index.json. ?q= and ?page=N paginate with the site page size; a page past the end 404s. JSON is an object with query, pagination and results (documentJson summary plus snippet). Renderer gains renderSearch; snippet markers become <mark> after HTML escaping.
5. Default theme: layouts/search.njk (noindex, form, results with snippets, pager), partials/search-form.njk in the footer and on the 404, styles, README and doc-3 notes.
6. Tests: query parser, store search (ranking, drafts/trash/scheduled excluded, updates and removals), route tests for HTML/JSON/406/pagination; then lint, typecheck, full test run.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions: the FTS table lives in the content store and is written/dropped inside the store's own upsert/remove, so every sync origin (scan, watch, admin, schedule) updates it with no new subscriber. Migration 4 empties documents (the pattern migrations 2 and 3 set) because body text comes from rendered HTML, which SQL cannot derive. Visibility is enforced by joining to documents with the draft/trashed/due clauses rather than indexing it, so drafting or trashing takes a post out of results with no second write. Reader input is quoted term-by-term (phrases and trailing * supported) so no query is an FTS5 syntax error. /search/ is a fixed route (shadows a document permalinked there); 'search' added to RESERVED_TOP_LEVEL_PATHS. JSON is an object {schema, query, pagination, results} rather than a listing's bare array. Filled the TASK-22 placeholders: 404 link, front-page link, JSON-LD SearchAction. doc-3 gains a Search section.
Validation: packages/cms src suite 1907 pass / 0 fail; test:11ty 16 pass; eslint clean; tsc (package + editor) clean; prettier --check clean; build ok. Smoke-tested apps/demo: existing DB migrated, /search/?q=markdown rendered ranked results with <mark> snippets and a pager, JSON via Accept returned the object shape.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added full-text search. An SQLite FTS5 table (migration 4) in the content store is written alongside every document row, so the boot scan fills it and every sync event keeps it current. GET /search/?q= negotiates HTML and JSON (also /search/index.json), ranks by BM25 with title > description/taxonomy > body, paginates with ?page=N, and only returns published, untrashed, already-due posts and pages. The default theme gains layouts/search.njk (noindex), a search-form partial in the footer, links from the 404 and front page, and a JSON-LD SearchAction. Verified with new tests in content/search.test.ts, store.test.ts, sync.test.ts and web/search.test.ts (full suite 1907/1907), lint, typecheck, build, and a smoke run of the demo site.
<!-- SECTION:FINAL_SUMMARY:END -->
