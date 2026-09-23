---
id: TASK-55
title: >-
  Notifications: pending comments and webmentions to admins, reply notifications
  for commenters
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:42'
updated_date: '2026-09-05 02:51'
labels:
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-50
  - TASK-51
  - TASK-53
type: feature
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Email is what makes moderation timely. When a native comment or webmention lands in the moderation queue, email every admin who has an email address and has the notification on, with the comment, the post, and one-click links to approve, spam or delete that carry a signed single-use token so they work without a login form in the way. Do not notify for comments Akismet discarded. Commenters may tick "Notify me of replies" on the form, which stores the email with their comment (never shown) and emails them when a reply to their comment is approved, with an unsubscribe link that works without a login. Notifications are per-user preferences on the users screen: new comments, and later other events (new follower, failed delivery digest) behind the same switchboard so adding one is one line. Everything goes through the mail service and is a no-op without it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A comment entering moderation emails every opted-in admin with the content and working approve, spam and delete links that are single-use and need no login
- [x] #2 A commenter who opted in is emailed when a reply to their comment is approved, and the unsubscribe link stops further mail
- [x] #3 Per-user notification preferences are edited on the users screen and respected
- [x] #4 Comments Akismet discarded send nothing
- [x] #5 Nothing is sent and nothing breaks when mail is not configured
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New `src/notifications/` module beside `comments/` and `webmention/`: `tokens.ts` (HMAC-SHA256 links), `preferences.ts` (the event registry), `optouts.ts` (the commenter opt-out list), `comments.ts` (the two notifiers) and `routes.ts` (the one-click endpoints).
2. Tokens are signed with a secret in `data/notification-secret` (0600, minted on first use, the `comment-salt` pattern) rather than stored, so a link in an inbox survives a rebuilt cache; single use is a `spent_tokens` row (admin migration 17) keyed by the token's SHA-256 and pruned by expiry. Payload binds the action, the comment id and an expiry a week out.
3. Store: migration 17 `spent_tokens` with `spendToken`/`pruneSpentTokens`; migration 18 adds `comments.notify` so the index carries the commenter's reply opt-in the file states.
4. `data/users.json` gains an optional `notifications` map, absent rather than empty and dropped when malformed, with `setUserNotification` beside `setUserEmail`; the users screen renders one checkbox per registry entry.
5. Comment form gains a `notify` checkbox, shown only when mail is configured; the flag rides on the comment record and the file entry beside the email that is already stored there.
6. Notify on the pending queue from the comment endpoint and from webmention verification (which learns to say whether it created the entry, so a re-sent webmention does not notify twice); notify a parent's author when a reply is approved, from the moderation screen, the admin reply form and an auto-approved submission.
7. `/_geekity/moderate` and `/_geekity/unsubscribe`: GET renders a small confirm page, POST performs the action, so an email client that prefetches links cannot moderate the site. Unsubscribe is site-wide by address, written to `data/comment-optouts.json`.
8. New `comment-pending` and `comment-reply` templates under `themes/default/mail/`, added to the theme README table.
9. Docs: doc-5 (users screen preferences, the one-click links) and doc-6 (the notify flag, the notifications, the opt-out) via `backlog doc update`; package README where mail is documented.
10. Tests first, at the HTTP seams: the comment endpoint, the moderation links, the reply notice and its unsubscribe, the users screen, an Akismet discard, and a site with no mail.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed the machinery: signed HMAC link tokens in `src/notifications/tokens.ts` with the secret in `data/notification-secret`; a `spent_tokens` ledger and a `comments.notify` column in admin migration 17; the event registry and per-user preferences (`notifications` in `data/users.json`, `setUserNotification`); the two notices in `src/notifications/comments.ts`; the `/_geekity/moderate` and `/_geekity/unsubscribe` landing pages; and `src/comments/moderate.ts`, which both the moderation screen and the one-click links now go through so they cannot disagree about the spam-checker reports.

One fix outside the strict scope was essential: the mail templates rendered the subject and the plain text body through an autoescaping Nunjucks environment, so the `&` between two query parameters became `&amp;` and a one-click link was unusable (and an apostrophe in a name came out as `&#39;` in every message this package sends). `createMailTemplates` now renders those two halves through a twin environment with autoescaping off, and `MailTemplates` exposes it as `plainEnvironment`.

Verification from the repo root, all green: `pnpm build` (exit 0), `pnpm test` (1340 + 11 tests, 0 failing), `pnpm typecheck` (exit 0), `pnpm lint` (exit 0), `pnpm format:check` ("All matched files use Prettier code style").

The evidence per criterion:
- AC #1 — `src/notifications/comments.test.ts`, "a comment waiting for a moderator": a submitted comment mails the opted-in admin with the post, the author and the words; the message carries approve, spam and delete links; each link is inert on GET, acts on the confirmed POST with no session anywhere, and is refused on a second use and for a forged token.
- AC #2 — same file, "telling a commenter about a reply": Grace ticks the box, hears nothing until the reply is approved, then gets the reply and an unsubscribe link; using it stops the next one. `src/admin/comments.test.ts` covers the same notice from the moderation screen's Approve and from its Reply box.
- AC #3 — `src/admin/users.test.ts`, "notification preferences": a switch per registry entry renders, defaults on, stays off once turned off, and an unknown event name writes nothing.
- AC #4 — "a comment the checker threw away": a `discard` verdict stores nothing and sends nothing; a `spam` verdict stores it as spam and still sends nothing. `src/webmention/receive.test.ts` adds that a re-sent webmention notifies nobody a second time.
- AC #5 — "a site with no mail configured": the comment is taken and queued, nothing is sent, and the reply opt-in is not even recorded; the box is absent from the form.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A comment or webmention entering the moderation queue now emails every user who has an address and has not turned the notice off, with the comment, the post, and approve, spam and delete links that need no login. Each link is an HMAC-signed claim rather than a stored row — the secret is `data/notification-secret`, so a link in an inbox survives a rebuilt cache — bound to one action on one comment, expiring after a week, and spent once against the new `spent_tokens` table (admin migration 17). Every link lands on a page with a button and only the button acts, so a mail scanner that follows links cannot moderate the site. Nothing is sent for a comment Akismet filed as spam or told the site to discard, and a webmention re-sent by an edited page notifies nobody twice.

Commenters can tick "email me when somebody replies", offered only when the site can send mail; it rides as `notify` on the comment entry beside the address already stored there, and neither is rendered in the thread, the JSON or Markdown representations, or the comments feeds. One message goes when a reply is approved — from the public form, the moderation screen or a one-click link — carrying a signed unsubscribe that is site-wide by address into `data/comment-optouts.json`.

Preferences are a switchboard keyed by event name in `src/notifications/preferences.ts`, rendered per row on `/admin/users` and stored in `data/users.json` only when somebody turns one off, so the next event is one entry in the registry. Both doors onto moderation now go through one `moderateComment`, so the screen and the links cannot disagree about the spam checker's corrections.

Verified with `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` from the repo root — all pass, 1351 tests, none failing — and by the HTTP-level tests named in the implementation notes, which exercise the form, the mail service, the links and the users screen end to end with the in-memory mail provider.
<!-- SECTION:FINAL_SUMMARY:END -->
