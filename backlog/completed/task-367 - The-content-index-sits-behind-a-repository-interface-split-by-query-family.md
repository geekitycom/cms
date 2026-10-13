---
id: TASK-367
title: 'The content index sits behind a repository interface, split by query family'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 11:31'
updated_date: '2026-10-12 13:32'
labels: []
milestone: m-36
dependencies:
  - TASK-365
references:
  - packages/cms/src/content/store.ts
priority: medium
type: chore
ordinal: 326800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
openContentStore in packages/cms/src/content/store.ts is one 736-line closure over node:sqlite that owns schema and migrations, document upsert and removal, about 40 query methods (listByTag, listByAuthor, listBacklinks, search and others) and tag-spelling logic. Every caller depends on that one concrete object, so it changes for many unrelated reasons and nothing can stand in for it. Give callers small interfaces named for what they read, and split the implementation so each query family lives in its own module.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Callers outside content/ depend on interface types, not on the return type of openContentStore
- [x] #2 Schema and migrations, writes, and each query family live in separate modules; no single function in the content index is longer than about 150 lines
- [x] #3 node:sqlite is imported only by the content index implementation modules and cache.ts within content-related code
- [x] #4 Existing tests pass unchanged in behaviour
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure which store methods each caller uses (TypeScript checker script over packages/cms/src); let the interface families come from that.
2. Tests first: add direct store tests for the query methods without one (listPinnedByAuthor, listRepliesTo, listReplyPosts, getByStoredObjectId, getBySlug newest-wins, now(), close twice) against the current implementation; see them pass.
3. content/store.ts becomes the contract: small interfaces named for what they read (IndexClock, DocumentLookup, ArchiveReader, TaxonomyReader, ReplyReader, BacklinkReader, SearchReader, CatalogReader, ScheduleReader, IndexWriter, IndexConnection) and ContentStore as their composition (still exported). TaxonomyName goes; Taxonomy from content/taxonomy.ts replaces it.
4. Implementation moves to content/sqlite/: schema (migrations), rows (row<->document, clauses, hydrate), spellings (tag spelling cache), writes, and one module per query family, as plain functions over one IndexDatabase handle; open.ts composes them into openContentStore. No function over ~150 lines.
5. Narrow every caller's parameter/deps type to the interfaces it uses (typecheck decides pass-through needs); only the composition root and the request context carry ContentStore.
6. Add a check that node:sqlite is imported in content/ only under content/sqlite/.
7. Prove the export list of index.ts/plugin.ts unchanged; verify pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured first with a TypeScript checker script (property accesses on ContentStore per file, non-test code): 24 files read now(), 13 getBySlug, 10 listAll, 7 getByPermalink; listBacklinks, search/countSearch, listTermUsage, listDueSince/nextDue, listByRepliesKey each had one caller file. The families come from that.

Tests added BEFORE the split, against the old implementation, all green on it (content/store.test.ts): now() answers the opened clock; close() twice is safe; getBySlug newest-wins across years; getByStoredObjectId whole-id match incl. query string, '' and unknown ids; listPinnedByAuthor order, exclusions (unpinned, pinned:false, draft, other author, not due) and the cap of five; listRepliesTo exact targets, unlisted included, draft/trash/page/not-due out, duplicates and no targets; listReplyPosts newest first and paging. Every other query already had direct tests there (listAll, listFederated, counts, tags/categories, term usage, spelling, neighbours, search, backlinks, /replies/ keys, schedule, clear, setReadOnly, migrations).

Contract: content/store.ts declares IndexClock {now}, DocumentLookup {getByPath, getByPermalink, getByStoredObjectId, getByFormerPermalink, getBySlug}, ArchiveReader {listPosts, listListed, neighbours, listByTag, listByCategory, listByAuthor, listPinnedByAuthor, countByTag, countByCategory, countByAuthor}, TaxonomyReader {listTags, listCategories, listTermUsage, tagSpelling}, ReplyReader {listRepliesTo, listReplyPosts, listByRepliesKey}, BacklinkReader {listBacklinks}, SearchReader {search, countSearch}, CatalogReader {listAll, listFederated, listPaths, counts}, ScheduleReader {nextDue, listDueSince}, IndexWriter {upsert, upsertAll, remove, clear}, IndexConnection {file, setReadOnly, close}. ContentStore extends all of them and stays exported. TaxonomyName removed; listTermUsage takes Taxonomy from content/taxonomy.ts.

