---
id: TASK-11
title: 'Posts: list, editor, publish, draft, trash, restore'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 03:06'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-10
  - TASK-4
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core editing loop. List at /admin/posts with status filters and row actions. Editor at /admin/posts/new and /admin/posts/{slug} with title, slug (auto from title until touched), permalink preview, date, tags, description, draft checkbox, and body textarea. Save writes the Markdown file via the writer, then upserts the index. The form carries the file hash it loaded with; mismatch returns a conflict view. Trash moves the file to content/_trash; restore moves it back.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Creating a post writes content/posts/{yyyy}-{mm}-{dd}-{slug}.md with explicit permalink and the post appears on the public site immediately
- [x] #2 Editing the body and saving updates the file and the public page without restart
- [x] #3 Saving with a stale hash returns a conflict view showing both versions and does not overwrite the file
- [x] #4 Move to trash relocates the file to content/_trash and removes it from the public site; Restore reverses it
- [x] #5 Toggling draft on and off is reflected in front matter and in public visibility
- [x] #6 Unknown front-matter keys added by hand survive an admin save
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test: the Hono HTTP surface through `app.request` — GET /admin/posts with each status filter, GET /admin/posts/new and /admin/posts/{slug}, POST create/update/trash/restore — plus the public site's view of the same store, so visibility is observed where a reader sees it. Colocated node:test file src/admin/posts.test.ts using the existing __testing__/harness.
2. One shared module, src/admin/documents.ts, parameterised by a DocumentKind ({type, section, basePath, singular, plural, dated, tagged}). POST_KIND and PAGE_KIND are exported; mountDocumentScreens(app, {kind, render}) registers the list, the editor and the save/trash/restore POSTs. TASK-12 mounts the same function with PAGE_KIND and deletes the pages placeholder.
3. Listing: store.listAll({type, draft, trashed, limit, offset}) behind a ?status=all|published|draft|trash filter and an optional ?page=. Columns title, author, tags, date, status; row actions Edit, Move to trash or Restore (POST forms carrying the CSRF token and a return path), View when the document is public.
4. Editor: title, slug, permalink, date, tags, description, draft checkbox, body, and a hidden hash. Slug falls back to slugify(title) server-side so the form works with JS off; a small inline script syncs slug and permalink from the title until either field is typed in. Buttons per doc-5: Save draft and Publish for a new or draft document, Update for a published one, Move to trash, Restore for a trashed one, and a View link.
5. Save: the conflict check reads the file from disk and re-parses it rather than trusting the index, so it is right whether or not the watcher is running. A hash that does not match the submitted one renders a conflict screen (409) with the submitted file text and the on-disk file text side by side and writes nothing. Otherwise saveDocument() writes, carrying document.extra, activitypub and author through untouched and stamping updated.
6. Renames: the target path is recomputed from the new slug and date (contentFilePath, plus the _trash/ prefix when the document is trashed). When it differs from the old one the new file is written, the old file is unlinked and its index row removed. The permalink follows the slug when it still matches the old default and is left alone when it was customised, so doc-2's explicit permalink is never silently rewritten.
7. Trash and restore are the same move: _trash/{path} and back. The file is renamed, the old row removed and the new one indexed straight away, so the public site stops and starts serving without waiting for the watcher.
8. Templates: layouts/document-list.njk, document-editor.njk and document-conflict.njk, added to ADMIN_TEMPLATES and driven by the kind so pages reuse them; new rules in admin/static/admin.css. Export the new names from src/admin/index.ts and src/index.ts.
9. Verify: pnpm test/typecheck/lint in packages/cms, then root test/typecheck/lint/format:check, then a manual curl pass against apps/demo covering create, public fetch, edit, a forced conflict, trash, restore, the draft toggle and a hand-added front-matter key.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisions

- **One module for both kinds.** `src/admin/documents.ts` holds the listing, the editor and the write path, parameterised by a `DocumentKind` (`type`, `section`, `basePath`, `singular`, `plural`, `dated`, `tagged`). `POST_KIND` and `PAGE_KIND` are both exported and `mountDocumentScreens(app, { kind, render })` registers the five routes. TASK-12 is one call with `PAGE_KIND` and the deletion of the pages placeholder; `kind.dated` and `kind.tagged` already switch the date and tag columns and fields off.
- **The conflict check reads the file, not the index.** doc-1 says files win, so `conflictWith()` reads and re-parses the file on disk and compares that hash with the one the form carried. It is therefore right with the watcher off, and right in the window before a watcher event lands. A file that will not parse hashes to the empty string, which is never what a form carried, so it conflicts rather than being overwritten sight unseen.
- **The conflict screen is not a dead end.** Both versions are shown in full in read-only textareas, nothing is written, and the refused form is offered back with the hash the file has now. One click is then a deliberate overwrite of a version its author has been shown.
- **The permalink follows the slug only when it was never customised.** doc-2 says the stored permalink is what counts, and the task asks for a rename to move the file. `resolvePermalink()` compares the submitted permalink with the default the document's *old* slug and date implied: equal means it was never chosen by hand and it follows the new slug and date; different means somebody picked that URL and it is left alone.
- **Renaming is remove-then-write.** The index refuses two rows claiming one permalink, so the old row goes before `saveDocument()` writes the new path, the old file is unlinked after, and a failed write puts the old row back.
- **Trash mirrors the tree.** `posts/2026-03-04-x.md` becomes `_trash/posts/2026-03-04-x.md`, so restoring is the same move backwards and remembers nothing. The file is read, renamed, the old row dropped and the new path parsed and upserted in the same request, so the public site stops and starts serving with that request rather than with the next watcher tick.
- **Buttons are shortcuts past the checkbox.** `save-draft` forces `draft: true`, `publish` forces `draft: false`, `update` takes the checkbox. Something unwritten or still a draft shows Save draft and Publish; something published shows Update. Trashed shows Restore where the others show Move to trash.
- **The form works with JavaScript off.** An empty slug is derived from the title on the server and an empty permalink from the slug and date. The inline script only keeps the slug and the permalink in step while nobody has typed in them.
- **Row actions carry a return path.** A trash or restore from the listing comes back to the same filtered listing; `returnPath()` honours only paths under `/admin/`.

