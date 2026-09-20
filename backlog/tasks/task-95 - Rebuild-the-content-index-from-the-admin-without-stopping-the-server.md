---
id: TASK-95
title: 'Rebuild the content index from the admin, without stopping the server'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-19 23:32'
updated_date: '2026-09-20 13:10'
labels:
  - admin
  - web
milestone: m-16
dependencies: []
references:
  - packages/cms/src/content/store.ts
  - packages/cms/src/content/sync.ts
  - packages/cms/src/federation/records.ts
  - packages/cms/src/comments/records.ts
  - packages/cms/src/admin/settings-page.ts
  - packages/cms/src/admin/taxonomy.ts
  - packages/cms/src/cli.ts
type: feature
ordinal: 120800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`geekity rebuild` deletes geekity.db and boots a fresh CMS, so it refuses to run while a server holds the file (cli.ts:485). In a container the server is PID 1, so `docker exec <container> geekity rebuild` can never work: the only route is to stop the container, run `docker compose run --rm geekity geekity rebuild`, and start it again. That is documented in the README's Deploying with Docker section, but it means downtime for what is usually a routine repair after an out-of-band edit to the content files.

Rebuild the index in place instead, from the admin, on the live connections. Nothing is deleted and no connection is swapped, so the nine services that capture the store objects at boot (the renderer, delivery, the scheduler, comments, webmentions, relays) keep working against the same objects. Federation already reads the stores off the request context (federation/mount.ts:38-41) and needs nothing.

The work is: empty `documents` and `documents_fts`, then call the three functions that already run on every boot — `rebuildFederationIndexes` (federation/records.ts:357), `rebuildCommentIndexes` (comments/records.ts:553) and `content.sync()` (index.ts:1729). Only the first has no home yet: ContentStore has upsert, remove and listPaths but no clear. The migrations already run the SQL it needs (`DELETE FROM documents` at content/store.ts:1093, :1106 and :1129), and remove() shows the FTS row has to be deleted by hand because nothing cascades into a virtual table.

This is kinder than the CLI rebuild, not just more convenient. Because nothing is deleted it keeps sessions, so the admin who pressed the button is still signed in when the redirect lands; it keeps the delivery log and the ap_relays rows; and it keeps the scheduler watermark in cms_state, so a post that came due during the rebuild is still announced. It also federates nothing: delivery, webmentions and the feed notifier all ignore changes whose origin is 'scan' (federation/delivery.ts:297, webmention/service.ts:197, notify.ts:164), which is why a boot scan is silent today.

The CLI command stays as it is. It exists for a database this version refuses to open (UnusableDatabaseError, cache.ts:63), and the server is not running in that case, so the admin cannot be the door for it. The two do not overlap.

Open decisions for whoever builds it:

1. Where it lives. There is no Tools or Maintenance page; ADMIN_SECTIONS (admin/menu.ts:88-126) has ten sections and Settings has six children. A seventh Settings child, Tools, is the cheapest home, and SettingsPage.endpoints (admin/settings-page.ts:85) already carries extra POST handlers. The closest precedent is the Send test email button in admin/settings-email.ts:155.
2. The 404 window. Between the clear and the end of the scan every post is missing from the index. One transaction around both closes the window but holds a write lock for the whole scan and fights the per-file upsert. On a small site the window is well under a second.
3. No progress feedback. The scan runs inside the POST, as the taxonomy rewrite does today (admin/taxonomy.ts:123-176), and node:sqlite is synchronous, so a large site means seconds of a mostly blocked event loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A ContentStore.clear() empties documents, document_tags, document_categories and documents_fts, proven by a test that indexes documents, clears, and finds the index and a full-text search both empty
- [x] #2 An admin action rebuilds the index in place: clear, then rebuildFederationIndexes, rebuildCommentIndexes and content.sync(), proven by a test that corrupts or empties the index behind a running CMS and finds every post served again afterwards
- [x] #3 The session that started the rebuild is still signed in when it finishes, and the delivery log, ap_relays rows and the cms_state scheduler watermark all survive it, proven by a test
- [x] #4 The rebuild federates nothing: no delivery, webmention or feed notification is sent for a document the scan re-indexes, proven by a test
- [x] #5 The action is behind a confirm step, in the shape admin/taxonomy.ts:143 uses for a merge, and a second rebuild started while one is running is refused rather than run concurrently
- [x] #6 geekity rebuild is unchanged and still refuses while the database is in use
- [x] #7 The README documents the admin action, and the Deploying with Docker section points at it instead of leading with the stop-and-run-rm route
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
The three open decisions, settled before anything is written:

