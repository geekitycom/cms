---
id: decision-56
title: How far an async content and admin store would reach
date: '2026-10-14 14:21'
status: proposed
---
## Context

decision-52 keeps an Aurora (Postgres) build possible and puts async stores last in its order of waves, behind a spike. `ContentStore` (packages/cms/src/content/store.ts) and `AdminStore` (packages/cms/src/store/admin-store.ts) are synchronous because `node:sqlite` is. Every Postgres driver is async, so a Postgres build would need both interfaces to return promises. TASK-385 is that spike. It measures how far the change reaches. Nothing was built, and no Postgres code was written.

The code was measured on branch `m39-async-stores-spike` at 9053eef1 on 2026-10-14. `packages/cms/src` holds 403 non-test files and 356 test files.

### What the stores are

- `ContentStore` joins nine reader and writer interfaces (`DocumentLookup`, `ArchiveReader`, `TaxonomyReader`, `ReplyReader`, `BacklinkReader`, `SearchReader`, `CatalogReader`, `ScheduleReader`, `IndexWriter`) with `IndexClock` and `IndexConnection`. It has 37 members that touch the database, 35 of them queries or writes and 2 of them lifecycle (`close`, `setReadOnly`).
- `AdminStore` joins ten stores: sessions, tokens, state, followers, profiles, inbox, comments, deliveries, webmentions and relays. It has 64 members that touch the database, 62 of them queries or writes and 2 lifecycle.
- `now()`, `file` and `onConversationWrite` are not database calls on any backend and were left out of every count.
- The SQLite implementations are 23 files and 4,731 lines in `content/sqlite/` and `store/`. A Postgres build writes new ones beside them. They are counted apart from the callers.
- Both stores are public. `exports.ts` exports the `ContentStore` type. `Cms.store`, `Cms.admin` and `GeekityEnv` (`c.var.store`, `c.var.admin`) expose both stores to anyone who embeds `createCms`. `testing.ts` exports `openAdminStore`.

### How it was measured

Three throwaway tools ran against the worktree. They are in `_local/async-stores-spike/`, which the global gitignore excludes, so they are not in the diff. Proposed task 2 below would keep the first one in the repository.

1. **The reach walk**, `reach.ts`. It loads `packages/cms/tsconfig.json` (src, test and scripts) into the TypeScript language service and takes every member of both store types. It finds every reference to each member with `findReferences`, then walks upward through the callers. A call inside an `async` function only needs an `await`, and the walk stops there. A call inside a sync function makes that function return a promise, so the walk follows that function's callers in turn. The walk follows named functions, object-literal members through the interface they implement, variables that alias a function, and callbacks passed to a function in this package, through the parameter that receives them. A callback passed to `map`, `filter` or another array method changes the function that calls the method. The walk stops at code outside the package (Hono, Fedify, `node:test`) and records whether that code accepts a promise. Values it cannot follow are reported, so the totals are a lower bound. In src the walk could not follow 16 values: 6 escape as values with no caller found, 5 are functions returned from other functions, 3 are listener arrays and 2 are destructured. A run takes about 8 seconds:

   ```sh
   node --stack-size=8000 _local/async-stores-spike/reach.ts packages/cms          # summary
   node --stack-size=8000 _local/async-stores-spike/reach.ts packages/cms --list   # every function and site
   ```

2. **The prototype flip**, `flip.ts`. It rewrites every store method signature in `content/store.ts` and the ten `store/*.ts` interfaces to return `Promise<…>`. Then `tsc --noEmit -p packages/cms/tsconfig.json` and `eslint` (with `recommendedTypeChecked`, so `no-floating-promises` and `no-misused-promises` run) are run, and the tree is reverted with `git checkout -- packages/cms/src/content/store.ts packages/cms/src/store`. The flip was run three times: content store only, admin store only, and both. The baseline `tsc` run had 0 errors.

3. **Two small checks.** The first rendered a Nunjucks 3.2.4 template whose context function returns a promise. The second timed a `node:sqlite` point lookup called directly against the same lookup behind `await`, 200,000 calls, 3 runs.

### What was measured

**Direct call sites** (outside the SQLite implementations):

