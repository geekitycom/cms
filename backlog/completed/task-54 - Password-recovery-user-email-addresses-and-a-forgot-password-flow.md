---
id: TASK-54
title: 'Password recovery: user email addresses and a forgot-password flow'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:42'
updated_date: '2026-09-05 02:21'
labels:
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-9
  - TASK-15
  - TASK-53
references:
  - backlog/docs/doc-5 - Admin-UI.md
  - >-
    https://owasp.org/www-project-cheat-sheets/cheatsheets/Forgot_Password_Cheat_Sheet.html
type: feature
ordinal: 50500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Users have a username and a password hash and nothing else, so a forgotten password means `geekity user add` from a shell. Give each user an optional email address, edited on the users screen and by the user for their own account, and set by `geekity user add --email`. Add a Forgot password link on the login form leading to a form that takes a username or email and always answers the same way whether or not it matched. When it matches a user with an email, send a single-use reset link with a random token that expires in an hour, stored hashed with the sessions in the cache (a restart invalidates it, which is acceptable). The reset form sets a new password under the existing rules, invalidates the token and every other session for that user, and emails a confirmation. Requests are rate limited like login (TASK-47). Without mail configured, the link says recovery is not available and points at the CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A user can be given an email on the users screen and via geekity user add --email, and it is stored with the user
- [x] #2 The forgot-password form answers identically for a known and an unknown username, and sends a reset link only when a user with an email matches
- [x] #3 The reset link works once, expires after an hour, sets the password, signs out the user's other sessions and sends a confirmation
- [x] #4 Repeated recovery requests are rate limited
- [x] #5 With no mail configuration the form explains that recovery is unavailable and how to reset from the CLI
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Seams under test: accounts.ts (the users file), the admin HTTP surface through the __testing__ browser harness, AdminStore's reset-token methods, and cli.ts parseArgs/user add. Mail is observed through createMemoryMailProvider.

