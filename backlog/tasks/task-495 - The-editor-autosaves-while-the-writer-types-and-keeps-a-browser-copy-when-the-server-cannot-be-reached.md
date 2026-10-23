---
id: TASK-495
title: >-
  The editor autosaves while the writer types, and keeps a browser copy when the
  server cannot be reached
status: To Do
assignee: []
created_date: '2026-10-23 10:50'
updated_date: '2026-10-23 10:50'
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
- [ ] #1 The editor posts the form to /admin/autosave about two seconds after the last change to the title, body or any field, when a field loses focus, and on pagehide (sendBeacon or keepalive fetch); unchanged forms are not posted again
- [ ] #2 A new document editor carries a minted autosave id in a hidden field and in the URL (history.replaceState), so a reload finds its own copy
- [ ] #3 A status line in the editor says when the last copy was saved, and whether on the server or only in this browser; it is a polite live region and does not announce every keystroke
- [ ] #4 A network failure or 5xx writes the fields to localStorage under a key naming the site, user and autosave key, retries the server with backoff, and removes the local copy once a server autosave succeeds
- [ ] #5 A 401/403 (expired session or CSRF) keeps the local copy and tells the writer to sign in again in another tab, without discarding anything
- [ ] #6 Leaving the page with changes not yet saved to the server shows the browser beforeunload prompt; a form submit does not
- [ ] #7 With JavaScript off the editor behaves exactly as before
- [ ] #8 Tests cover the bundle behaviour (debounce, unchanged form, failure to local copy, recovery, 403) with a headless browser or the existing editor test setup, and docs/admin.md describes autosave
<!-- AC:END -->
