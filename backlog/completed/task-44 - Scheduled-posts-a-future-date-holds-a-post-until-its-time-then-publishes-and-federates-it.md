---
id: TASK-44
title: >-
  Scheduled posts: a future date holds a post until its time, then publishes and
  federates it
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:34'
updated_date: '2026-09-04 05:09'
labels:
  - content
  - federation
milestone: m-5
dependencies:
  - TASK-4
  - TASK-11
  - TASK-19
references:
  - backlog/docs/doc-2 - Content-Format-(11ty-compatible-Markdown).md
type: feature
ordinal: 27800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post whose `date` is in the future is published the moment it is saved; WordPress holds it as "Scheduled" and publishes on the date. Treat a future-dated, non-draft post as not yet public: it is absent from listings, archives, feeds, the outbox, the sitemap and the public permalink (404, or a preview for a signed-in admin), and the index answers `isPublicDocument` accordingly. The CMS keeps a timer for the next due post (recomputed on every index change) and, when the time arrives, treats it as a `published` change so the same delivery path sends the `Create(Article)` and the rssCloud ping. A file whose date passed while the server was down publishes on the next boot scan without federating twice (the `activitypub.id` stamp already guards that). The admin lists scheduled posts with a Scheduled filter and status, and the editor shows the scheduled time in the site's time zone. Eleventy's own build has no clock, so document that a future-dated post is simply built there; the example config may filter on date to match.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A non-draft post dated in the future is absent from the home page, archives, feeds, the outbox and its permalink until that time, and appears in the admin as Scheduled
- [x] #2 When the date arrives the running server publishes it without a restart and followers receive Create(Article) once, proved with a fake clock
- [x] #3 A post whose date passed while the server was down is public on the next boot and federated once
- [x] #4 Editing the date of a scheduled post moves the timer; making it a draft cancels it
- [x] #5 The README documents scheduling and its Eleventy caveat
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## The decision the handoff asks for

Follow the task description: **a scheduled post is a published (non-draft, untrashed) document whose `date` has not arrived**. There is no new front-matter key and no new column — the rule is a clause against a `now` the index is given, so the file stays the whole truth and a scheduled post needs no state anywhere.

Two consequences taken deliberately:

1. **The rule is uniform across kinds.** Any non-draft, untrashed document with a future date is held, not only a post. Pages have no date field in the editor, so in practice only posts are ever scheduled; making the rule uniform means one clause in the store rather than one per query and no way for the two to drift.
2. **The public permalink 404s for everybody, admin included.** `src/admin/preview.ts` is a POST that renders a submitted form, so it does not help a GET of a permalink; previewing there would mean running the session lookup on every public request and making a cacheable public URL vary by viewer. The editor's existing Preview button already renders the post through the theme at an admin URL, which is the preview without the cache hazard. Recorded in the README.

## Plan

1. `src/content/schedule.ts` (new): `Clock`/`systemClock`, `isScheduled(document, now)`, and the scheduler service `createScheduler`. The predicate compares `dateSortKey(document.date)` with `now.toISOString()` — both are UTC ISO strings, so lexicographic order is chronological order and the SQL clause and the JS predicate cannot disagree.
2. `src/content/store.ts`: `openContentStore({ dataDir, now? })`, `store.now()`, and `AND (date_sort IS NULL OR date_sort <= :now)` on every public query — `listPosts`, `listByTag`/`listByCategory` and their counts, `listTags`/`listCategories`, and `counts().posts`/`.pages`. New `counts().scheduled`. `listAll` gains a `scheduled?: boolean` filter for the admin. Two new methods the scheduler needs: `nextDue()` (the earliest future date_sort) and `listDueSince(after)` (published documents whose date falls in `(after, now]`).
3. `src/web/documents.ts`: `isPublicDocument(document, now = new Date())` gains the scheduling clause; `publicDocumentAt` passes `store.now()`. `isFederatedDocument(document, now)` likewise, and `src/content/sync.ts`'s private `isPublic` imports the same `isScheduled`, so the index, the site, the feeds, the outbox and the `published`/`unpublished` events answer one rule.
4. The scheduler: a small service on the model of `src/notify.ts`. It holds a **watermark** — the instant up to which due documents have been announced — persisted through an injected `ScheduleWatermark` (backed by a new `state` key/value table, admin migration 10; not the `settings` table, whose row count decides whether to seed from `site.json`). `run()` announces every document in `(watermark, now]` and advances the watermark; a first run with no stored watermark writes `now` and announces nothing, so a rebuilt database never re-announces the archive. `handle(change)` re-arms from `store.nextDue()`; the timer factory is injected and the delay is clamped to `2^31-1` ms so a post dated 2030 re-arms rather than firing at once.
5. The fire is announced as `{ type: 'created', path, previous: undefined, next: document, origin: 'schedule' }` — a new `ChangeOrigin`. `previous` is `undefined` because no subscriber ever knew about the post: the site did not serve it, the feeds did not list it and no follower was told. That makes delivery send one `Create`, the notifier ping the feeds and `onPublish` fire, with no special case in any of them.
6. Wire into `createCms` beside delivery/notifier/relays: subscribe to `change`, `await scheduler.start()` in `serve()` after `content.start()` (so the boot catch-up runs on a scanned index), `scheduler.stop()` and `settled()` in `close()`, expose `cms.scheduler`.
7. Admin: a `scheduled` document filter and status badge; `Published` now excludes scheduled; the editor shows \"Scheduled for …\" formatted in the site's `timezone` setting through a new `formatInTimezone` helper; the save flash says the post is scheduled.
8. Docs: a Scheduling section in `packages/cms/README.md` with the Eleventy caveat (Eleventy has no clock, so a future-dated post is simply built there), a matching filter in `packages/cms/docs/eleventy.config.example.js`, and the root README where it names the behaviour.
9. Verify with `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` from the root, then live against the demo: a post two minutes ahead absent from the home page, feed, archive, outbox and permalink and Scheduled in the admin; published without a restart when its time comes with one Create in the delivery log; and the boot case — stop, write a file with a date that has just passed, start, public.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The rule