1. **Where it lives: a top-level Tools section, between Users and Settings,
   with one child, Content index, at `/admin/tools`.** Not the seventh
   Settings child the description suggested. Settings' children *are* the
   settings pages — `settings-pages.test.ts` asserts exactly that, and a
   settings page is one shared form with a Save button, which a button that
   runs a job is not. WordPress classic, which `menu.ts` names as the shape of
   this menu, has a top-level Tools for precisely this kind of thing, in
   precisely that position, and it is where the import command and a site
   health screen would join later. The child's URL is `/admin/tools` itself,
   the way General is `/admin/settings` itself.
2. **The clear and the scan are not one transaction.** One `ContentStore`
   connection serves every request, so an open write transaction is not
   isolation: a save made by somebody else during the scan would land *inside*
   the rebuild's transaction and be rolled back with it if the scan threw.
   `clear()` is its own transaction; the scan runs as the boot scan does. The
   404 window between them is named on the confirm screen.
3. **The scan runs inside the POST, with no progress feedback**, as the
   taxonomy rewrite does. `node:sqlite` is synchronous, so moving it off the
   request would block the same event loop from somewhere the admin cannot
   see; and progress would need state the database is not allowed to hold
   (decision-9). The flash reports what the scan did.

Then, test first for each criterion:

1. `ContentStore.clear()` — empties `documents`, `document_tags`,
   `document_categories` and `documents_fts` in one transaction. Test in
   `content/store.test.ts`: index documents with tags, categories and words,
   clear, assert `counts()`, `listPaths()`, `listTags()`, `listCategories()`
   and `search()` are all empty.
2. `rescan` on the request context (`c.set('rescan', () => content.sync())`),
   so a handler can run the boot scan; `admin/tools.ts` holds
   `rebuildContentIndex({ store, admin, contentDir, rescan })`: clear,
   `rebuildFederationIndexes`, `rebuildCommentIndexes`, then the scan.
3. `mountToolsScreen` in `admin/tools.ts`, `pages/tools/content-index.njk`,
   the menu entry, the mount in `routes.ts`, the exports.
4. `admin/tools.test.ts` over HTTP through the signed-in harness: the screen,
   the confirm step, a rebuild after the index is emptied behind the running
   CMS, the session and the `ap_deliveries`/`ap_relays`/`cms_state` rows
   surviving it, nothing federated, and a second rebuild refused while one
   runs.
5. `cli-rebuild.test.ts` is left alone and still passes: the CLI command is
   not touched.
6. README: a section under Keeping the index in step, and the Docker section
   pointing at the admin action for a routine repair while keeping
   stop-and-run-rm for the database this version cannot open. doc-5 and
   `menu.test.ts` learn the new section.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The three decisions

