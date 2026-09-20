---
id: TASK-95
title: 'Rebuild the content index from the admin, without stopping the server'
status: To Do
assignee: []
created_date: '2026-09-19 23:32'
updated_date: '2026-09-20 12:20'
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
- [ ] #1 A ContentStore.clear() empties documents, document_tags, document_categories and documents_fts, proven by a test that indexes documents, clears, and finds the index and a full-text search both empty
- [ ] #2 An admin action rebuilds the index in place: clear, then rebuildFederationIndexes, rebuildCommentIndexes and content.sync(), proven by a test that corrupts or empties the index behind a running CMS and finds every post served again afterwards
- [ ] #3 The session that started the rebuild is still signed in when it finishes, and the delivery log, ap_relays rows and the cms_state scheduler watermark all survive it, proven by a test
- [ ] #4 The rebuild federates nothing: no delivery, webmention or feed notification is sent for a document the scan re-indexes, proven by a test
- [ ] #5 The action is behind a confirm step, in the shape admin/taxonomy.ts:143 uses for a merge, and a second rebuild started while one is running is refused rather than run concurrently
- [ ] #6 geekity rebuild is unchanged and still refuses while the database is in use
- [ ] #7 The README documents the admin action, and the Deploying with Docker section points at it instead of leading with the stop-and-run-rm route
<!-- AC:END -->