A scheduled post is a published (non-draft, untrashed) document whose `date` has not arrived. There is no front-matter key, no column and no state anywhere: the whole feature is a clause against a `now` the index is given, so the file stays the truth and nothing has to be written when the moment comes.

`isScheduled(document, now)` in the new `src/content/schedule.ts` compares `dateSortKey(document.date)` with `now.toISOString()`. Both are UTC ISO strings, so lexicographic order is chronological order — which is what lets the SQL clause and the JS predicate be the same comparison rather than two that could drift.

## Decisions

- **The rule is uniform across kinds.** Any non-draft, untrashed document with a future date is held, not only a post. Pages have no date field in the editor, so in practice only posts are ever scheduled; making the rule uniform is one clause in the store instead of one per query.
- **The public permalink 404s, for a signed-in admin too.** `src/admin/preview.ts` is a POST that renders a submitted form, so it is no help to a GET of a permalink; previewing there would mean running the session lookup on every public request and making a cacheable public URL vary by viewer. The editor's Preview button already renders the post through the theme's own layout at an admin URL, which is the preview without the cache hazard. Recorded in both READMEs.
- **A scheduled publish is announced as a creation with no `previous`.** `ChangeOrigin` gains `schedule`. `previous` is `undefined` because no subscriber ever knew about the post — the site did not serve it, the feeds did not list it, no follower was told. Reported that way it is exactly the change every subscriber would have seen had the file been written at that moment, so delivery sends one `Create`, the notifier pings the feeds and `onPublish` fires, with no special case in any of them. The alternative — passing the same document as both `previous` and `next` — would have every subscriber compute "was public" and "is public" against one clock and see no transition at all.
- **A watermark, not the `activitypub` stamp, is what makes it once.** The scheduler keeps the instant up to which due documents have been announced, in a new `cms_state` table (admin migration 10). `run()` takes everything in `(watermark, now]` and moves the watermark to `now`. A first run with no stored watermark writes `now` and announces nothing, so a deleted database never re-announces the archive. The stamp could not have answered this: a site with no followers is stamped anyway, and a hand-written file has no stamp whether or not it was ever scheduled.
- **A table of its own, not the `settings` table.** `countSettings()` is what decides whether a site is seeded from `content/_data/site.json`, so a scheduler row in there would silently stop the seeding on a fresh install. Nothing in `cms_state` is a site's choice and nothing is mirrored to the file.
- **The watermark moves before the announcements, not after.** At-most-once rather than at-least-once: a subscriber that dies half way through a catch-up must not have the whole window announced to it again on the next boot. Each publish is guarded on its own, so one failure is a line in the log and the rest still go out. The post is public either way, because being public is a property of its date and not of anything the scheduler wrote down.
- **The timer waits in hops.** `setTimeout` overflows past 2^31-1 ms and fires at once, so a post dated 2099 is waited for in hops of at most 24 days, each re-armed from `store.nextDue()`. The timer is `unref`ed so a pending publish never holds the process open by itself.
- **Every change re-arms.** `handle()` does not try to work out which changes could have moved the next due time; `nextDue()` is one indexed `MIN` over the listing index, which is cheaper than the reasoning.

## What moved