Implementation: content/sqlite/ - database.ts (IndexDatabase handle: db, clock, baseUrl, spelling cache, prepared-statement cache; nowKey, statement, inTransaction), schema.ts (LEDGER, MIGRATIONS, unchanged), clauses.ts (served/listed/due/scheduled/pinned/federated clauses, term tables, paging), rows.ts (row<->document, /replies/ keys), spellings.ts (tag spelling cache), documents.ts (hydrate, select), writes.ts, lookups.ts, archive.ts, taxonomy.ts, replies.ts, backlinks.ts, search.ts, catalog.ts, schedule.ts, open.ts (openContentStore composes one builder per family). Plain functions taking the IndexDatabase; one shallow builder per family. The SQL text of every query is unchanged; fixed statements are prepared on first use instead of all at open.

CONTRACT changes (parameter/field types only, behaviour unchanged), each covered by:
- DocumentSite.store -> DocumentLookup & ArchiveReader & TaxonomyReader & IndexWriter & IndexClock: content/write.test.ts, admin/posts.test.ts, micropub tests.
- releasePermalink(IndexWriter), MoveSite.store (DocumentLookup & IndexWriter), save options (DocumentLookup [& IndexWriter]): content/write.test.ts, content/save.test.ts.
- CreateContentSyncOptions.store (DocumentLookup & CatalogReader & IndexWriter & IndexClock): content/sync.test.ts.
- CreateSchedulerOptions.store (ScheduleReader & IndexClock): content/schedule.test.ts.
- publicDocumentAt/previewDocumentAt/goneDocumentAt (DocumentLookup & IndexClock): web/*permalink*, admin/preview tests.
- GeekityEnv store -> every family but ScheduleReader and IndexConnection; SiteView.store (DocumentLookup & ArchiveReader & TaxonomyReader & CatalogReader & IndexClock): the web/ route tests.
- FederationContextData.store (DocumentLookup & ArchiveReader & CatalogReader & TaxonomyReader & IndexClock), delivery (that & IndexWriter), relays: federation/*.test.ts.
- comments/records (DocumentLookup), reply-notices, notifications, webmention service/syndication/reply-contexts, admin documents/federation/media/tools, micropub endpoint, web conversation/page-sources: their own test files.
- openContentStore now exported from content/sqlite/open.ts through content/index.ts (test imports updated); public name unchanged.

Check: content/store-boundary.test.ts (in pnpm test) fails when a content/ file outside content/sqlite/ imports node:sqlite, when anything but content/index.ts imports content/sqlite/, and when a file outside cms/, content/ and exports.ts names ContentStore. Proved by adding one violation of each (all three failed, naming the file), then reverting.

Longest function in the content index: before openContentStore at 736 lines; after taxonomyReader at 42 lines (content/sqlite/taxonomy.ts), then archiveReader 34, listAll 30 (TS AST script over content/store.ts and content/sqlite/*.ts).
Public API: export list of src/index.ts, src/plugin.ts, src/exports.ts identical before and after (2478 lines, 1275 for index+plugin, name and value/type kind).
docs/development.md Source layers: paragraph on the interfaces, content/sqlite/ and the check.
Validation from repo root: pnpm build, typecheck, lint, format:check exit 0; pnpm test exit 0 (cms 5736 pass = 5725 + 8 store tests + 3 boundary tests; demo 32; plugin-llm 48, post-summary 22, tag-suggest 31, wordpress 106; no failures).
micropub/endpoint.ts still builds its DocumentSite by hand; moving it onto c.var.siteRecords did not fall out of this work, left as is.

Correction to the coverage list above: publicDocumentAt/previewDocumentAt/goneDocumentAt have no unit test file of their own; they are covered through the routes by web/gone.test.ts, web/preview.test.ts, web/site.test.ts and federation/article.test.ts (410 for a trashed post).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The content index now sits behind small interfaces in content/store.ts, one per kind of question, measured from what callers read (IndexClock, DocumentLookup, ArchiveReader, TaxonomyReader, ReplyReader, BacklinkReader, SearchReader, CatalogReader, ScheduleReader, IndexWriter, IndexConnection); ContentStore is their composition and keeps its public export. Every caller outside content/ and cms/ names only the interfaces it uses, including the web request context, which no longer carries the connection or the scheduler reads. The 736-line openContentStore closure became content/sqlite/: schema, clauses, rows, spellings, hydration, writes and one module per query family, plain functions over one IndexDatabase handle; the longest function is now 42 lines. node:sqlite is imported in content/ only under content/sqlite/, and content/store-boundary.test.ts enforces that, the barrel-only access to the implementation and who may name ContentStore. Eight direct store tests were written first against the old implementation for the queries that lacked one. Public export names unchanged (diffed). Verified with pnpm build, typecheck, lint, format:check and test from the repo root (cms 5736, demo 32, plugins 48/22/31/106, all pass).
<!-- SECTION:FINAL_SUMMARY:END -->