| | src | tests |
| --- | --- | --- |
| Calls to a store method | 260 (ContentStore 126, AdminStore 134) | 1,084 |
| of which already in an async function (only an `await` is added) | 74 | 1,014 |
| of which in a sync function (that function changes) | 186 | 70 |
| Lifecycle calls (`close`, `setReadOnly`) | 11 | n/a |

Direct src call sites by area: web 66, admin 59, federation 53, content 26, comments 24, webmention 16, cms 4, notifications 4, root 3, micropub 3, avatars 2.

**Transitive reach**:

| | src | tests |
| --- | --- | --- |
| Functions that start returning a promise | 326 | 100 |
| Further calls that only need an `await` added | 278 | 622 |
| Files that change | 99 (of 403) | 114 (of 356) |
| SQLite implementation files (rewritten, not awaited) | 23 | n/a |

**By layer**, for src. A file is placed in a layer by name. The rule is in `reach.ts` `layer()`. Routes means admin/, every `*routes.ts`, the listing, document, embed, request, session and micropub handlers. Template context means `web/render.ts`, `context.ts`, `page-sources.ts`, `conversation.ts`, `archive.ts`, `site-view.ts`, `listing-subject.ts`, `paths.ts`, `markdown-representation.ts`, the feed item builders, `theme/` and `content/post-type.ts`. Plugin API means `plugin.ts`, `plugins/` and `web/plugin-*`. Services means everything else.

| Layer | Direct call sites | Functions that turn async | Files |
| --- | --- | --- | --- |
| Routes | 75 | 117 | 42 |
| Services | 134 | 115 | 46 |
| Template context | 49 | 91 | 10 |
| Plugin API | 2 | 3 | 1 |

The files with the most functions that turn async are `web/conversation.ts` (41), `webmention/reply-contexts.ts` (22), `content/post-type.ts` (14), `web/page-sources.ts` (10), `federation/federation.ts` (10) and `comments/records.ts` (10).

The walk ended at 34 callbacks in src that are handed to outside code. 24 are Hono handlers and 10 are Fedify dispatchers, and all of them accept a promise. No callback in src is handed to outside code that needs it to be sync, because the Nunjucks filters do not read the stores (see the next section).

**The prototype flip**:

| Flip | `tsc` errors | Files with an error |
| --- | --- | --- |
| ContentStore only (35 methods) | 569 | 90 |
| AdminStore only (62 methods) | 615 | 73 |
| Both (97 methods) | 1,181 | 141 |

When both stores were flipped, src had 446 errors in 79 files: web 112, admin 80, federation 64, store 62, content 57, comments 29, webmention 15, notifications 12, micropub 7, root 5, cms 2, avatars 1. Tests had 735 errors in 62 files. Most were TS2339, a property read on a promise (673). Next came TS2740 (156), TS7006 (105) and TS2322 (102).

`tsc` misses a class of breakage that only lint or a test run would find. A test such as `assert.deepEqual(store.listPosts(), [...])` compiles with a promise in it, and so does a write whose result nobody reads. On the flipped tree, `eslint` reported 349 `no-floating-promises` (43 in src, 306 in tests) and 16 `no-misused-promises` (11 in src, 5 in tests). The rest of its findings are `no-unsafe-*` rules that follow from the type errors above.

**Cost per call**: a point lookup took 0.56 µs called directly and 0.62 µs behind `await`, the same in all 3 runs. Making the SQLite path async costs nothing that matters, so a sync fast path has no speed to win back.

### Templates and plugins: can they await?

**The theme template engine cannot await.** `web/render.ts` renders with Nunjucks's synchronous `environment.render`. A context function that returns a promise does not fail. It renders wrong without an error. `{% for p in newestPosts(2) %}` iterated nothing and `{{ newestPosts(1) }}` printed `[object Promise]`. An async filter (`addFilter(name, fn, true)`) works only with callback rendering. Called from the synchronous `renderString`, it returned `null`. Async filters also need `asyncEach` in place of `for`, so a theme would have to change its syntax.

The template layer reads the stores in two different ways:

- **Before rendering.** `neighbours`, `backlinks`, `pages`, `archivePosts`, the listing `list` and `count`, and search are all called by the renderer while it builds the context, before `environment.render`. The renderer can await them and the templates never see a promise. The renderer's own methods (`renderPage`, `renderDocument`, `renderListing`, `renderSearch`, `renderFrontPage`) would become async. Templates would not change.
- **While rendering.** `newestPosts(count)` (`web/render.ts` line 692, from `page-sources.ts` line 81) is the only store-backed function a template calls. The walk found no other value that escapes into a template context. A theme calls it as `{% set posts = newestPosts(5) %}`, and the theme chooses the count. The default theme's `front-page.njk` and `docs/eleventy.md` document it. `docs/eleventy.config.example.js` defines the same global with `addNunjucksGlobal` so that a theme renders the same under Eleventy. If it returned a promise, every published front page that uses it would render an empty list with no error. It can stay synchronous if the renderer prefetches. For the front page only, the renderer would await the newest posts up to a fixed cap, and `newestPosts(count)` would slice that list and refuse a count above the cap. Templates would not change.

One indirect path matters as well. `postLabel` (content/post-type.ts) labels an untitled reply by the page it cites. It reads that page through a `CitedPageReader`. The reader asks `replyContexts.read`, which asks the conversation for a held reply (`cms/services.ts` line 194, `web/conversation.ts` `heldAt`), and that reads both stores. `postLabel` runs while the renderer builds entries, in feeds and in admin lists, so a naive conversion would make all of them async. That accounts for most of the 14 `post-type.ts` functions and the 22 `reply-contexts.ts` functions above. Prefetching the cited pages a listing needs, or keeping held replies in memory, cuts that path off.

**The plugin API can await, and only two members break.** Most `PluginHost` and `PluginSite` methods that do I/O already return promises (`siteInfo`, `fetch`, `setActorId`, `putComments`, `renameComments`). Plugin screens are awaited. The walk reached the plugin API through `PluginFederationContext.outbox(username)` and `.followers(username)` alone (plugin.ts lines 272 and 274). Each returns its `totalItems` synchronously, from `countByAuthor` and `countFollowers`. Both would have to return `Promise<PluginCollection<…> | undefined>`. That breaks every published plugin that calls them. In this repository that is `@geekity/plugin-wordpress`: 8 lines in `src/federation.ts`, all inside Fedify counter and cursor callbacks that already accept a promise. `PluginSite.followers` (`import.ts` line 275) reads the federation files, not the admin store, and does not change. The plugin packages' tests call `instance.admin.*` 20 times through the testing harness, and those calls would need `await`.

Code that embeds `createCms` would break as well, because `Cms.store`, `Cms.admin` and `GeekityEnv` expose the stores. No code in this repository outside the package uses them except those plugin tests.

### What async changes besides signatures

`node:sqlite` is synchronous, so a sync function's sequence of store calls cannot interleave with another request. Async calls can interleave. Only 2 sync functions both read and write the store directly. `retireOldSessionCookie` (`web/session.ts`) calls `getSession` and then `deleteSession`. `consider` (`comments/reply-notices.ts`) calls `getState` and then `setState`, inside a serial queue that would keep it safe. Sequences that span several functions were not measured. A conversion would need to look for check-then-act sequences across `await` points and turn them into transactions or conditional writes, as decision-54 did for job records.

The conversation listeners (`onConversationWrite`) are called synchronously from store writes, and two of them (`webmention/service.ts` `heard`, `comments/reply-notices.ts` `queueNoticesFor`) reach the stores. They would become fire-and-forget promises, or the write would have to await its listeners.

### Search and rebuild on Postgres, on paper

**Search.** Today `documents_fts` is an FTS5 table with `tokenize = 'porter unicode61 remove_diacritics 2'`. Results are ranked with `bm25` and weights that put a title match above a match in the description or the taxonomy, and those above a match in the body. Ties go to `date_sort DESC, path DESC`. The snippet comes from `snippet(…, SNIPPET_OPEN, SNIPPET_CLOSE, '…', 24)`. `content/search.ts` `searchExpression` turns what a reader typed into FTS5 syntax: quoted phrases, `word *` prefixes and an implicit AND. It sits outside `content/sqlite/`, so backend syntax already leaks into shared code.

On Postgres, `SearchReader` would keep its signature and become async. The implementation would:

