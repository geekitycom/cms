---
id: TASK-495
title: >-
  The editor autosaves while the writer types, and keeps a browser copy when the
  server cannot be reached
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 10:50'
updated_date: '2026-10-23 11:45'
labels:
  - admin
  - editor
  - autosave
milestone: m-47
dependencies:
  - TASK-494
references:
  - packages/cms/editor/main.ts
  - packages/cms/admin/pages/documents/editor.njk
ordinal: 420800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-62: the editor bundle posts the whole form to /admin/autosave after typing pauses, on blur and on pagehide, so unsaved work survives a closed browser or a server restart. A new document gets an id when the editor opens so its copy can be found again. While the server cannot be reached the same fields go to localStorage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The editor posts the form to /admin/autosave about two seconds after the last change to the title, body or any field, when a field loses focus, and on pagehide (sendBeacon or keepalive fetch); unchanged forms are not posted again
- [x] #2 A new document editor carries a minted autosave id in a hidden field and in the URL (history.replaceState), so a reload finds its own copy
- [x] #3 A status line in the editor says when the last copy was saved, and whether on the server or only in this browser; it is a polite live region and does not announce every keystroke
- [x] #4 A network failure or 5xx writes the fields to localStorage under a key naming the site, user and autosave key, retries the server with backoff, and removes the local copy once a server autosave succeeds
- [x] #5 A 401/403 (expired session or CSRF) keeps the local copy and tells the writer to sign in again in another tab, without discarding anything
- [x] #6 Leaving the page with changes not yet saved to the server shows the browser beforeunload prompt; a form submit does not
- [x] #7 With JavaScript off the editor behaves exactly as before
- [x] #8 Tests cover the bundle behaviour (debounce, unchanged form, failure to local copy, recovery, 403) with a headless browser or the existing editor test setup, and docs/admin.md describes autosave
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: the editor form carries a hidden autosave field (document path, or a minted id for a new document: reused from ?autosave= or the posted field when valid, minted otherwise) and the editor's enhance element carries the autosave URL and the signed-in user id.
2. Server: a successful save queues the cleared autosave keys on the session (a non-message flash entry); the next editor page prints them in data-autosave-cleared so the bundle can drop its local copies for them. Message flashes render as before.
3. Pure controller module src/admin/autosave-client.ts (no DOM types, injected timers/transport/storage): 2 s debounce, flush on blur, beacon on pagehide, unchanged snapshot not posted, network/5xx -> local copy + backoff retry, success -> local copy removed, 401/403/redirect -> local copy kept + sign-in message, hasUnsaved for beforeunload, submit stops it; subscribe/state API and exported localCopyKey() for the resume banner and focus mode. Unit tests with node:test mock timers.
4. Bundle: editor/autosave.ts wires the controller to the form (FormData snapshot, fetch with redirect:manual, sendBeacon, localStorage), a polite status line #editor-autosave-status with data-state, history.replaceState of the minted id into the URL, beforeunload; main.ts calls it.
5. docs/admin.md: autosave in the editor.
6. Verify: full pnpm checks, then a live headless-Chromium run of every criterion on a temp site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- Server: the editor form carries a hidden autosave field (document.path, or for a new document the id from ?autosave= or the posted field when it is a minted id, minted otherwise). #editor-enhance carries data-autosave-url and data-autosave-user (numeric user id).
- Save signal for clearing browser copies: discardAutosaves (save and trash) queues each cleared key on the session as a flash entry of kind 'autosave-cleared'. The admin render splits those out of the visible flash into clearedAutosaves, and the editor prints them as JSON in data-autosave-cleared on #editor-enhance. The bundle removes its localStorage copy for each on load. Chosen over a sessionStorage submit marker plus redirect detection, which would wrongly clear a copy after a sign-in redirect.
- Pure controller packages/cms/src/admin/autosave-client.ts (no DOM types; injected read/send/beacon/storage): 2 s debounce, flush on blur, beacon on pagehide (local copy if the beacon cannot be queued), baseline = form as served then as last autosaved so an unchanged form is never posted, one post in flight at a time, unreachable -> local copy + backoff 2/4/8.. capped 60 s, signed-out (401/403/redirect) -> local copy + message, no timer retry (the page's CSRF token is dead), next change tries again; other 4xx -> local copy + server's message; submitting() stops everything so no copy lands after a save. Only a copy this page wrote is removed on success; a copy found at load belongs to the resume banner.
- Wiring packages/cms/editor/autosave.ts: FormData snapshot without csrf_token, fetch with redirect:'manual' (an expired session answers 302 to the login form, which a followed fetch reports as 200), sendBeacon, localStorage key geekity-autosave:<origin>:<userId>:<key>, status line p#editor-autosave-status role=status with data-state (idle|server|browser|signed-out|refused), text set only when an autosave finishes; history.replaceState puts autosave (and kind when missing) into the URL for a minted id; beforeunload prompts only when controller.unsaved().
- docs/admin.md: 'Autosave in the editor' section and a bullet under What JavaScript adds.

Testing: no browser harness exists in pnpm test (highlight-bundle runs in a VM; no jsdom/playwright dependency), so the behaviour is unit-tested through the controller (src/admin/autosave-client.test.ts, 18 tests with node:test mock timers: debounce, unchanged form, blur, in-flight, status, failure to local copy, backoff, recovery, 403, refusal, beforeunload state, submit, beacon, key naming) and the server side in src/admin/autosave.test.ts (7 new tests). Updated editor-daisyui FILLED_FORM and editor-actions stable() for the new hidden field.

Live run (headless Chrome for Testing 1234 via npx playwright 1.56, temp site /tmp/ta495/site on port 3495, script /tmp/ta495/scripts/live.mjs which starts and stops the server itself): 30/30 checks passed - minted id in field and URL with kind kept; no post during a <2 s pause, exactly one post 2006 ms after the last key; status 'Saved a copy at 6:36 AM.'; copy in data/autosave; unchanged form not reposted; blur posts at once; reload keeps the id; server killed mid-typing -> 'Server unreachable — saved in this browser at ...' and localStorage geekity-autosave:http://localhost:3495:1:new-...; server restarted -> backoff retry saved and the local copy was removed; beforeunload dialog with unsaved changes, none when all saved, none on Publish submit; pagehide beacon delivered the last keystrokes; existing post keyed by posts/2026-01-01-hello-world.md, URL untouched; Publish of a new post removed both the server copy and a planted local copy of its key; stale csrf_token -> 403 -> 'You are signed out — saved in this browser at ... Sign in again in another tab; nothing has been discarded.' with the local copy kept; cookies cleared (expired session) -> same; JavaScript off -> no status line, URL unchanged, textarea visible, Publish works. No server left running.

Known: reloading a new editor opens a blank form with the same id, and the first change overwrites the server copy; restoring it first is the resume banner's job (next task).

Final verification: pnpm build, pnpm test (cms 7184 pass, all packages 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. The clock-boundary test required the controller's clock to be injected (now is a required option; the bundle passes () => new Date()). Live script rerun on the final bundle: 30/30 PASS, twice.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The editor now autosaves. editor/autosave.ts wires a DOM-free controller (src/admin/autosave-client.ts) to the form. It posts to /admin/autosave 2 s after the last change, on blur and with sendBeacon on pagehide, and never posts a form the server already has. On a network failure or 5xx it keeps a localStorage copy under geekity-autosave:<origin>:<user>:<key> and retries with backoff from 2 s to 60 s, removing the copy once the server takes it. A 401, a 403 or a login redirect keeps the copy and asks the writer to sign in again in another tab. A polite #editor-autosave-status line with data-state reports each result. beforeunload prompts only when the server lacks the changes, and never on submit. The server emits the hidden autosave field: the content path, or a minted id reused from ?autosave= or the posted field. The bundle replaceStates the id (and kind) into the URL. After a successful save the next editor page lists the cleared keys in data-autosave-cleared, so the bundle drops those browser copies. docs/admin.md describes it all. Verified by 18 controller unit tests with mock timers, 7 new server tests, the full pnpm suite, and a 30-check headless Chrome run on a temp site that stops and restarts the server, sends a stale CSRF token, clears the session and turns JavaScript off.
<!-- SECTION:FINAL_SUMMARY:END -->
