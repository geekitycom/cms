---
id: TASK-496
title: >-
  The editor offers unsaved changes back when it opens, and an Unsaved list
  resumes or discards them
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 10:50'
updated_date: '2026-10-23 12:11'
labels:
  - admin
  - editor
  - autosave
milestone: m-47
dependencies:
  - TASK-494
  - TASK-495
references:
  - packages/cms/src/admin/documents.ts
  - packages/cms/admin/pages/documents/conflict.njk
  - packages/cms/admin/pages/documents/editor.njk
ordinal: 421800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-62: a copy is only useful if the writer finds it. Opening a document with a newer copy (server or browser) shows a banner to Restore or Discard; a copy whose base has changed is shown beside the current version. The Posts and Pages lists gain an Unsaved filter so new documents never saved can be found, and resumed without JavaScript.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opening the editor for a document with a server copy newer than the file shows an alert: Unsaved changes from <time>, with Restore and Discard; with no copy, or an older one, nothing is shown
- [x] #2 Restore fills the title, body, editor and the other fields from the copy without saving; Discard deletes the copy (server and local) and leaves the form as loaded
- [x] #3 When the copy base hash differs from the file hash, the banner says the post changed since, and Restore shows the copy beside the current version in the same layout as the conflict screen
- [x] #4 The bundle also checks localStorage for a copy of this key and offers whichever of the server and local copies is newer
- [x] #5 Posts and Pages lists have an Unsaved filter listing the user copies (title or first words, kind, saved time, new or existing), each with Resume and Discard; it works without JavaScript, Resume opening the editor with the copy fields filled in by the server
- [x] #6 A new document copy resumes into /admin/{posts,pages}/new with its kind and autosave id, and saving it creates the document and deletes the copy
- [x] #7 The banner and list meet the admin accessibility rules (alert role, labelled buttons, keyboard), and tests cover each case including a changed base and no-JS resume; docs/admin.md describes resuming
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: renderEditor looks up the user's copy on GET (existing by path, new by minted id). Offered when savedAt is later than the document's updated time (or the document has none, or it is new). Banner (role=alert) above the form: 'Unsaved changes from <time>', changed-since wording when copy.hash != document.hash; Restore is a link to the same editor URL with restore=1; Discard is a form posting to /admin/autosave/discard with return to the editor.
2. GET ?restore=1: form from submittedForm(kind, copy.fields); same hash -> editor filled from the copy; different hash -> conflict layout (conflict.njk in a restoring mode) with the copy beside the file, 'Edit mine over the file' -> ?restore=rebase (editor from the copy carrying the file's current hash) and Discard. New documents resume into /new?kind=&autosave=&restore=1.
3. Discard endpoint also queues autosave-cleared so the reloaded editor drops the browser copy.
4. Client: pure resumeOffer() picks none/server/browser from the server copy time, the local copy, the file time and the form snapshot. Controller gains a held state: no post, beacon or local write until release(); unsaved() still answers. Local copy Restore posts the local fields to /admin/autosave and then opens ?restore=1 (one restore path, server-rendered, so CodeMirror and every per-kind field are filled the same way). Discard with JS is fetched, removes the local copy and the banner and releases the controller.
5. Lists: Unsaved filter (status=unsaved) on Posts and Pages lists the user's copies of that type: title or first words, kind, saved time, new or existing, Resume link (restore=1) and Discard form returning to the list.
6. Tests first for each case (server banner, older copy, changed since, restore, rebase, discard, unsaved list, no-JS resume, new copy save deletes it; client offer + held controller). docs/admin.md: resuming.
7. Verify: build, test, test:11ty, typecheck, lint, format:check; live Playwright run with screenshots in /tmp/m48-resume/.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. Decisions:
- 'Newer than the file' means the copy's savedAt is later than the document's `updated` (its last save through the admin); a document with no `updated` offers any copy. A file hand-edited on disk keeps its `updated`, so its copy is still offered, with the changed-since wording (copy.hash != document.hash). An older copy is not offered in the editor but stays in the Unsaved list.
- One restore path, server-rendered: Restore is a link to the editor with restore=1 (existing: {base}/{slug}?restore=1; new: /new?kind=&autosave=&restore=1). The server fills the form with submittedForm(kind, copy.fields), so CodeMirror, checkboxes, selects and repeated photo rows come back exactly as the no-JS editor renders them. A browser copy's Restore first posts its fields to /admin/autosave (so the server holds it), removes the local copy, then opens restore=1.
- Changed since: restore=1 renders conflict.njk in a restoring mode (200, not 409): copy beside the file, 'Discard mine and edit the file on disk' (discard form returning to the editor) and 'Edit mine over the file' (restore=rebase: editor from the copy carrying the file's current hash).
- Overwrite bug: the controller takes held: true when a copy is offered; while held, changed/flush/leave neither post, beacon nor write localStorage; unsaved() still answers so beforeunload warns. release() (after JS Discard) schedules an autosave if the form changed meanwhile. Restore navigates away, so it needs no release.
- Discard with JS is fetched (JSON), removes the local copy and the banner, releases the controller and focuses the title. Without JS it posts with return; the discard endpoint now also queues autosave-cleared so the reloaded editor drops the browser copy.
- Unsaved filter: ?status=unsaved on Posts and Pages, rows of the user's copies of that type, newest first; a copy of a deleted document has Discard only.
- Browser banner prints its time with toLocaleString; the server banner uses the site time zone, so the two read slightly differently.
Validation: pnpm build, test (cms 7217 pass), test:11ty, typecheck, lint, format:check all pass. New tests: src/admin/autosave-resume.test.ts (21) and resume/held cases in src/admin/autosave-client.test.ts. Live: /tmp/ta496/scripts/live.mjs on port 3496, headless Chromium, 49/49 checks PASS (existing restore incl. CodeMirror/title/tags/Draft checkbox, pending banner holds autosave, Discard, new post reload, changed-since conflict + rebase, local-only copy with the server copy deleted, no-JS Unsaved list Resume and Discard). Screenshots in /tmp/m48-resume/.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The editor now offers the user's autosaved copy back: a role=alert banner above the form says 'Unsaved changes from <time>' with Restore and Discard, and adds 'This post has changed since' when the copy's base hash differs from the file. Restore is server-rendered (restore=1) so every field and CodeMirror are filled; a changed base shows the copy beside the file in the conflict layout with 'Edit mine over the file' (restore=rebase). The bundle also offers a newer localStorage copy (pushed to the server, then restored the same way), and holds autosave while a copy is offered so nothing overwrites it before a choice. Posts and Pages gain an Unsaved tab listing the user's copies with Resume and Discard, working without JavaScript; a new document's copy resumes into /new with its kind and id and saving deletes it. Docs in docs/admin.md. Verified by unit and route tests, the full check suite, and a 49-check headless Chromium run.
<!-- SECTION:FINAL_SUMMARY:END -->
