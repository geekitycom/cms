---
id: TASK-56
title: >-
  Contact form: a spam-protected page form that emails the admin and keeps a
  copy
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:42'
updated_date: '2026-09-05 03:16'
labels:
  - web
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-52
  - TASK-53
type: feature
ordinal: 51500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A page may carry `contact: true` in its front matter (editor checkbox) to render a contact form below its content: name, email, subject, message. Submissions are protected the way comments are (honeypot, minimum submit time, per-address rate limit, and Akismet with `comment_type` `contact-form` when configured), then emailed to the site's contact address (a setting, defaulting to the first admin with an email) with reply-to set to the sender, and stored as a file under `data/contact/` so a message survives a mail outage; an admin Messages screen lists them with read and delete. The form works without JavaScript, shows a thank-you page, and never reveals the destination address. Without mail configured, submissions are still stored and the admin screen shows them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A page with contact: true renders the form and a submission emails the contact address with reply-to set to the sender, proved against the stubbed mail service
- [x] #2 Every submission is stored under data/contact and listed on the admin Messages screen with read and delete, including when mail is not configured
- [x] #3 The honeypot, minimum submit time, rate limit and Akismet contact-form check each reject a submission in tests
- [x] #4 The form works without JavaScript and shows a thank-you page; the destination address never appears in the HTML
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extract the shared public-form defences into src/forms/protection.ts: the honeypot field name, MINIMUM_SUBMIT_SECONDS, MAXIMUM_FORM_AGE_SECONDS, formAgeSeconds/formTimingRefusal, and the salted hashClientAddress with its comment-salt file. comments/submission.ts re-exports them so every existing import and the package index keep working, and the comment tests stay green.
2. Widen the CommentChecker seam by one optional field: CommentSubmission.type, which Akismet sends as comment_type. It defaults to the source (comment / webmention) and lets a contact message be checked as contact-form without a second seam.
3. New src/contact/ module, files-are-truth (decision-9), no SQLite index and no migration:
   - form.ts: CONTACT_FIELDS, ContactFormContext, CONTACT_POST_PATH (/_geekity/contact), the notice query and its messages.
   - records.ts: data/contact/<received>-<id>.json, one JSON file per message; list, read, mark read, delete.
   - submission.ts: submitContactMessage - honeypot, minimum submit time, per-address rate limit (createLoginThrottle keyed contact:<address>), then the checker with comment_type contact-form; stores accepted and spam-verdict messages, stores nothing for a honeypot/too-quick/rate-limited/discard refusal.
   - delivery.ts: contactRecipient (the contactEmail setting, else the first admin with an email) and the contact-message send with replyTo set to the sender.
   - routes.ts: mountContact, POST only, 303 back to the page with ?contact=sent so a refresh posts nothing twice.
4. Public rendering: contact: true front matter key on a page (CONTACT_FRONT_MATTER_KEY), a contactForm injection on the renderer beside commentForm, layouts/page.njk includes partials/contact-form.njk, and the thank-you replaces the form on the page the redirect lands on. The destination address is never in the context, so it can never be in the HTML.
5. Editor: a Contact form checkbox on pages (kind.contactable), writing and removing the front matter key exactly as navigation: true does.
6. Settings: contactEmail on SiteSettings, site.json, the form and the settings screen, validated as an address when it is not empty.
7. Admin Messages screen at /admin/messages: Inbox and Spam tabs, mark read / mark unread, delete, a nav entry, and the unread count on the dashboard.
8. Templates: themes/default/partials/contact-form.njk, mail/contact-message.{subject,txt,html}.njk, admin/layouts/messages.njk, plus the theme README's message table and a contact form section.
9. Docs: doc-5 (Messages screen, the contact setting), doc-2 (the contact front matter key), the package README, and the demo site if it names comparable features.
10. Test-first throughout: src/contact/site.test.ts for the public form and the four rejections, src/contact/records.test.ts for the file shape, src/admin/messages.test.ts for the screen, all node:test through the app with a memory mail provider.
11. Verify with pnpm build, test, typecheck, lint, format:check and test:11ty.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned, with three decisions worth recording.

