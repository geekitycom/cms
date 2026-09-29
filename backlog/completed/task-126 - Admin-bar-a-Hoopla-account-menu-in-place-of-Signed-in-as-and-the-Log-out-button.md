---
id: TASK-126
title: >-
  Admin bar: a "Hoopla!" account menu in place of "Signed in as" and the Log out
  button
status: Done
assignee:
  - '@claude'
created_date: '2026-09-24 12:37'
updated_date: '2026-09-29 00:03'
labels:
  - admin
dependencies: []
ordinal: 150800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin bar (packages/cms/admin/layouts/shell.njk) ends with "Signed in as {username}" and a bare Log out button. Replace them with an account menu like the one WordPress puts at the right of its admin bar ("Howdy, Name" that opens a dropdown), but greeting with "Hoopla!" instead of "Howdy," because the site owner prefers it. The greeting uses the signed-in user's display name when they have one and their username when they do not. The dropdown holds a link to the user's own edit screen (/admin/users/<id>) and Log out. Log out is a POST with a CSRF token today and must stay one. The admin runs under a CSP of script-src 'self', so any script must be a self-hosted file. Several tests match "Signed in as ada" (accounts.test.ts, dashboard.test.ts, users.test.ts) and move with the markup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The admin bar reads "Hoopla! {display name}" for a user with a display name, and "Hoopla! {username}" for one without
- [x] #2 "Signed in as" no longer appears in the admin
- [x] #3 Activating the greeting opens a menu with a link to the user's own edit screen and Log out; activating it again, pressing Escape, or clicking elsewhere closes it
- [x] #4 The menu opens and works with the keyboard alone, and a screen reader announces it as a collapsed/expanded control
- [x] #5 Log out from the menu signs the user out with the same POST and CSRF check as today
- [x] #6 Tests assert the greeting for both a named and an unnamed user, and that Log out still signs out
- [x] #7 The menu works on a phone-width screen and matches the admin bar's look
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: the chrome needs the account's name (profile.displayName, else username) and its edit URL (editUserPath(user.id)); render() in routes.ts adds both to every admin template's context.
2. Markup in layouts/shell.njk: a <button popovertarget> reading 'Hoopla! {name}' controlling a <div popover> that holds 'Edit profile' (the edit screen) and the existing POST logout form with its CSRF token. The Popover API gives toggle, Escape and light dismiss with no script, so the nonce CSP stays untouched; the browser exposes the invoker's expanded state to assistive tech.
3. admin.css: the button looks like the other bar items; the menu sits under the button in the bar's colours (anchor positioning where supported, fixed top-right fallback), and fits a phone-width bar.
4. Tests first: dashboard.test.ts asserts the greeting for an unnamed and a named user, the menu's contents and wiring, the absence of 'Signed in as', and that posting the menu's logout form signs out; the 'Signed in as' matches in accounts/users/dashboard tests move to 'Hoopla!'.
5. Prove in real Chrome with a CDP script: keyboard open (Tab + Enter), expanded state in the AX tree, Escape, click outside, second activation, and a 375px viewport; then pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Chose the Popover API over a scripted aria-expanded toggle: <button popovertarget> + <div popover> gives open/close, Escape, light dismiss and focus return with no JavaScript, so the admin CSP (script-src 'self') is untouched and no new static file was needed. Chrome exposes the invoker's expanded state in the accessibility tree without an aria-expanded attribute.
render() in routes.ts now passes 'me' ({ name: displayName ?? username, url: editUserPath(id) }) instead of the raw 'user'; the shell was the only template that read 'user'.
CSS: the menu is in the top layer, placed with CSS anchor positioning (top at the bar's bottom, right edge at the greeting's) where supported, with a fixed top-right fallback. The caret is ::after content with empty alt text (content: ' \25BE' / '') so it is not read into the button's name; the first browser run caught it being announced. Menu items out-specify the global button[type='submit'] style, which had painted Log out blue with a top margin at phone width.
Browser proof: a CDP script against headless Chrome and a scratch server on a fresh data dir (scratchpad/menu126.mjs, 27 checks, all pass, also with a 39-character display name): AX name 'Hoopla! ada' and expanded=false; Tab reaches the greeting, Enter opens, AX expanded=true, Tab walks Edit profile then Log out, Escape closes and returns focus; click opens, second click closes, click elsewhere closes; menu top == bar bottom and right aligned with the greeting; at 375px and 320px the menu opens by tap, sits inside the viewport, no horizontal scroll, tap elsewhere closes; Log out from the menu by keyboard lands on /admin/login and /admin then redirects to login. Screenshots at desktop, 375 and 320 checked by eye.
Gate: pnpm build, pnpm test (2282 + 30 pass), pnpm typecheck, pnpm lint pass; pnpm format:check passes after prettier on dashboard.test.ts.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the admin bar's 'Signed in as {username}' and bare Log out button with a 'Hoopla! {display name or username}' account menu. The greeting is a popovertarget button controlling a native popover that holds 'Edit profile' (/admin/users/<id>) and the unchanged POST logout form with its CSRF token, so it needs no script under the admin CSP. Tests in dashboard.test.ts assert the greeting for an unnamed and a named user, the menu's link and form, that a wrong token is still refused, and that posting the menu's form ends the session; the 'Signed in as' assertions in accounts, users and dashboard tests moved to 'Hoopla!'. Keyboard, Escape, click-outside, the expanded state in the accessibility tree and phone widths (375px, 320px) were proven in headless Chrome over CDP. Full build, test, typecheck, lint and format gate passes.
<!-- SECTION:FINAL_SUMMARY:END -->
