---
id: TASK-15
title: 'Users screen: list, add, change password'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 04:11'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-10
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Single admin role. /admin/users lists users; admins can add a user with a generated or supplied password and change their own password. Deleting the last user is refused.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An admin can add a user who can then log in
- [x] #2 Changing a password invalidates other sessions for that user
- [x] #3 Deleting the last remaining user is refused with a message
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test: the HTTP surface through `app.request` and the cookie-keeping `Browser` from `src/admin/__testing__/harness.ts` (GET /admin/users, POST /admin/users, POST /admin/users/password, POST /admin/users/delete), and the three new `AdminStore` methods. New colocated node:test file `src/admin/users.test.ts`, plus additions to `src/admin/store.test.ts`.

2. Store. Three methods on `AdminStore`, no migration: `setPassword(userId, password)` (hashes and updates, false when there is no such user), `deleteUser(userId)` (false when there is none), and `deleteSessionsForUser(userId, { except? })` returning how many went. The connection already runs `PRAGMA foreign_keys = ON`, so a deleted user's sessions go with the row; a test pins that rather than trusting the pragma.

3. `src/admin/users.ts` beside `settings.ts`: `mountUsers(app, { render })`, the paths, the field names, the validators and a `generatePassword()`. Four routes — the screen, add, change own password, delete — and `'users'` joins the built set in `routes.ts` so the placeholder loop skips it.

4. Add a user. Username and password validated by the shared `credentialProblem`, so an account made here is one `/admin/setup` and `geekity user add` would have accepted. A `generate` checkbox makes the password server-side from `randomBytes` over an unambiguous alphabet (no 0/O/1/l) and shows it once in the flash, which lives on the session row rather than in a URL or a cookie. A duplicate name is a 400 that re-renders with what was typed.