- Keep a weighted `tsvector` column: `setweight(…title…, 'A') || setweight(…description, tags, categories…, 'B') || setweight(…body…, 'C')`, with a GIN index. `english` stands in for `porter`. `unaccent` stands in for `remove_diacritics`. `unaccent` is not immutable, so a generated column needs an immutable wrapper or a trigger.
- Build a `tsquery` from the same parsed terms. A word becomes a lexeme, a prefix becomes `lexeme:*`, and a phrase becomes `a <-> b`, all joined with `&`. To get there, `searchExpression` would first return a list of terms and leave rendering them to each backend.
- Rank with `ts_rank_cd` and the same weights, and break ties the same way. The order will not match bm25 exactly, and the Snowball english stemmer does not match porter on every word. A contract test shared by both backends should assert which documents match and that a title match beats a body match, not exact scores.
- Build snippets with `ts_headline` and `StartSel`, `StopSel` and `MaxWords` set to match. `ts_headline` parses each document again, so it should run only on the rows of the requested page, in a subquery after the `LIMIT`.
- Count with `count(*)` over the same `WHERE` for `countSearch`.

**Rebuild.** Today the database is one derived file (decision-1, decision-9). `discardDatabase` deletes `geekity.db` with its `-wal` and `-shm` files. `rebuildingIfOutdated` (cache.ts) catches `OutdatedDatabaseError` when boot opens both stores, discards the file and opens again. `geekity rebuild` (cli.ts line 944) discards the file. Tools > Rebuild calls `store.clear()` and scans again. Admin rows are in the same file, so a discard also drops sessions and delivery outcomes, which docs/content.md already says a site may lose.

On Postgres there is no file to delete. A store factory would own these four operations, and cache.ts, boot and the CLI would stop reaching the file:

- `open()` would run the migrations and throw `OutdatedDatabaseError` exactly as now.
- `discard()` would drop and recreate the site's schema (`DROP SCHEMA … CASCADE`) in one transaction. That gives a site one schema in a shared Aurora cluster, which decision-52's farm idea would need too. Keeping the content index and the admin tables in separate schemas would let a rebuild keep sessions. That is a choice the build would make, and it is not a requirement.
- `rebuildingIfOutdated` would keep its logic and become async.
- `setReadOnly`, which uses SQLite's `query_only` during a supervised handover (TASK-288), would become a flag in the store, because a pool has no single connection to set it on.

`clear()` and `upsertAll()` are already each one transaction, so on a pool they need one client for their duration. The scan that compares file hashes (`listPaths` and the row hashes) works the same over async calls.

## Decision

**Do not make the stores async until a Postgres build is a real project.** decision-52 calls Aurora an idea with no plans. The measured cost is concrete. At least 326 functions in 99 src files turn async, with 278 more awaits. Tests need about 1,100 call-site edits across 114 files. 23 implementation files are rewritten. The change also breaks two public contracts: the plugin federation context, and `Cms.store`, `Cms.admin` and `GeekityEnv` for embedders. Today it buys nothing, because SQLite gains no speed (0.06 µs a call) and no second backend exists to use it.

The options compared:

| Option | Cost now | Cost if Postgres becomes real | Verdict |
| --- | --- | --- | --- |
| A. Full async now | Everything measured above. Every feature from then on writes async store code. Breaks plugins and embedders in the next major | Only the adapters | Pays the whole cost early for a build nobody has planned |
| B. Async interface with a sync fast path (or `T \| Promise<T>`) | Two code paths and two sets of tests | Every caller still has to await for the Postgres path, so it costs as much as A | Rejected. There is no speed to win back, and the duplication is permanent |
| C. Prefetch before render | Not an option on its own. It is how A should handle the template layer | Saves most of the 91 template-context functions, keeps every theme working and keeps the renderer's templates sync | Adopted as the shape for the render path whenever A happens |
| D. Wait until a Postgres build is real | Near zero | Measured above. It grows slowly with new call sites, and `reach.ts` re-measures it | **Chosen** |

Two things would be cheaper to settle before a Postgres build than during one. Neither is required.

