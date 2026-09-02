---
id: TASK-3
title: SQLite content index with query API
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 19:48'
labels:
  - content
milestone: m-0
dependencies:
  - TASK-1
references:
  - >-
    backlog/decisions/decision-1 -
    Markdown-files-are-the-source-of-truth-SQLite-is-a-derived-index.md
type: feature
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the derived index described in decision-1. Schema: documents keyed by path with type, slug, permalink, title, date, updated, draft, description, author, tags (join table), front matter JSON, markdown, html, and hash. Migrations run on boot. Expose a small typed store: upsert, remove, getByPermalink, getBySlug, listPosts (published, paginated, newest first), listByTag, listAll for admin, and counts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Boot on an empty data dir creates the database and applies migrations idempotently
- [x] #2 upsert followed by getByPermalink returns the same Document fields
- [x] #3 listPosts excludes drafts and trashed documents and paginates with page size and offset
- [x] #4 listByTag returns posts carrying that tag ordered newest first
- [x] #5 Permalink lookups are indexed and unique; inserting a second document with the same permalink fails clearly
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add packages/cms/src/content/store.ts: a ContentStore over node:sqlite (DatabaseSync), opened with openContentStore({ dataDir }) against <dataDir>/geekity.db, creating the directory.
2. Schema via a versioned migrations table applied on boot inside a transaction, idempotent across reopens: documents(path primary key, type, slug, permalink, title, date, date_sort, updated, draft, trashed, description, author, activitypub JSON, extra JSON, body, html, hash) plus document_tags(path, tag, position) with ON DELETE CASCADE.
3. Sorting: date is stored verbatim as the ISO 8601 string the file carried; a derived date_sort column holds the same instant normalised to UTC (new Date(date).toISOString()) so offsets compare correctly. NULL date_sort sorts last under DESC; ties break on path DESC.
4. Trashed is derived from the path (any _trash segment), not from the Document, so Document rows round-trip exactly (optional fields absent, never undefined).
5. Unique index on permalink; a conflicting upsert is caught and rethrown naming both paths and the permalink.
6. API: upsert, upsertAll, remove, getByPath, getByPermalink, getBySlug, listPosts (published, not trashed, newest first, limit/offset), listByTag, listAll (admin filters), listPaths, counts, countByTag, close.
7. Write src/content/store.test.ts first (TDD, node:test, a fresh mkdtemp data dir per test) covering each acceptance criterion.
8. Wire the store into createCms: open on boot against config.dataDir, expose cms.store, set it on the Hono context (typed GeekityEnv) so later routes reach it, close it in close(). Point the existing createCms tests at temp data dirs.
9. Export store types from src/content/index.ts and src/index.ts; document the store in README.
10. Verify: pnpm test, pnpm typecheck, pnpm build, and boot apps/demo to confirm apps/demo/data/geekity.db appears.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/cms/src/content/store.ts on node:sqlite (DatabaseSync), no native addon needed. Node 24.18 emits no ExperimentalWarning for it, so no --no-warnings flag was added; the engines floor moved to >=22.5.0 (when node:sqlite landed) and the README says Node 22 prints one ExperimentalWarning while Node 24 does not.

Schema (migration 1): documents(path PK, type, slug, permalink, title, date, date_sort, updated, draft, trashed, description, author, activitypub JSON, extra JSON, body, html, hash), unique index on permalink, indexes on slug and (type, draft, trashed, date_sort DESC), plus document_tags(path, tag, position) with ON DELETE CASCADE and an index on tag. A migrations(version, applied_at) table records what has run, each migration inside its own transaction, so reopening applies nothing.

Decisions worth carrying forward:
- Dates: 'date' is stored verbatim (the offset the file wrote is content), and a derived date_sort column holds the same instant as UTC ISO. Listings ORDER BY date_sort DESC, path DESC. A missing or unreadable date stores NULL and therefore sorts last under DESC. Exported as dateSortKey().
- Trashed is derived from the path (any '_trash' segment) rather than from the Document, so Document rows round-trip byte-for-field and no new field was added to the TASK-2 type. Exported as isTrashedPath().
- Optional fields are rebuilt with conditional spreads, so date/updated/description/author/activitypub are absent (not undefined) when the column is NULL; a round-tripped Document deepEquals the parsed one.
- extra and activitypub are stored as JSON; anything JSON can hold survives, which means a YAML Date left in extra comes back as its ISO string.
- Duplicate permalinks throw DuplicatePermalinkError naming both paths and the permalink; upsertAll runs in a transaction so a conflict leaves the batch unapplied.

createCms now opens the store on boot against config.dataDir (mkdir -p), exposes it as cms.store, sets it plus the resolved config on the Hono context (app is Hono<GeekityEnv>, handlers read c.var.store / c.var.config), and closes it in close(). Because boot now touches disk, the existing createCms tests were pointed at mkdtemp data dirs and close their instances.

Validation (all from the repo root unless noted):
- pnpm test -> 115 tests, 115 pass, 0 fail (22 of them new in src/content/store.test.ts, 3 new in src/index.test.ts); exit code 0; no ExperimentalWarning in the output.
- pnpm typecheck -> tsc --noEmit clean for packages/cms and apps/demo.
- rm -rf packages/cms/dist && pnpm build -> clean, emits dist/content/store.js and store.d.ts.
- pnpm dev on an empty apps/demo/data, then curl 127.0.0.1:3000 -> 'GET / -> 200', and apps/demo/data/geekity.db (plus -wal/-shm) appears. Reading that file back shows tables documents, document_tags, migrations, indexes documents_permalink/documents_slug/documents_listing/document_tags_tag, and migrations = [{version:1,...}].
- AC1 is also covered by the 'migrations are idempotent' test (reopen twice, one recorded version, rows survive) and 'creates the database under a data dir that does not exist yet'.
- AC5 checks both halves: DuplicatePermalinkError with both paths, and EXPLAIN QUERY PLAN on a permalink lookup naming documents_permalink.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the derived SQLite content index (packages/cms/src/content/store.ts) on Node's built-in node:sqlite: a versioned, idempotent migration runner and a typed ContentStore with upsert/upsertAll, remove, getByPath/getByPermalink/getBySlug, listPosts, listByTag, listAll, listPaths, counts, countByTag, listTags and close. Rows round-trip to the TASK-2 Document exactly (optional fields absent, not undefined); dates are kept verbatim and sorted on a derived UTC date_sort column; documents under _trash/ are trashed by path and excluded from the public listings; permalinks are uniquely indexed and a collision throws DuplicatePermalinkError naming both paths. createCms opens the store against config.dataDir on boot, exposes it as cms.store and on the Hono context, and closes it in close(). Verified with pnpm test (115 pass, 25 new), pnpm typecheck, a clean pnpm build, and booting apps/demo (GET / -> 200, apps/demo/data/geekity.db created with the expected schema and one applied migration).
<!-- SECTION:FINAL_SUMMARY:END -->
