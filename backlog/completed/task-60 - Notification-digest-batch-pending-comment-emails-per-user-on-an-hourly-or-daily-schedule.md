---
id: TASK-60
title: >-
  Notification digest: batch pending-comment emails per user on an hourly or
  daily schedule
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 11:22'
updated_date: '2026-09-05 12:01'
labels:
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-55
references:
  - packages/cms/src/notifications/preferences.ts
  - packages/cms/src/notifications/comments.ts
  - packages/cms/src/notifications/links.ts
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
  - backlog/docs/doc-6 - Native-Comments.md
type: feature
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-55 emails every opted-in admin the moment a comment or webmention enters moderation, one message per item. On a busy site or during a spam wave that Akismet lets through, that is an inbox full of near-identical mail. Add a delivery mode to the "New comments" notification so a user can choose immediately (the current behaviour and the default), hourly, or daily. In a batched mode nothing is sent when an item arrives; instead a periodic job (the scheduled-posts timer from TASK-44 is the precedent for in-process periodic work) sends one `comment-digest` email per user per window listing every item that is still pending, each with its own signed approve, spam and delete links, and skips the send entirely when nothing is pending. Items moderated before the window closes are simply absent from the digest, so a digest is derived from the pending comments themselves rather than from a queue that has to survive restarts; the only new state is when each user was last sent a digest, which lives under `data/` per decision-9. The mode is a per-user setting on the users screen beside the existing switchboard, so the registry in `packages/cms/src/notifications/preferences.ts` gains the notion of a delivery mode without hard-coding the word "comments". Commenter reply notifications are unaffected and stay immediate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A user can pick immediately, hourly or daily for the New comments notification on the users screen, the choice is stored in data/users.json only when it differs from the default, and an unknown stored value falls back to immediately
- [x] #2 With hourly or daily selected, a comment entering moderation sends nothing at once, and the next digest run sends exactly one email listing every item still pending with working single-use approve, spam and delete links per item, proved with the memory mail provider and an injectable clock
- [x] #3 A digest run sends nothing to a user with no pending items, and an item approved or deleted before the run does not appear
- [x] #4 The time of each user's last digest survives a restart and a `geekity rebuild`, so a restart neither resends nor skips a window
- [x] #5 The comment-digest template ships in the packaged theme with subject, text and HTML parts and is listed in the theme README message table; doc-5 and doc-6 describe the modes
- [x] #6 Nothing is sent and nothing breaks when mail is not configured
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Registry (src/notifications/preferences.ts): add NOTIFICATION_DELIVERY_MODES ('immediately' | 'hourly' | 'daily'), DELIVERY_WINDOW_MS, and a 'batched' flag on NotificationEvent so an event declares that it supports modes. Add notificationMode(user, name), withNotificationMode(stored, name, mode), and extend notificationSwitches with the mode and the choices. Nothing hard-codes 'comments'.
2. Storage (src/admin/accounts.ts): User.notificationModes as a second map beside notifications, parsed with the same two rules (a default is not stored; an unknown event key or an unknown mode value is dropped on read and on write). Add setUserNotificationMode.
3. Users screen (src/admin/users.ts + admin/layouts/users.njk): a select plus Save beside the switch, for every event whose registry entry says it is batched, posting to a new POST /admin/users/notifications/mode. Template still loops over the registry.
4. Last-digest state (src/notifications/digest.ts): data/notification-digests.json, mode 0600, shaped { events: { <event>: { <userId>: <instant> } } }. In data/ rather than users.json because users.json is who may sign in and this is runtime bookkeeping, and in a file rather than SQLite because decision-9 makes the database disposable and geekity rebuild must not resend or skip a window.
5. Digest runner (src/notifications/digest.ts): createCommentDigest({ admin, store, mail, config, timers, tickMs, logger }) with run(), start(), stop(), settled(). run() takes every user with an address, the comments notice on, and a batched mode whose window has elapsed since their recorded digest (or who has never had one), lists admin.listComments({ status: 'pending' }), sends nothing and records nothing when that is empty, otherwise sends one comment-digest message with per-item approve/spam/delete links from moderationLink and records the instant. Timers injected the way the scheduler's are, defaulting to an unref'd setInterval.
6. Immediate path (src/notifications/comments.ts): pending() skips a recipient whose mode is batched; everyone else is unchanged.
7. Wiring (src/index.ts): build the digest, expose it as cms.digests, start it in serve() and stop plus settle it in close().
8. Templates: themes/default/mail/comment-digest.{subject,txt,html}.njk, and the row in themes/default/README.md.
9. Docs: doc-5 (users screen: delivery mode), doc-6 (notification modes), packages/cms/README.md (the notification section, the data/ table and the admin route table).
10. Tests first, at these seams: POST /admin/users/notifications/mode through the app and data/users.json on disk; a submitted comment plus cms.digests.run() through the memory mail provider; a second boot over the same dataDir for the restart rule; a fake timer for start()/stop(); and a site with no mail. Then pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Registry: NotificationEvent gains `batched: boolean`; the comments event sets it true. NOTIFICATION_DELIVERY_MODES ('immediately' | 'hourly' | 'daily'), DEFAULT_DELIVERY_MODE, DELIVERY_WINDOW_MS, DELIVERY_MODE_LABELS, isBatchedMode, deliveryMode, notificationMode and withNotificationMode live beside the existing switch helpers, and notificationSwitches now hands the users screen the mode and the choices. Nothing hard-codes 'comments'.