- **The plugin federation context.** It is the only plugin-facing contract the change breaks. The next `@geekity/cms` release is already a major, so moving `outbox` and `followers` to promises now costs about 8 lines in `plugin-wordpress` and saves a second plugin break later. This is proposed task 1. If the major ships without it, drop the task.
- **The measurement.** Keeping `reach.ts` in the repository lets anyone measure the reach again, which AC #1 asks for. This is proposed task 2.

### When a Postgres build is real

If that day comes, build in this order. Each step ends with green `tsc`, `eslint` (`no-floating-promises` catches the writes nobody awaits) and tests, with SQLite still the only backend.

1. **A store factory seam.** `createCms` takes `config.stores` (open, discard, rebuild-if-outdated). `cache.ts`, boot, `geekity rebuild` and Tools > Rebuild go through it, and only the SQLite factory touches `geekity.db`. Verified by the existing rebuild and boot tests and by `sqlite-boundary.test.ts` losing its `cache.ts`, `cli.ts` and `cms/boot.ts` exceptions.
2. **Backend-neutral search terms.** `searchExpression` returns parsed terms and the SQLite search renders them to FTS5. Verified by `content/search.test.ts` unchanged.
3. **`AdminStore` async, one sub-store at a time,** starting with sessions because the admin middleware reads them on every request. 62 methods, 615 `tsc` errors in 73 files today. Audit check-then-act sequences as each sub-store moves.
4. **`ContentStore` writers, the schedule and the catalog,** which are called from services and admin routes.
5. **The public render path, with prefetching.** Route loaders await the store, the renderer awaits its context sources, Nunjucks stays synchronous, `newestPosts(count)` is served from a prefetched list up to a cap, and the cited pages for `postLabel` are prefetched per listing. Verified by the theme tests and the Eleventy example rendering the same.
6. **The plugin federation context,** unless proposed task 1 already did it.
7. **Postgres adapters behind a contract test** that runs against both backends, as decision-54 ran its queue contract against six transports.

## Consequences

- The stores stay synchronous. New code may keep calling them synchronously. The reach grows with each new sync call site, and `reach.ts` reports by how much.
- No guard is added against new sync store calls. A ratchet on the count would get in the way of ordinary feature work for a build with no plan. The one rule worth keeping in reviews is the template contract: a new store-backed value for themes should be prefetched into the context, not offered as a function the template calls. `newestPosts` stays the only exception.
- `sqlite-boundary.test.ts` still stops new `node:sqlite` imports outside the stores (decision-52).
- TASK-385's AC #5 waits for the user to accept or amend this record.

## Proposed tasks

Both are optional. File them only if the user wants them, since this record recommends waiting.

1. **Make the plugin federation outbox and followers async**
   - Description: `PluginFederationContext.outbox(username)` and `.followers(username)` (packages/cms/src/plugin.ts) return their collection synchronously because `totalItems` comes from `countByAuthor` and `countFollowers`. They are the only plugin API members that an async store would break (decision-56). Change them to return promises in the major release already pending, so a later Postgres build does not break plugins a second time.
   - Acceptance criteria:
     - `outbox` and `followers` on `PluginFederationContext` return `Promise<PluginCollection<…> | undefined>`, and `web/plugin-federation.ts` implements them that way.
     - `@geekity/plugin-wordpress` `src/federation.ts` awaits them in its Fedify counter and cursor callbacks, and its federation tests pass.
     - docs/plugins.md and the changelog say the two members now return promises, and the release notes list it as a breaking change for plugins.
     - `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.

2. **Keep the async-store reach measurement in the repository**
   - Description: decision-56's counts came from a language-service walk (`reach.ts`) that is now git-ignored under `_local/`. Commit it as a development script so the reach of an async `ContentStore` and `AdminStore` can be measured again before anyone starts a Postgres build. It is not run in CI.
   - Acceptance criteria:
     - The script lives under `scripts/` at the repository root (not `packages/`) and runs with `node scripts/<name>.ts packages/cms`. It prints the direct call sites, the functions that turn async, the files that change, each by area and by layer, and the places the walk stopped.
     - Run at the commit it lands on, it reproduces the counts in decision-56, or the record is updated with the new numbers and the commit they were taken at.
     - `pnpm lint` passes with the script included.
     - decision-56 names the script's path in place of `_local/async-stores-spike/reach.ts`.