1. RED/GREEN: optional email on a user. accounts.ts gains `email` on User/StoredUser, parsed out of data/users.json, `createUser({ email })`, `setUserEmail()` and `findUserByIdentifier()` (username exact, email case-insensitive). `emailProblem()` joins credentials.ts beside usernameProblem/passwordProblem, reusing EMAIL_PATTERN.
2. RED/GREEN: the users screen shows an Email column and a per-row save form; the add form takes an email. Email is not a credential, and with one role every user is already an admin, so any row is editable.
3. RED/GREEN: `geekity user add --email <address>` — parseArgs carries it, the command validates it and stores it.
4. RED/GREEN: reset tokens in the cache. Admin migration 16 adds `password_resets` (token_hash PRIMARY KEY, user_id, created_at, expires_at). The token is 32 random bytes hex; only its SHA-256 is stored, so the database never holds a usable link. AdminStore gains createPasswordReset / getPasswordReset / deletePasswordReset / deletePasswordResetsForUser / prunePasswordResets.
5. RED/GREEN: GET/POST /admin/forgot, mounted where login is (unauthenticated, inside the guard's CSRF check and the admin security headers). One answer for every request, matched or not; a match with an email queues the `password-reset` message with a link expiring in an hour.
6. RED/GREEN: GET/POST /admin/reset?token=… — an invalid or expired token says so and offers the forgot form again; a good one sets the password under passwordProblem's rules, deletes every reset for that user, ends every session that user has, and sends `password-changed`.
7. RED/GREEN: recovery is rate limited with the TASK-47 throttle, as its own instance so a flood of recovery requests cannot lock somebody out of logging in.
8. RED/GREEN: with mail.configured() false the forgot page explains recovery is unavailable and points at `geekity user add`.
9. Templates: admin/layouts/forgot.njk and reset.njk; themes/default/mail/password-reset.* and password-changed.*.
10. Docs: doc-5 via `backlog doc update`, plus the READMEs where `geekity user add` and the users screen are described.
11. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first, one slice per red/green cycle.

**The user record.** `User` gains an optional `email`, absent from `data/users.json` rather than empty when nobody has set one, so a user with no address has no key for one and `listUsers` still deep-equals what `createUser` returned. `accounts.ts` gains `setUserEmail()` (the empty string removes it) and `findUserByIdentifier()`, which matches a username exactly — the way logging in does — and an email case-insensitively, username first. A malformed `email` in the file is dropped rather than refused: unlike a username or a hash it is not what anybody signs in with, and an admin that would not load over a mistyped address would be the worse failure. `emailProblem()` joins `credentials.ts` beside `usernameProblem`/`passwordProblem`, reusing the settings screen's `EMAIL_PATTERN`.

**Editing it.** `/admin/users` grew an Email column with an inline form per row posting to `/admin/users/email`, plus an optional field on the add form and on `geekity user add --email`. Any row is editable, not only your own: with one role every user already has every power, including deleting somebody and adding them back, and TASK-55 needs an address on each admin. A refusal is a flash and a redirect rather than a redrawn form, because what was typed lives in a table row.

**Where the token lives.** Admin migration 16 adds `password_resets (token_hash PRIMARY KEY, user_id, created_at, expires_at)` beside the sessions. The token is 32 random bytes hex (`randomToken`, the same one session ids use); only its SHA-256 is stored, so a copy of `geekity.db` is not a stack of working links. Plain SHA-256 rather than argon2 on purpose: there is no guess to slow down against 256 random bits. `AdminStore` gains createPasswordReset / getPasswordReset / deletePasswordReset / deletePasswordResetsForUser / prunePasswordResets, with `getPasswordReset` deleting an expired row on the way past exactly as `getSession` does.

**The flow.** New module `src/admin/recovery.ts` with `GET|POST /admin/forgot` and `GET|POST /admin/reset`, mounted from `routes.ts` beside the login form and named in the guard's anonymous set, so both are unauthenticated but still inside the CSRF check and the admin security headers. The forgot form renders one constant sentence (`RECOVERY_ANSWER`) whatever it found; the send is dropped with `void` rather than awaited, so a match and a miss do the same work on the request. The reset form validates the token before the password rules, so a refused form never spends a link; success sets the password, deletes every reset that user had, ends every session they had, sends `password-changed` and redirects to the login form with a flash.

**Rate limiting.** A second `createLoginThrottle` instance, same limits and same keys, deliberately not the login one — sharing would let a stranger lock somebody out of signing in by flooding recovery requests. Every request is counted, matched or not, so the lockout cannot become the answer the page refuses to give.

**Without mail.** `mail.configured()` is read per request, so the page has no form at all with nothing to send: it says so and points at `geekity user add`, and a credential saved on the settings screen turns it on for the next visitor with no restart.

Verified from the repo root: pnpm build, pnpm test (1302 package tests + 11 demo tests, 0 failures), pnpm typecheck, pnpm lint and pnpm format:check all pass.

Acceptance criteria and the tests that prove them:
- #1 accounts.test.ts 'a user with an email address (AC #1)' (3 cases), users.test.ts 'a user email address (AC #1)' (3 cases over the HTTP screen), cli.test.ts 'stores --email on the user it creates (AC #1)' and 'refuses an --email that is not an address'.
- #2 recovery.test.ts 'the forgot-password form (AC #2)': the two answers are compared byte for byte after masking the CSRF token and the CSP nonce, for a known name, an unknown name and a user with no address; the memory mail provider shows exactly one message, addressed to the account that exists.
- #3 recovery.test.ts 'the reset link (AC #3)': the password changes, the old one stops working, a second browser's session is ended, the link is refused the second time, an invented token and an expired one are both refused with a 400 and change nothing, the password rules and the confirmation are enforced without spending the link, a wrong CSRF token is a 403, and provider.sent[1] is the password-changed confirmation with no token in it. store.test.ts 'password reset tokens (AC #3)' pins the hour, the single use, the sweep and that the raw token never reaches the database.
- #4 recovery.test.ts 'repeated requests (AC #4)': the fourth request at loginAttempts=3 answers 429 with Retry-After: 900 and sends nothing, and five recovery requests leave the account able to sign in.
- #5 recovery.test.ts 'a site that sends no email (AC #5)': the page names geekity user add and renders no form, a posted request still answers identically for a known and an unknown name, and saving an SMTP credential turns the form on with no restart.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave every user an optional email address and built password recovery on top of it. data/users.json now carries an email per user, edited inline on any row of /admin/users, on the add form, and by geekity user add --email; accounts.ts gained setUserEmail and findUserByIdentifier, and credentials.ts gained emailProblem. A new src/admin/recovery.ts mounts /admin/forgot and /admin/reset beside the login form — unauthenticated but inside the guard's CSRF check and the admin security headers — answering with one constant sentence whatever it found, sending the theme's new password-reset message with a single-use link that expires in an hour, and on use setting the password under the existing rules, cancelling every other reset, ending every session that user had and sending password-changed. Admin migration 16 stores only each token's SHA-256 in password_resets beside the sessions, so a copy of the cache is not a stack of working links. Recovery requests are throttled with the TASK-47 machinery on an instance of its own, so a flood cannot lock somebody out of logging in. With no mail configured the page offers no form and points at geekity user add. Verified with pnpm build, pnpm test (1302 + 11 tests, 0 failures), pnpm typecheck, pnpm lint and pnpm format:check, and by 15 new end-to-end tests in recovery.test.ts plus new cases in accounts, users, credentials, store and cli tests.
<!-- SECTION:FINAL_SUMMARY:END -->