5. Change own password. Current password verified through `verifyPassword` before anything is written; the new one checked by `passwordProblem` and against its confirmation. On success `setPassword` then `deleteSessionsForUser(user.id, { except: session.id })`, so every other browser holding that login is signed out and the one doing the changing is not (AC #2).

6. Delete. A POST naming a user id. Two refusals, in this order: the last remaining user (AC #3) and yourself — the screen only renders a button for other users, and deleting your own account would log you out of the admin you are standing in. Both are a flash and a redirect, not a 400, because nothing was typed.

7. Validation errors re-render the screen with a 400 and the submitted values, one message under each field, using the existing `.admin-field-error` and `.admin-settings` rules; nothing is written on any of those paths.

8. `admin/layouts/users.njk`, `ADMIN_TEMPLATES.users`, whatever `admin.css` needs, and the barrels. Document the screen in the root README beside Site settings, update the packages/cms README admin route table, and point the CLI 'Creating an admin from the command line' section at it.

9. Verify: package test/typecheck/lint, root lint/typecheck/test/test:11ty/format:check, then a manual curl pass against apps/demo — add a user and log in as them in a second cookie jar, change ada's password and watch the other jar get redirected to the login while the changing jar stays in, and try to delete down to the last user — restoring apps/demo to its committed state and releasing port 3000 afterwards.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Progress

New files: `src/admin/users.ts` (the paths, the field names, `addUserProblems`, `changePasswordProblems`, `deleteUserRefusal`, `generatePassword` and the four routes), `src/admin/users.test.ts`, `admin/layouts/users.njk`. Changed: `src/admin/store.ts` (`setPassword`, `deleteUser`, `deleteSessionsForUser`; no migration), `src/admin/store.test.ts`, `src/admin/routes.ts` (`mountUsers`, 'users' in the built set), `src/admin/templates.ts`, `admin/static/admin.css`, the two barrels, the root README (a new Users section) and `packages/cms/README.md` (the admin route table, the admin prose, and a pointer from the CLI section).

Package `pnpm test` 473 pass (454 before; 19 new — 13 in users.test.ts, 6 in store.test.ts).

## Decisions

- **No migration.** Everything the screen needs is a statement over the tables migration 1 created. `sessions.user_id` already carries `ON DELETE CASCADE` and the admin connection already runs `PRAGMA foreign_keys = ON`, so a deleted user's sessions go with them — pinned by a test rather than trusted, and mutation-checked by turning the pragma off.
- **`deleteSessionsForUser(userId, { except })` uses `IS NOT`, not `<>`.** With `<>` a missing `except` would compare against NULL and match nothing, so the no-op call would silently spare everything instead of sparing nothing.
- **A password change ends every other session and spares this one.** The reason to change a password is usually that somebody else may have it, and a change that left the other browsers signed in would not have fixed anything; signing out the browser doing the changing would be a worse form of the same bug. The flash says how many went.
- **Changing somebody else's password is not offered.** One role means a row has nothing to edit, and a reset-from-under-them button would make the current-password check decorative. A fresh account is the honest way to hand somebody a login.
- **Two refusals on delete, in this order: the last remaining user, then yourself.** The last-user check is first so a one-user site gets the message about the site rather than the one about the account. Both are a flash and a 303 rather than a 400, because nothing was typed to send back, and the table renders a Delete button only for rows that pass both, so the screen never offers an action it is about to refuse.
- **A generated password is shown once, in the flash.** `randomInt` over an alphabet with no 0/O or 1/l — it is read off a screen and typed somewhere else — 20 characters, about 116 bits. The flash lives on the session row, so it is never in a URL, a cookie or a history, and it is never stored in the clear.
- **The add form's rules are the shared `credentialProblem` pieces**, so an account made here is one `/admin/setup` and `geekity user add` would both have accepted. When the generate box is ticked the password field is not read at all, so a stale value in it cannot be what is refused.
- **A bad password form echoes nothing back.** Every field on it is a password, and a password does not belong in rendered HTML. The add form does keep the username that was typed.

## Mutation checks

Each of these failed exactly the tests that name that behaviour and nothing else:

- The other-session sweep removed, and the sweep with `except` dropped -> only 'signs out every other session and keeps this one (AC #2)'.
- `deleteUserRefusal` returning undefined -> both delete-refusal tests.
- `addUserProblems` returning {} -> both bad-add-form validation tests.
- `changePasswordProblems` returning {} -> both bad-password-form tests.
- The flash showing a freshly generated password instead of the stored one -> only 'generates a password on request and shows it once'.
- `PRAGMA foreign_keys = OFF` -> the store's cascade test and the HTTP delete test.
- `setPassword` made a no-op -> the two store tests and 'replaces the password, so only the new one logs in'.

## Manual pass against apps/demo, over curl

On port 3000 (`pnpm dev`), with several cookie jars.

- **The screen.** Signed in as `ada`: the table listed `ada <span class="admin-status">(you)</span>` with an empty Actions cell, because she was the only user and the button is not rendered for a row that cannot be deleted.
- **AC #1.** `POST /admin/users` with `grace` and a password: 303 to `/admin/users`, flash 'Added grace.', a Delete button appeared on her row — and a second cookie jar logged in as `grace` through `/admin/login` (303) and `GET /admin` rendered 'Signed in as grace'.
- **The generated password.** `username=alan&generate=1` (no password field at all): flash 'Added alan. Their password is e6QGBy74QQb4uGoZFBby — copy it now, it is not shown again.' A third jar logged in as `alan` with exactly that string, and the next `GET /admin/users` no longer carried it — shown once.
- **AC #2.** A fourth jar signed in as `ada` as well; `GET /admin` on it was 200. The first jar then changed ada's password: 303, flash 'Your password was changed, and 7 other sessions were signed out.' `GET /admin` was then 200 on the jar that changed it, 302 to `/admin/login` on the other ada jar, and still 200 on alan's jar — another user's sessions are not touched.
- **A wrong current password:** 400 with 'That is not your current password.' under the field, and `grep -c 'another password'` on the response was 0 — no password is echoed back into the HTML. The old password still worked afterwards.
- **Self-deletion.** With grace and alan still there, deleting `user_id=1` was refused: 'You cannot delete your own account. Another admin can do it for you.', and ada was still in the table.
- **Deleting, and the cascade.** Deleted `grace` and `alan`; both flashes read 'Deleted <name>.', both rows went, and both of their cookie jars went from 200 to 302 -> `/admin/login` on the very next request.
- **AC #3.** With ada the only user left the screen rendered no Delete button at all, and posting `user_id=1` anyway was refused with 'ada is the only user. Add another before deleting this one.' She was still there afterwards.
- **Bad add forms.** `grace hopper` -> 400, 'A username is 1 to 64 letters, digits, dots, dashes or underscores.', and `value="grace hopper"` still in the field. `password=short` -> 400, 'A password is at least 8 characters.' Neither wrote anything.
- **CSRF.** `POST /admin/users` with a session cookie but no token: 403, nobody created.

Afterwards ada's password was changed back through the form and confirmed by a fresh login (303), every user this pass added was deleted, the leftover session rows were cleared, and `git status apps/demo` is clean. `pkill -f 'pnpm dev'` then `lsof -ti :3000`: port free, nothing answering, no `tsx watch` left.

## Validation

Package `pnpm test` 473 pass, 107 suites, 0 failures (454 before). `pnpm typecheck` (both projects) and `pnpm lint` clean. Root `pnpm lint`, `pnpm typecheck`, `pnpm test` (473 + 10), `pnpm test:11ty` (6 + 5) and `pnpm format:check` all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the users screen doc-5 asks for, and the three store methods behind it.

`/admin/users` is the list, an add form, and a change-password form for whoever is signed in. There is one role, so a row has no fields to edit: an admin adds a user, deletes another, and changes their own password. Adding enforces exactly the rules `/admin/setup` and `geekity user add` do, through the same `credentialProblem`; tick 'generate' and the password is made server-side from `randomInt` over an alphabet with no 0/O or 1/l and shown once in the flash, which lives on the session row and so never reaches a URL, a cookie or a history. It is never stored in the clear.

Changing your own password asks for the current one first, then ends every other session that login has and spares the one submitting the form — the reason to change a password is usually that somebody else may have it, and a change that left the other browsers signed in would not have fixed anything. Deleting a user takes their sessions with them: `sessions.user_id` already cascades and the admin connection already runs `PRAGMA foreign_keys = ON`, so no migration was needed. Two deletions are refused, in this order — the last remaining user, because a site with none falls back into first-run setup, and your own account, because it would end the session doing the deleting — and the table renders a Delete button only for rows that pass both, so the screen never offers an action it is about to refuse. A form with a problem is a 400 that re-renders with one message per field and writes nothing; the add form keeps the username that was typed and the password forms keep nothing, because a password does not belong in rendered HTML.

The store gained `setPassword`, `deleteUser` and `deleteSessionsForUser(userId, { except })` — the last using `IS NOT` rather than `<>`, so a call with no `except` spares nothing instead of matching nothing.

Verified with 19 new node:test tests (13 through `app.request` on the admin harness), every one mutation-checked: removing the other-session sweep, the sweep's `except`, either validator, the delete refusals, `setPassword` and the `foreign_keys` pragma each failed exactly the tests that name that behaviour. Then a curl pass against the running demo covering all three criteria — a user added and logged in from a second cookie jar (AC #1); ada's password changed from one jar while a second ada jar was redirected to the login and the changing jar stayed 200, with alan's jar untouched (AC #2); and, once ada was the only user left, no Delete button rendered and a posted delete refused with 'ada is the only user' (AC #3) — plus the generated password proven to be the real one, the cascade proven by two deleted users' jars going 302 on the next request, self-deletion refused, both bad forms 400 with nothing written, and a POST without a CSRF token 403. The demo was restored (ada back on her original password, every added user and leftover session row gone, `git status apps/demo` clean) and port 3000 released.

`pnpm test` (473 pass), `typecheck` and `lint` in the package, and root `lint`, `typecheck`, `test`, `test:11ty` and `format:check` all pass. The root README has a new Users section and `packages/cms/README.md` has the routes, the prose and a pointer from the CLI's user-add section.
<!-- SECTION:FINAL_SUMMARY:END -->