Storage: User.notificationModes is a second map in data/users.json rather than a widening of notifications, because the two answer different questions (whether, and how often) and a user who wants none of a notice is not a user with a window. Both are dropped on read and on write for an unknown event key, an unknown mode value, and an event that is not batched; the default is never written down.

Last-digest time: data/notification-digests.json, mode 0600, keyed { event: { userId: instant } }. A file rather than SQLite because decision-9 lets a site delete the database whenever it is stopped and a forgotten timestamp would either skip a window or resend one; its own file rather than a field in users.json because that file answers 'who may sign in' and a timestamp the sender rewrites every hour is runtime bookkeeping. Proved by a test that closes the CMS, deletes data/geekity.db the way `geekity rebuild` does, and boots again over the same directories.

Empty run: nothing pending means nothing sent and nothing recorded. Documented in the module, in doc-6 and in the package README: a user whose timestamp has not moved is still due, so the first thing that arrives goes out on the next tick, and the promise a mode makes — at most one message per window — still holds.

Digest job: src/notifications/digest.ts. createCommentDigest({ admin, store, mail, config, timers, tickMs, maxItems, logger }) with run(), start(), stop(), settled(). The timers are the shape the scheduler's are, defaulting to an unref'd setInterval on a one-minute tick; the tick is not the window, each user's own mode decides who is due. createCms builds it, exposes it as cms.digests, calls digests.start() in serve() after the scheduler and digests.stop() plus await digests.settled() in close(). One addition beyond the task text: DIGEST_MAX_ITEMS = 100 caps a single digest, with the remainder counted in a line pointing at /admin/comments, so a spam wave cannot produce a message with thousands of entries and three signed links each. It is injectable as maxItems so a test can prove it without 101 comments.

Immediate path: createCommentNotifier's pending() filters out recipients whose mode is batched. Nothing else about it changed, and commenter reply notices are untouched.

Verified from the repo root: pnpm build (ok), pnpm test (1396 pass / 0 fail in @geekity/cms, 14 pass / 0 fail in the demo), pnpm typecheck (ok), pnpm lint (ok), pnpm format:check (ok). New tests: src/notifications/digest.test.ts (17) and three cases in src/admin/users.test.ts. No dev server was started.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a per-user delivery mode to the New comments notification: as they arrive (the default), hourly or daily. The registry in src/notifications/preferences.ts gained a `batched` flag and the mode helpers, so the users screen renders a select beside the switch for any event that declares one and adding an event is still one entry; the choice is stored as `notificationModes` in data/users.json only when it differs from the default, with unknown event keys and unknown mode values dropped on read and on write. A user on a window is skipped by the immediate notice; a new in-process job (src/notifications/digest.ts, ticking on an injectable unref'd timer, started in serve() and stopped in close()) sends them one comment-digest email per window listing every comment and webmention still pending, each with its own signed approve, spam and delete links, capped at 100 items with the rest counted. A digest is derived from the pending queue rather than from a stored queue, so an item moderated before the run is absent; nothing is sent and nothing is recorded when nothing is waiting. The only new state is data/notification-digests.json (mode 0600, keyed by event then user id), a file rather than a database row so it survives a restart and `geekity rebuild`, and its own file rather than a users.json field so users.json stays about the user. Templates comment-digest.{subject,txt,html}.njk ship in the packaged theme and are listed in its README; doc-5, doc-6 and the package README describe the modes.

Verified with pnpm build, pnpm test (1396 + 14 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check, all from the repo root. The behaviour itself is proved by 17 new tests in src/notifications/digest.test.ts through the app, the memory mail provider and a movable clock — including a second boot over the same data directory with data/geekity.db deleted, a fired fake timer, and a site with no mail configured — plus three cases on the users screen in src/admin/users.test.ts.
<!-- SECTION:FINAL_SUMMARY:END -->
