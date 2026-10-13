---
id: TASK-321
title: Backfill fediverse replies to a reply from its replies collection
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 12:31'
updated_date: '2026-10-10 17:52'
labels:
  - federation
  - comments
dependencies:
  - TASK-300
references:
  - packages/cms/src/federation/replies.ts
priority: low
type: feature
ordinal: 280800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A fediverse user who answers a fediverse reply on one of our threads addresses the person they answer, not us, so their reply never reaches our inbox. Most servers publish a Note's replies as a replies collection. Fetching that collection for the fediverse replies in a thread would bring those answers in. It is polling, so it needs limits on when, how often and how deep.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The site fetches the replies collection of fediverse replies in a thread and shows replies found there threaded under them, with their remote URLs
- [x] #2 Fetching is bounded: a fetch interval per thread, a depth limit, a page limit, and no fetch for threads older than a set age
- [x] #3 A reply already held from the inbox is not shown twice, and a reply the remote server drops is removed
- [x] #4 A server that does not publish replies, or answers with an error, is skipped without breaking the thread
- [x] #5 The CMS README Federation section describes the backfill and its limits
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Storage (data shape): a backfilled reply is an inbox log line like a delivered one, a synthetic Create (id = note id + #fetched, actor = the note's attributedTo, object = the note as compacted JSON-LD) with fetched: true on the line. InboxLine/InboxActivity gain fetched; ap_inbox gains a fetched column (admin migration 25); rebuild carries it. Threading, counts, /replies/ keys, feeds and Delete/Undo withdrawal then apply unchanged through gather().
2. records.ts: removeInboxActivities(records, rows) drops lines from their month files under the file lock and the rows from the index (AdminStore.deleteInboxActivity, which notifies onConversationWrite). appendInboxActivity of a delivered Create drops any fetched line for the same note, so one note is one row.
3. federation/backfill.ts: RepliesLoader port (signed via siteLoaders: GET the note, 404/410 -> gone, other error -> failed, no replies collection -> nothing to say; walk the replies collection's items and first/next pages up to BACKFILL_PAGES; keep notes whose inReplyTo is the note, whose author is on the note's own origin and that are addressed to as:Public). ReplyBackfill service: sweep on the shared interval timer (start/stop/settled like the actor profiles), threads = served federated posts younger than BACKFILL_MAX_AGE_MS not read within BACKFILL_INTERVAL_MS (cms_state key per post); walks the thread's visible fediverse replies to BACKFILL_DEPTH, at most BACKFILL_COLLECTIONS per thread per sweep; skips own-origin and already-held notes; removes a fetched reply (and fetched replies under it) whose note is gone or that a completely-read collection no longer lists. Errors log and skip.
4. index.ts: build it with the federation context, capture actor profiles for new authors, start/stop/settle with the other timers; expose cms.replyBackfill.
5. Tests (every fetch stubbed): threading under the delivered reply with remote URLs, depth/page/age/interval bounds, no duplicate when already held or delivered later, removal on 410 and on omission (fetched only), failing/absent collection leaves the thread; records/migration round-trip of fetched.
6. CMS README Federation section; decision recording bounds and storage.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Storage: a backfilled reply is an inbox log line like a delivered one, the Create nobody delivered (id {note}#fetched, actor = the note's attributedTo, object = the note compacted), with "fetched": true on the line. InboxLine/InboxActivity.fetched, ap_inbox.fetched (admin migration 25), rebuild carries it. gather() is unchanged: threading, counts, /replies/ keys (reply_key), feeds and Delete/Undo withdrawal apply as they do to a delivered reply.
records.ts: removeInboxActivities(records, rows) takes lines out of their month files under the file lock and rows out of the index (AdminStore.deleteInboxActivity, which fires onConversationWrite). appendInboxActivity of a delivered Create removes any fetched row for the same note, so one note is one row.
federation/backfill.ts: signedRepliesLoader reads the note through siteLoaders (signed as the first account, 30 s timeout), 404/410 = gone, other errors = failed, no replies = nothing concluded; walks the collection's items or first/next pages up to BACKFILL_PAGES (3); keeps items that answer the note, are addressed to as:Public and are attributed to an actor on the note's own origin; never fetches this site's origin. createReplyBackfill sweeps every BACKFILL_SWEEP_MS (1 h) on the shared NotificationTimers: served posts younger than BACKFILL_MAX_AGE_MS (30 d) by date, each thread at most once per BACKFILL_INTERVAL_MS (6 h, cms_state key backfill.thread:{permalink}, stamped before reading); reads the collections of the thread's visible fediverse replies at depth <= BACKFILL_DEPTH (4), shallowest first, plus newly found ones within the depth. A fetched reply (and the fetched replies under it) is removed when its note is gone or a collection read to its end no longer lists it; delivered replies are never removed. index.ts builds it with the federation context, captures actor profiles for new authors, starts/stops/settles it with the other timers; cms.replyBackfill.
Blocks/defederation: the codebase has no actor or domain block list (grep found none), so there is nothing further to respect; the backfill goes through the same log, so one added later to the inbox log's readers covers both.
Validation: pnpm build, pnpm test (cms 5331 pass), typecheck, lint, format:check all pass. federation/backfill.test.ts (16 tests, every fetch stubbed, mastodon.social stub refuses unsigned GETs) mutation-checked: 12 mutations (gone filter, delivered-replaces-fetched, complete check, depth, pages, public, author origin, interval, age, descendant removal, held check, fetched line field) each fail exactly the matching test. Scratch site under the scratchpad served on 127.0.0.1 with a loopback fake remote: after serve() the post page nests Bob's backfilled reply under Ada's delivered one with its remote URL, the comments feed lists both, and the log line carries fetched: true; server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fediverse replies to a fediverse reply are backfilled from the replies collection of the note they answer (decision-50). A sweep on the shared interval timer reads, signed as the first account, the collections of the visible fediverse replies in threads whose post is under 30 days old, each thread at most every 6 hours, to 4 levels deep and 3 pages per collection. What it finds is logged as the Create nobody delivered, a fetched line in the inbox log (ap_inbox.fetched, admin migration 25), so threading, counts, /replies/ keys, feeds and Delete handling come from the existing conversation reading unchanged. A note is held once: the sweep skips one the inbox holds and a later delivery replaces the fetched line. A fetched reply is removed with its fetched replies when its server answers 404/410 or a fully read collection drops it; errors and missing collections change nothing. README Federation section documents it. Verified with federation/backfill.test.ts (16 tests, all fetches stubbed, mutation-checked), the full suite, typecheck, lint and format, and a scratch site served against a loopback remote.
<!-- SECTION:FINAL_SUMMARY:END -->