- **`src/content/store.ts`**: `Clock`/`systemClock`, `openContentStore({ dataDir, now })`, `store.now()`, and `(date_sort IS NULL OR date_sort <= ?)` on `listPosts`, both taxonomy archives and their counts, `listTags`/`listCategories` and `counts().posts`/`.pages`. New `counts().scheduled`, a `scheduled?: boolean` filter on `listAll`, and the two queries the scheduler needs: `nextDue()` and `listDueSince(after)`.
- **`src/content/schedule.ts`** (new): the predicate, `scheduledFor`, and `createScheduler` with the watermark, timer and logger seams injected.
- **`src/web/documents.ts`**: `isPublicDocument(document, now = new Date())` gains the clause; `publicDocumentAt` passes `store.now()`. `isFederatedDocument(document, now)` likewise, and `federatedPost`, `mount.ts`, `delivery.ts` and `notify.ts` all pass the injected clock rather than reading their own.
- **`src/content/sync.ts`**: `emitChange` takes the clock and the private `isPublic` uses the shared `isScheduled`, so an edit that pushes a published post into the future reads as an `unpublished` and withdraws it.
- **`src/index.ts`**: `createScheduler` beside delivery/notifier/relays, subscribed to `change`, `await scheduler.start()` inside `serve()` after `content.start()`, stopped in `close()`, exposed as `cms.scheduler`. `SCHEDULE_WATERMARK_KEY` is exported.
- **`src/config.ts`**: `now?: Clock`, resolved to `systemClock`. One clock for the index and the scheduler, so they cannot disagree.
- **Admin**: a `scheduled` filter and status badge; `published` now means published *and* out; the editor prints "Scheduled for …" through the new `formatInTimezone` in the site's `timezone` setting; the save flash says `Scheduled:` rather than `Published:`.
- **Docs**: a Scheduling section in `packages/cms/README.md` with the Eleventy caveat, matching notes in the root README, and a `geekity-scheduled` preprocessor in `docs/eleventy.config.example.js` (with `BUILD_SCHEDULED=1` as the escape hatch). `apps/demo/test/eleventy.test.ts` now filters with `isPublicDocument` rather than re-deriving the rule.

## Verification