**1. Where it lives: a new top-level Tools section, not a seventh Settings child.**
`menu.ts` says the menu is WordPress classic, and WordPress keeps a top-level
Tools between Users and Settings for exactly this kind of thing — a job you
run, not a setting you type. Settings' children are the settings pages, an
invariant `settings-pages.test.ts` asserts outright ("are the six the Settings
menu lists"); a Tools page there would either be a `SettingsPage` with no
fields, rendering a Save button over an empty form and a POST that writes
nothing, or a child that breaks the rule the test states. Tools is also where
the next such screen goes — an import, a site health page — and it shows the
index's counts, which is how somebody notices the index is wrong at all. The
section has one child, Content index, whose URL is `/admin/tools` itself, the
way General is `/admin/settings` itself. The cost was one existing assertion
(`menu.test.ts`, the section-label list) and two rows in doc-5.

**2. The clear and the scan are not one transaction.** One `ContentStore`
connection serves every request, so a write transaction held open across the
scan would not isolate the rebuild from anybody: another request's save during
it would land *inside* the rebuild's transaction and be rolled back with it if
the scan threw. `clear()` is one transaction over its four tables; the scan
runs outside it, exactly as the boot scan does. The 404 window that leaves is
named on the confirm screen, in the sentence the admin has to read before the
button appears.

**3. The scan runs inside the POST, with no progress feedback.** Same shape as
the taxonomy rewrite. `node:sqlite` is synchronous, so moving the scan off the
request would block the same event loop from somewhere the admin cannot see,
and progress would need state the database is not allowed to hold
(decision-9). What the admin gets instead is the confirm screen saying the
scan takes a moment, and a flash that reports what it did: files scanned,
indexed, dropped, failed, and the followers, inbox activities and comments
read back.

## What was built

- `ContentStore.clear()` (`content/store.ts`): one transaction over
  `documents_fts`, `document_tags`, `document_categories` and `documents`. All
  four by name — the term tables would cascade, but a virtual table has no
  foreign key to cascade through, and a clear that depended on a pragma for
  half of what it empties would be a clear that half worked.
- `rescan` on the request context (`env.ts`, `index.ts`): `() => content.sync()`,
  so a handler can run the very scan boot runs rather than growing a second
  thing that knows how to read a content directory.
- `admin/tools.ts`: `rebuildContentIndex()` — clear, `rebuildFederationIndexes`,
  `rebuildCommentIndexes`, then the scan, in boot's order — and
  `mountToolsScreen()`, which is the screen, the confirm step and the one-at-a-
  time guard (the in-flight promise is held in the mount's closure; a second
  press is flashed a refusal and redirected, not queued).
- `admin/pages/tools/content-index.njk`, `ADMIN_TEMPLATES.toolsContentIndex`,
  the `tools` section in `menu.ts`, the mount in `routes.ts`.
- README: a "Rebuilding the index from the admin" subsection under Keeping the
  index in step, a pointer from the two-directories table, and the Docker
  rollback passage now says the stop-and-run-rm route is only for a database
  the running version will not open. `packages/cms/README.md`: the same split
  under Starting the database again, the two new routes in the route table,
  and eleven sections in the menu paragraph. doc-5: the Tools row and the
  `/admin/tools` screen.

## Verification

- `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
  all pass: 2047 + 30 tests, 0 failures.
- Over real HTTP against `geekity serve` on port 3799 with `GEEKITY_WATCH=false`
  — the container case: a post file written behind the running site answered
  404; the unconfirmed POST rendered "Rebuild the index now?" and left it at
  404; the confirmed POST answered 303 and the post answered 200; the flash
  read "Rebuilt the index from the files. Scanned 1 file: 1 indexed, 0 dropped,
  0 failed. Read back 0 followers, 0 inbox activities and 0 comments."; the
  admin was still signed in for all of it. `geekity rebuild` against that same
  live site refused with its usual message and exited 1. Server stopped after.
- The AC #4 test carries its own control: on the same site, with the same fetch
  stub, the same post trashed through the admin *does* reach the follower. The
  silence during the rebuild is therefore the silence of a site that could
  have spoken.

## One existing test touched

`packages/cms/src/admin/menu.test.ts`, "reads the way doc-5 lists it": `'Tools'`
added to the expected section labels, between Users and Settings. Nothing else
in it changed, and doc-5 was updated to match. No other existing test needed a
line.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tools > Content index rebuilds the derived index in place, on a site that is
serving: `ContentStore.clear()` empties the four tables in one transaction,
then `rebuildFederationIndexes`, `rebuildCommentIndexes` and the boot scan
(reached through a new `rescan` on the request context) read `content/` back.
Nothing is deleted and no connection is replaced, so the admin stays signed in
and the delivery log, the relay handshakes and the scheduler's watermark are
kept; every change the scan makes carries `origin: 'scan'`, so no follower,
linked page or feed server is told. The action is behind a confirm step that
names the 404 window, and a second press while one is running is refused. It
lives in a new top-level Tools section — where WordPress keeps one, between
Users and Settings — rather than as a seventh settings page, because Settings'
children are the settings pages and this is a job rather than a form.
`geekity rebuild` is untouched and stays the door for a database this version
will not open.

Verified with `pnpm build && pnpm test && pnpm typecheck && pnpm lint &&
pnpm format:check` (2047 + 30 tests, 0 failures) and over real HTTP against
`geekity serve` with the watcher off: a post written behind the running site
404ed, the unconfirmed POST only offered the rebuild, the confirmed one
redirected and the post was served, and `geekity rebuild` against that same
live site still refused and exited 1.
<!-- SECTION:FINAL_SUMMARY:END -->