## Validation

- `pnpm test` in `packages/cms`: 396 tests, 83 suites, 0 failures (377 before; 19 new in `src/admin/posts.test.ts`). `pnpm typecheck` and `pnpm lint` clean. Root `pnpm lint`, `pnpm typecheck`, `pnpm test` (396 + 10) and `pnpm format:check`: all clean.
- The new tests were mutation-checked rather than trusted: skipping the hash comparison, writing the trash to the same path, dropping `document.extra` and skipping the old row's removal each made exactly the tests that cover that behaviour fail, and nothing else.

Manual pass against `apps/demo` on port 3000 (`pnpm dev`), signed in as `ada` with a cookie jar.

- `/admin/posts`: six rows with author, tags, date and status; the draft marked. The filters counted 5 published, 1 draft, 0 trashed, matching the demo's content.
- Created "A manual pass through the editor" through `/admin/posts/new` with Publish: 303 to its editor, `content/posts/2026-09-02-a-manual-pass-through-the-editor.md` with `permalink: /2026/09/a-manual-pass-through-the-editor/`, `author: ada`, the tags and an `updated` stamp, and the public URL 200 with the body in it straight away (AC #1).
- Added `hero:` and a `syndication:` list to the file by hand, then edited the body through the editor: the file and the public page both carried the new body, and both hand-added keys were still there afterwards (AC #2, AC #6).
- Conflict: kept the hash the form loaded with, wrote a different body straight to the file, and submitted. 409, a screen headed "This post changed while you were editing it" carrying both versions, and `diff` said the file was byte-for-byte what it had been. Resubmitting with the hash the conflict screen offered went through with a 303 (AC #3).
- Draft on: `draft: true` in the file and the public URL 404. Publish: no `draft` key at all and the URL 200 again (AC #5).
- Move to trash: the file moved to `content/_trash/posts/2026-09-02-...md`, the public URL 404, and the row appeared under the Trash filter. Restore: back under `content/posts/`, `_trash` empty, public URL 200 (AC #4).
- Renaming the slug moved the file to `2026-09-02-renamed-by-hand.md`, rewrote the permalink to `/2026/09/renamed-by-hand/` (200), left the old URL 404, and kept `hero:`.

Everything written during the pass was removed afterwards: `content/posts/2026-09-02-renamed-by-hand.md` and the whole `content/_trash` directory are gone, `git status` reports `apps/demo` clean, and port 3000 was released.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the posts screens, and built them so pages are the same code.

`src/admin/documents.ts` is one module parameterised by a `DocumentKind`: `mountDocumentScreens(app, { kind, render })` registers the listing, the editor, the create and the save/trash/restore for whichever kind it is given. `POST_KIND` is mounted now; `PAGE_KIND` is exported and ready, and its `dated: false`/`tagged: false` already switch the date and tag columns and fields off, so TASK-12 is one call and the deletion of a placeholder. Three shared templates — `document-list.njk`, `document-editor.njk` and `document-conflict.njk` — are driven by the same kind.

The listing has title, author, tags, date and status, filters for all, published, drafts and trash, Edit, Move to trash or Restore, and a View link only where the public site would actually serve the document. It pages 25 at a time by asking for one row more than it shows. The editor has every field doc-5 lists and the buttons it names; the slug and the permalink follow the title while nobody has typed in them, and the form works with JavaScript off because an empty slug is derived from the title on the server.

Saving carries the hash the form loaded with. The check re-reads and re-parses the file rather than trusting the index, so it holds whether or not the watcher is running; a mismatch renders both versions side by side, writes nothing, and offers the same form back with the hash the file has now. Unknown front matter, `activitypub` and the author are carried through untouched. Renaming the slug or changing the date moves the file and takes the permalink with it — unless the permalink was chosen by hand, which is never rewritten. Trash mirrors the content tree under `_trash/`, so restore is the same move backwards, and both correct the index in the same request, so the public site stops and starts serving at once.

Verified with 19 new node:test tests through `app.request` against temporary content directories — including the public site's view of the same store before and after each change — and every one of them mutation-checked to prove it fails when the behaviour it names is broken. Then a manual curl pass against the running demo covering all six acceptance criteria: a post created and immediately public, an edit reaching the public page without a restart, a forced conflict that showed both versions and left the file byte-for-byte identical, trash and restore, the draft toggle in both directions, and two hand-added front-matter keys still there at the end. `pnpm test` (396 pass), `typecheck` and `lint` in the package, and the root `lint`, `typecheck`, `test` and `format:check` all pass; everything the manual pass wrote into `apps/demo` was removed.
<!-- SECTION:FINAL_SUMMARY:END -->
