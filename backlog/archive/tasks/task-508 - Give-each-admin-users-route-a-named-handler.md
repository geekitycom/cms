---
id: TASK-508
title: Give each admin users route a named handler
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 12:15'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 419800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/admin/users.ts:180 mountUsers is ~344 lines registering 9 routes whose handlers each parse, validate, save, flash and redirect. The flash-then-redirect tail repeats about 7 times and the target-user lookup plus instanceof Response guard repeats in several handlers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 mountUsers only wires routes to named handler functions
- [x] #2 Flash-and-redirect and loading the target user each go through one shared helper
- [x] #3 Admin users screens behave the same: admin/users tests pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the admin users tests (users, admin-theme, form-errors, fields, menu, federation, delivery) are green before touching anything.
2. Add flashAndRedirect(c, kind, message, location) to admin/flash.ts beside flash(), so any admin screen can import it; only users.ts call sites change in this task.
3. In admin/users.ts, move each route body out of mountUsers into a named top-level handler (showUsers, showAddUser, addUser, changePassword, saveEmail, saveProfile, saveNotification, saveNotificationMode, saveTheme, removeUser, showUser); handlers that redraw a form take render as a second argument.
4. Route every target-user lookup through one helper: userInForm(dataDir, body) reads the user_id field for namedUser and the delete handler; signedInUser(c) loads the session's user for the password and theme handlers.
5. Replace every flash-then-303 tail with flashAndRedirect (and a backToUser shorthand for the user's own screen).
6. Rerun the users tests after each step, then the full gate: pnpm build, test, test:11ty, typecheck, lint, format:check; measure with fnstats.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Baseline: users/admin-theme/form-errors/fields/menu/federation/delivery tests 376/376 green before and after.
flashAndRedirect lives in admin/flash.ts so other admin screens can adopt it later; only users.ts uses it now.
mountUsers is now 13 lines of route wiring; every handler is a top-level function and handlers that redraw a form take render as a second argument rather than closing over it.
Target lookup: userInForm(dataDir, body) is the one reader of the user_id field (namedUser and removeUser); signedInUser(c) is the one loader of the session's user (changePassword and saveTheme). removeUser narrows target instead of casting it to User.
The Profile panel's six fields moved into typedProfile(body). showUser reads c.req.param('id') ?? '' because the handler takes an untyped-path Context; an empty segment still fails pathId, so it is a 404 as before.
fnstats: no users.ts function is in the long list (mountUsers was ~344 lines).
Gate: pnpm build, pnpm test (cms 7481/7481), test:11ty, typecheck, lint, format:check all pass. No test files changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split mountUsers in admin/users.ts into named handlers (showUsers, showAddUser, addUser, changePassword, saveEmail, saveProfile, saveNotification, saveNotificationMode, saveTheme, removeUser, showUser), so mountUsers only wires routes. Added flashAndRedirect to admin/flash.ts for every flash-then-303 tail (with backToUser for the user's own screen), and routed target-user loading through userInForm (form user_id) and signedInUser (session). Behaviour preserved: no test changed; pnpm build, test (cms 7481/7481), test:11ty, typecheck, lint and format:check pass.
<!-- SECTION:FINAL_SUMMARY:END -->