**Tests.** 24 new cases. 7 in `content/store.test.ts` (the clause on every public query, the `scheduled` count, the admin filter, `nextDue` and `listDueSince`); 9 in the new `content/schedule.test.ts` over a fake clock and fake timers (the wait, the announcement's shape, the catch-up, the fresh-install no-op, re-arming on a moved date and cancelling on a draft, the 24-day hop, and a failed announcement that keeps the timer); 2 in `web/site.test.ts`; 1 in `web/feeds.test.ts`; 1 in `federation/article.test.ts` (outbox and object); 4 in `federation/delivery.test.ts` (nothing then one Create, the withdrawal when a date is pushed out, the boot catch-up federating once across two reboots, and a real `setTimeout` firing with no restart); 1 in `notify.test.ts`; 3 in `admin/posts.test.ts`.

Mutation-checked rather than trusted: making `isScheduled` answer `false` fails the permalink test and leaves the archive test passing, which is how the two paths — the JS predicate and the SQL clause — are known to be covered separately.

Four test fixtures dated 2026-09-04/05 were moved a month back. They were written as "tomorrow" and never meant to be scheduled; leaving them would have had tests about drafts pass for the wrong reason.

**Checks, from the repository root.** `pnpm build` clean; `pnpm test` 752 pass / 0 fail (`@geekity/cms`) and 11 / 0 (demo); `pnpm test:11ty` 9 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` clean; `pnpm fed:smoke` passed unchanged.

**Live, against the demo on port 3000**, signed in as `ada`. `notifyServer` was emptied on the settings screen for the run so the real rpc.rsscloud.io was never pinged, and put back afterwards.

- **AC #1.** A post saved with Publish and dated two minutes ahead (`2026-09-04T05:02:34.785Z`) was absent from the home page, from `/feed/`, `/feed/atom/` and `/feed/json/`, from `/category/engineering/`; `/tag/scheduling/` 404ed for want of an archive; its permalink 404ed as HTML, `index.json`, `index.md` and `application/activity+json`; the outbox read `totalItems 5` and `/ap/posts/…` 404ed. `/admin/posts` showed it with `admin-status-scheduled">Scheduled`, a `?status=scheduled` filter that listed only it, and no View link; `?status=published` listed the five older posts and not it. The flash read `Scheduled: A post that waits its turn` and the editor `Scheduled for 4 September 2026 at 00:02 CDT` — the site's `timezone` is `America/Chicago`.
- **AC #2.** Its permalink turned 200 at `05:02:34Z`, the instant it was due, with `demo site listening` still at one line in the log — no restart. The home page, all three feeds, `/tag/scheduling/`, `/category/engineering/` and the outbox (`totalItems 6`, object 200) all had it on the next request, the file gained its `activitypub` block, and `/admin/federation` held exactly one row for it: `Create`, `#create` once (0 sent / 0 queued, because the demo has no followers).
- **AC #3.** A second post was scheduled three minutes out, the server was stopped before its date and a third file was written by hand with a date a minute past. Booting again at `05:06:28Z` made both public at once (permalinks 200, both on the home page and in the RSS feed, outbox `totalItems 8`), stamped both files, and recorded exactly one `#create` for each. A second reboot added none: the watermark had moved from `05:02:34.788Z` to `05:06:28.507Z`.
- **AC #4.** Pushing the published post's date an hour out turned its permalink back to 404 and delivered `#delete/2026-09-04T05:07:15.065Z`. Moving it back to five minutes out re-armed the timer and the editor read `Scheduled for 4 September 2026 at 00:12 CDT`. Save draft took it out of the Scheduled filter and put it in Drafts.
- **AC #5.** `packages/cms/README.md` has a Scheduling section covering the behaviour, the admin, the 404-for-admins decision and the catch-up, and the Eleventy table gained the row: a build has no clock, only the moment it ran, so a future-dated post is left out of the build before its date and picked up by the next build after it — meaning a scheduled site needs a build on a schedule, which the CMS does not.

Everything the pass wrote was removed: the three test posts deleted, `apps/demo/data/geekity.db` restored from the backup taken before the run, `content/_data/site.json` restored byte-for-byte, and `git status apps/demo` showing only the pre-existing `site.json` edit and `content/uploads/`. `pgrep -fl "tsx watch"`, `pgrep -fl server.ts` and `lsof -nP -iTCP:3000` all report nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post dated in the future is now written today and published then, the way WordPress schedules one.

There is no `scheduled` key, no column and no state to keep: a scheduled post is an ordinary published one whose date has not arrived, which is a question asked of the clock. That question is one clause — `date_sort IS NULL OR date_sort <= now` — on every public query in the index, and one predicate, `isScheduled`, wherever a single document is in hand. Both compare UTC ISO strings, so the SQL and the JavaScript are the same comparison and cannot drift. The clock is injectable, one for the whole CMS, which is what lets a test be somewhere else in time.

The consequence is that everything follows for free: the post is off the home page, off both taxonomy archives, out of all three feeds and the two comments feeds, out of the ActivityPub outbox, its object 404s, and its permalink 404s as HTML, Markdown, JSON and ActivityStreams. Moving the date moves the publication, ticking Draft cancels it, and a date pushed into the future withdraws a post that was already out — with a `Delete` to the followers, exactly as drafting it would, because the sync derives `published`/`unpublished` from the same rule.

Nothing watches a clock, so `src/content/schedule.ts` holds one timer for the next post due, re-armed on every index change and waited for in hops of at most 24 days so a post dated 2099 does not overflow `setTimeout`. When it fires it announces the post as a creation with no `previous` — because until that moment no subscriber knew it existed — under a new `schedule` origin. That one shape is what makes the same `Create(Article)`, the same rssCloud ping and the same `onPublish` hook run without any of them knowing a timer was involved.

What keeps it to exactly one announcement is a watermark: the instant up to which due posts have been announced, in a new `cms_state` table. A run takes everything in `(watermark, now]` and moves the watermark to `now`, so a post that came due while the process was down is published on the next boot and never again, and a database somebody deleted announces nothing at all rather than the whole archive. It is a table of its own rather than a settings row because the number of settings is what decides whether a site is seeded from `site.json`.

The admin gained a Scheduled filter and status, an editor note giving the time in the site's own `timezone` rather than in UTC, and a flash that says `Scheduled:` rather than `Published:`. The public permalink 404s for a signed-in admin too, and that is deliberate: the public site has no session, every response it gives is cacheable, and a URL that answered differently for one viewer would be cached and served to the rest. The editor's existing Preview button already renders the post through the theme's own layout, at an admin URL.

Verified by 24 new node:test cases — 9 of them in `content/schedule.test.ts` over a fake clock and fake timers, and 4 in `delivery.test.ts` including one that waits for a real `setTimeout` — and by a live pass against the demo: a post two minutes out absent from every surface and Scheduled in the admin, public at the exact instant it was due with no restart and one `Create` in the delivery log, two posts that came due while the server was down public and federated once on the next boot and not again on the one after, and a date pushed out withdrawing the post with a `Delete`. `pnpm build`, `test` (752 + 11), `test:11ty` (9 + 5), `typecheck`, `lint`, `format:check` and `fed:smoke` all pass. The demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
