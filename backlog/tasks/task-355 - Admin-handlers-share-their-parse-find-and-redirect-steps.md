---
id: TASK-355
title: 'Admin handlers share their parse, find and redirect steps'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 23:25'
labels: []
milestone: m-33
dependencies:
  - TASK-354
type: chore
ordinal: 314800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
users.ts has 8 POST handlers that each parse the body, find the user by id, and flash "That user is already gone." then redirect. media, plugins and federation repeat the shape. accounts.ts has 7 users.json mutators with the same let changed = false; write(...map...) bookkeeping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User routes resolve the target user through one shared step that owns the gone-user flash and redirect
- [x] #2 users.json mutators go through one update-user function; each setter only states its transform
- [x] #3 Flash wording and status codes for every existing admin POST are unchanged, shown by the existing tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first for an exported updateUser(dataDir, userId, change) in admin/accounts.ts: found returns true and writes the change, not-found returns false and writes nothing, a change key set to undefined removes that key from the file, others untouched.
2. Build updateUser: one write that applies a patch to the user with that id; undefined values drop the key. Hono-free so TASK-364 can move it with the file.
3. Rewrite setUserPassword, setUserEmail, setUserProfile, setUserNotification, setUserNotificationMode, setUserAdminTheme as one-line transforms over updateUser. setUserActorId resolves the id by username and goes through updateUser too, with the conflict check inside the queued change. createUser and deleteUser add/remove whole entries and keep their own write.
4. Add route tests in users.test.ts asserting 303, Location /admin/users and the exact 'That user is already gone.' flash for email, profile, notifications and notification mode POSTs with an unknown id.
5. Extract one users.ts step (targetUser) that parses the body, resolves user_id, flashes the gone message and redirects; use it in the four handlers. Delete keeps deleteUserRefusal (its refusals are ordered); theme and change-password resolve the session user, not a form id.
6. Media, plugins and federation: plugins already share confirmed/submittedName/refuse; media has two path-resolving handlers and federation two unrelated ones, under the three-handler bar, so no extraction there.
7. Verify with pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: updateUser(dataDir, userId, change) in admin/accounts.ts, Hono-free. change returns a UserChange patch (Partial of StoredUser minus id/username/createdAt); a key set to undefined comes off the file because JSON.stringify drops it. change also gets everyone in the file so setUserActorId's uniqueness rule stays inside the queued write. setUserPassword, setUserEmail, setUserProfile, setUserNotification, setUserNotificationMode, setUserAdminTheme and setUserActorId all go through it. createUser (appends) and deleteUser (filters) keep their own write: they add or remove entries rather than change one.
users.ts: namedUser(c) parses the body, resolves user_id and owns the gone-user flash + 303 to /admin/users; used by the email, profile, notifications and notification-mode POSTs. deleteUserRefusal reuses the same GONE_USER string. Theme and change-password resolve the session user, not a form id, so they keep their own lookup.
Media (2 path-resolving handlers), federation (2 unrelated) are under the three-handler bar; plugins already share confirmed/submittedName/refuse. Left as is.
Tests: 4 updateUser cases in accounts.test.ts (found, current-user transform, not found writes nothing and never calls change, undefined removes the key); 8 route cases in users.test.ts asserting 303, Location /admin/users and the exact 'That user is already gone.' flash for the 4 POSTs with user_id 404 and a non-number. Route tests passed before and after the refactor.
Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all pass (cms 5557 tests).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Users.json setters now state only their transform through one updateUser function in admin/accounts.ts, and the four user-id POST handlers in admin/users.ts resolve their target through one namedUser step that owns the 'That user is already gone.' flash and 303 to the list. No flash wording or status code changed; new route tests pin them for every gone-user path, and new unit tests cover updateUser found, not found and key removal. Verified with pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