**Files are the only truth, with no SQLite index.** A message is one JSON file under `data/contact/<id>.json` at mode 0600, named by an id that begins with the compacted instant it arrived (`20260920T120000000Z-1a2b3c4d`), so `ls` is the inbox in order and two messages in one millisecond cannot collide. The Messages screen reads the directory to sort it anyway, so an index would only be a second thing to keep true; migration 18 is still unused. Messages live under `data/` rather than `content/` because they carry the sender's address and `content/` is published. The file is written **before** anything is emailed, which is the point: a provider that is down costs a notification rather than the message.

**What is stored and what is not.** Accepted messages are stored as `status: received`; a checker's `spam` is stored too, as `status: spam`, on a Spam tab of its own and never emailed on — a false positive on a contact form is somebody's message vanishing, which is worse than a list to glance at. Nothing at all is stored for a honeypot, too-quick, stale, rate-limited or `discard` refusal: those are machine traffic, and storing them would hand an anonymous caller a way to fill the disk. Documented on the Messages screen, in doc-5, and in the package README.

**The defences are shared rather than copied.** New `src/forms/protection.ts` holds the honeypot field name, the minimum submit time, the maximum form age, `formTimingRefusal` and the salted `hashClientAddress` with its `comment-salt` file; `comments/submission.ts` now imports them and re-exports the four public names from where they used to live, so no import anywhere else changed and the 88 comment tests stayed green through the refactor. The rate limit is `createLoginThrottle` from `admin/throttle.ts`, keyed `contact:<address>`, the same limiter the login and comment forms use. The spam seam was widened by one optional field — `CommentSubmission.type` — which Akismet sends as `comment_type`; a contact message names itself `contact-form`, and a site's own `commentChecker` sees everything the public can post at it without a second seam.

**Verification.** From the repo root: `pnpm build` (ok), `pnpm test` (1372 tests, 1372 pass, 0 fail, plus the demo suite 11/11), `pnpm typecheck` (ok), `pnpm lint` (ok), `pnpm format:check` (clean after one `pnpm format`), and `pnpm test:11ty` (15/15 and 5/5) — the last because a new front matter key and a new theme partial could have moved the Eleventy compatibility suite, and did not.

New tests: `src/contact/site.test.ts` (18 cases through the app), `src/admin/messages.test.ts` (8 cases through a signed-in browser), three editor cases in `src/admin/pages.test.ts`, two settings cases in `src/admin/settings.test.ts`, and one in `src/comments/akismet.test.ts` pinning `comment_type: contact-form` against a stubbed Akismet.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A page carrying `contact: true` now renders a contact form under its content — name, email, subject, message, no JavaScript — which posts to `/_geekity/contact` and redirects back to the page with `?contact=sent`, where the theme draws a thank-you in place of the form so a refresh sends nothing twice. Where the message goes is read when a submission arrives and is never on a render context, so it cannot reach the HTML however a theme is written.

Every message that survives the defences is written to `data/contact/<id>.json` at mode 0600 before anything is emailed, then sent to the `contactEmail` setting — or, empty, to the first admin with an address — through the theme's new `contact-message` template with reply-to set to the sender. With no mail configured the message is still stored and still listed. `/admin/messages` is the inbox: Inbox and Spam tabs, mark read and unread, delete, a nav entry, and the unread count on the dashboard.

The four defences are the comment form's own, shared rather than copied: `src/forms/protection.ts` now holds the honeypot, the form-age rules and the salted address hash, `comments/submission.ts` re-exports them from where they used to live, the rate limit is the login throttle keyed by address, and the `CommentChecker` seam gained one optional `type` field so a contact message is checked as Akismet's `contact-form`.

Verified with `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` and `pnpm test:11ty`, all passing: 1372 package tests including 18 new ones over the public form in `src/contact/site.test.ts` (each of the four rejections has its own), 8 over the Messages screen in `src/admin/messages.test.ts`, three over the editor checkbox, two over the setting, and one pinning `comment_type: contact-form` against a stubbed Akismet. doc-5 gained a Messages section and the contact address, doc-2 the `contact` front matter key, doc-6 a note about the shared seam, and the package and theme READMEs the whole feature.
<!-- SECTION:FINAL_SUMMARY:END -->
