---
id: TASK-12
title: 'Pages: list and editor'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 03:17'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-11
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Same flow as posts for content/pages: no date prefix in filename, no tags, optional eleventyExcludeFromCollections flag, default permalink /{slug}/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Creating a page writes content/pages/{slug}.md and serves it at its permalink
- [x] #2 Trash and restore work as for posts
- [x] #3 The page list shows title, author, updated date, and status
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test: the Hono surface through `app.request` — GET /admin/pages with each filter, GET /admin/pages/new and /admin/pages/{slug}, POST create/save/trash/restore — plus the public site's view of the same store. New colocated node:test file src/admin/pages.test.ts on the existing __testing__/harness, mirroring posts.test.ts.
2. Mount the shared screens: replace the two /admin/pages placeholder handlers in src/admin/routes.ts with one mountDocumentScreens(app, { kind: PAGE_KIND, render }), and skip PAGE_KIND.section in the placeholder loop so the section is not registered twice.
3. eleventyExcludeFromCollections: the key is not in KNOWN_FRONT_MATTER_KEYS, so the parser leaves it in document.extra. Give DocumentKind an `excludable` flag (pages only), EditorForm an `exclude` boolean, and the editor template a checkbox behind {% if kind.excludable %}. One helper, resolveExtra(), builds the extra map for the save and for the conflict preview: checked writes the key `true`; unchecked removes it, unless the file already carried the key, in which case it is written `false` so a hand-set value is not silently dropped (doc-2's round-trip rule). Posts never touch the key.
4. Updated column (AC #3): DocumentRow gains `updated`, read from the index's `updated` column with the publish date as the fallback, so no extra I/O. The listing template shows a Date column for a dated kind and an Updated column for an undated one, alongside title, author and status.
5. Verify: package pnpm test/typecheck/lint, then root lint/typecheck/test/format:check, then a manual curl pass against apps/demo covering create at content/pages/{slug}.md served at /{slug}/, trash and restore, the listing columns and the exclude checkbox in both directions. Clean up everything written under apps/demo/content and release port 3000.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisions

- **Pages are one more `mountDocumentScreens` call.** `src/admin/routes.ts` now mounts `POST_KIND` and `PAGE_KIND` over the same module; the two `/admin/pages` placeholder handlers are gone and the placeholder loop skips both built sections. Everything TASK-11 built — the filters, the conflict check, renames, trash and restore, the return path — came with the mount, so the code written for this task is the two things a page has that a post does not.
- **`eleventyExcludeFromCollections` is edited where it lives, in `extra`.** The key is not in `KNOWN_FRONT_MATTER_KEYS`, so the parser leaves it among the unmodelled front matter. `DocumentKind.excludable` (pages only) puts a checkbox on the editor, and one helper, `resolveExtra()`, decides what to write: ticked writes `true`; unticked takes the key back out rather than leaving a `false` behind — unless the file spelled the key out itself, in which case `false` is written, because a key somebody added by hand is not the editor's to delete (doc-2's round-trip rule). A post never touches the key, even if a hand-made POST carries the field.
- **The listing shows Updated where a post shows Date.** `DocumentRow.updated` is `document.updated ?? document.date`, both already columns in the index, so the row costs no reads of its own. The template switches the column on `kind.dated`, so posts are unchanged.
- **An unticked checkbox is an absent field, as in a browser.** The server reads `exclude` the way it already reads `draft` (present or not), and the test helper drops the field rather than sending an empty one.

## Validation

- `pnpm test` in `packages/cms`: 407 tests, 88 suites, 0 failures (396 before; 11 new in `src/admin/pages.test.ts`). `pnpm typecheck` and `pnpm lint` clean. Root `pnpm lint`, `pnpm typecheck`, `pnpm test` (407 + 10) and `pnpm format:check` all clean.
- The new tests were mutation-checked: dropping `updated` from the row, never writing the exclude key, always deleting it when unticked, and removing the `kind.excludable` guard each failed exactly the test that names that behaviour and nothing else.

## Manual pass against apps/demo

On port 3000 (`pnpm dev`), signed in as `ada` with a cookie jar.

- `/admin/pages`: the real listing, not the placeholder. Columns Title, Author, Updated, Status, Actions — no Tags and no Date — with the four filters, Edit, Move to trash and a View link. `Now` showed `2026-09-02` in Updated, `Colophon` (which carries no `updated`) showed nothing (AC #3).
- Created "A manual pass through pages" through `/admin/pages/new` with Publish: 303 to its editor, `content/pages/a-manual-pass-through-pages.md` — no date prefix — carrying `permalink: /a-manual-pass-through-pages/`, `author: ada` and an `updated` stamp and no `date` or `tags` key, and the public URL 200 with the body in it straight away (AC #1).
- The editor's "Hide from collections" checkbox: ticking it wrote `eleventyExcludeFromCollections: true` and the editor came back with the box `checked`; unticking it wrote `eleventyExcludeFromCollections: false`, because by then the file carried the key. The create above had left the key out of the file altogether.
- Move to trash: the file moved to `content/_trash/pages/a-manual-pass-through-pages.md`, the public URL 404, and the row appeared under the Trash filter with a Restore button. Restore: back under `content/pages/`, `_trash` empty, public URL 200 (AC #2).

Everything written during the pass was removed afterwards: the page file and the whole `content/_trash` directory are gone, `git status` reports `apps/demo` clean, and port 3000 was released.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Mounted the pages screens on the module TASK-11 built, and added the two things a page has that a post does not.

`/admin/pages`, `/admin/pages/new` and `/admin/pages/{slug}` are now one `mountDocumentScreens(app, { kind: PAGE_KIND, render })` call in `src/admin/routes.ts`; the placeholder handlers are gone. Pages therefore get the filters, the editor, the hash conflict check, slug renames, trash and restore and the return paths for nothing, and `dated: false`/`tagged: false` already keep the date and the tags off both the form and the table.

The new code is two things. `eleventyExcludeFromCollections` is not a key the CMS models, so it lives in the document's unmodelled front matter; `DocumentKind.excludable` puts a "Hide from collections" checkbox on the page editor only, and `resolveExtra()` writes `true` when it is ticked, takes the key back out when it is not, and writes `false` instead when the file spelled the key out itself — a key added by hand is not the editor's to delete (doc-2). A post never touches it, even when a hand-made POST carries the field. And the listing shows an Updated column where a post shows Date, read from the index's `updated` with the publish date as a fallback, so the row costs no reads of its own.

Verified with 11 new node:test tests through `app.request` against temporary content directories, each mutation-checked: dropping the row's `updated`, never writing the exclude key, always deleting it when unticked, and removing the kind guard each failed exactly the test that names that behaviour. Then a manual curl pass against the running demo: a page created at `content/pages/{slug}.md` with no date prefix and public at `/{slug}/` at once (AC #1), trash and restore moving the file under `content/_trash/` and back with the public URL following (AC #2), and the listing showing title, author, updated and status (AC #3), plus the exclude checkbox in both directions. `pnpm test` (407 pass), `typecheck` and `lint` in the package, and the root `lint`, `typecheck`, `test` and `format:check` all pass; everything the manual pass wrote into `apps/demo` was removed.
<!-- SECTION:FINAL_SUMMARY:END -->
