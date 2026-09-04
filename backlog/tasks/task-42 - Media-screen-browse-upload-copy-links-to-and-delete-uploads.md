---
id: TASK-42
title: 'Media screen: browse, upload, copy links to, and delete uploads'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:14'
updated_date: '2026-09-04 13:17'
labels:
  - admin
milestone: m-6
dependencies:
  - TASK-13
  - TASK-28
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Uploads work from the editor ("Add file…" and drag-and-drop, TASK-13) and from the avatar panel (TASK-28), but nothing lists what has been uploaded, so a file uploaded last month cannot be found, linked again, replaced or removed. Add `/admin/media` as a section in the admin navigation: a grid or table of everything under `content/uploads/` newest first (thumbnail for images, an icon and size for the rest), the public URL with a copy control and the ready-made Markdown for it, the upload date, and which published or draft documents reference it (a search of the index for the path). An upload form on the screen uses the shared `storeUpload` helper, so the rules are the ones the editor enforces. Delete removes the file and, once the image optimization task exists, its variants; a file that a document still references asks for confirmation naming the documents. The screen reads the directory itself rather than a table, since the filesystem is the truth (decision-1, decision-9); a small index for reference counts is acceptable as a cache. Paging or a month filter keeps a large library usable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /admin/media lists every file under content/uploads newest first with thumbnail or icon, size, date and public URL, and appears in the admin navigation
- [x] #2 Each entry offers the public URL and the Markdown for it in a copyable form, and links to the documents that reference it
- [x] #3 Uploading from the screen stores the file exactly as the editor upload does and it appears in the list
- [x] #4 Deleting a file that no document references removes it from disk; deleting one that is referenced first names the documents and asks for confirmation
- [x] #5 A file dropped into content/uploads by hand appears in the list without a restart
- [x] #6 The screen works without JavaScript; the copy control is an enhancement
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module packages/cms/src/admin/media.ts: MEDIA_PATH=/admin/media, listUploads(contentDir) walking content/uploads recursively (readdir withFileTypes recursive), returning {relative, url, name, bytes, modified, image, extension} newest first by mtime, read per request so a hand-dropped file shows without a restart (AC #5).
2. Reference lookup: referencesTo(store, url) scans store.listAll (live + trash) document bodies for the upload's public URL, returning the documents that mention it, mapped to their editor URLs. A small helper mentionsUpload(body, url) does the matching so it is unit-testable.
3. Delete seam: deleteUpload({contentDir, relative, removeDerived}) unlinks the original and awaits an optional removeDerived hook, so TASK-43 can drop the sharp variants for the same file without touching this screen.
4. Routes in mountMediaScreen(app, {render}): GET /admin/media (paged listing, ?page=), POST /admin/media/upload (multipart via storeUpload, flash + 303), POST /admin/media/delete (unreferenced -> delete; referenced without confirm -> re-render the screen with a confirmation naming the documents and links to their editors; confirmed -> delete). Registered before the placeholder loop and added to ADMIN_SECTIONS.
5. Template packages/cms/admin/layouts/media.njk plus admin.css rules: a table with a thumbnail for images and an extension badge otherwise, size, date, readonly inputs holding the URL and the ready-made Markdown (work without JS), a copy button that the new admin/static/copy.js upgrades (clipboard only, hidden until the script runs).
6. Tests packages/cms/src/admin/media.test.ts using the __testing__ harness: listing order and hand-dropped file, upload through the screen, copyable URL/Markdown and reference links, delete unreferenced, delete referenced needs confirmation, no-JS shape, paging.
7. Docs: README section for the media screen, packages/cms/README.md route table rows and a subsection.
8. Gates: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, plus a manual curl pass against pnpm dev.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built `packages/cms/src/admin/media.ts` (the screen, the listing, the reference lookup and the delete), `packages/cms/admin/layouts/media.njk`, `packages/cms/admin/static/copy.js`, media rules in `admin/static/admin.css`, and `packages/cms/src/admin/media.test.ts` (20 tests). Wired into `routes.ts` (ADMIN_SECTIONS entry, mountMediaScreen, refuseOversizedUpload on the new multipart endpoint), `templates.ts`, and both barrels.

Decisions:
- The listing is `listUploads(contentDir)`, a recursive readdir + stat on every request. No table, no cache: the directory is the truth (decision-1, decision-9), which is what makes AC #5 fall out for free. Ordered by mtime rather than by the dated path, because a hand-dropped file may have no dated path. Dotfiles are skipped so .DS_Store never appears.
- `storeUpload` is reused unchanged, so the screen's upload form and the editor's control cannot disagree about what a site accepts. The Markdown was extracted out of `mountUploads` into `uploadMarkdown()` in uploads.ts and both callers now use it.
- `refuseOversizedUpload` now answers plain text rather than JSON when the request's Accept says text/html. The media form is a navigation, not a fetch, and it runs before the guard so there is no session to flash on.
- Reference lookup is `referencesTo(store, url)` over document bodies, live tree and trash. `mentionsUpload` is a substring search with a filename-character boundary, so photo.png is not matched by photo-2.png. It is blind to Markdown vs HTML vs prose because all three break when the file goes.
- The delete seam for TASK-43 is `deleteUpload({ contentDir, path, removeDerived })`; `mountMediaScreen` takes the same optional `removeDerived` and passes it through, so TASK-43 wires the variant cleanup with one argument at the mount site in routes.ts. The hook runs after the original is unlinked, so a throwing hook leaves stale variants rather than orphaned bytes.
- Submitted paths go through `resolveUpload`, which resolves against content/uploads and refuses anything landing outside.
- Copy is enhancement only: readonly inputs hold the URL and the Markdown, and copy.js reveals the buttons (rendered `hidden`) only when navigator.clipboard exists. No inline script, so the admin CSP stays a bare script-src 'self'.
- Paging rather than a month filter: 24 files a page, `?page=`, the same shape the document listing's pager has. The pagination helper in web/pagination.ts was not used — it builds an Eleventy-shaped object for the public listings and the admin listing does not use it either.

Verification: 883 package tests + 11 demo tests pass; pnpm build, typecheck, lint and format:check all clean. Also exercised against a real server (apps/demo/server.ts pointed at a scratch content dir via GEEKITY_CONTENT_DIR/GEEKITY_DATA_DIR on port 3000, killed afterwards): listing with a PNG thumbnail and a PDF badge, the Media nav entry marked aria-current, copy.js served 200 as text/javascript, an upload of 'Sunset Over Water.PNG' landing as 2026/09/sunset-over-water.png, a by-hand.pdf appearing without a restart, delete of an unreferenced file, the confirmation page naming the referencing post before a confirmed delete removed it, a ../ path refused with the document untouched, and the 413 arriving as plain text for a browser form and as JSON for the editor.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added /admin/media: a server-rendered library of everything under content/uploads, newest first, with a thumbnail for pictures and an extension badge for anything else, the size, the date, the public URL and the ready-made Markdown as readonly copyable fields, and links to every document that references the file. The listing walks the directory on every request rather than reading a table, so the filesystem stays the truth (decision-1, decision-9) and a hand-dropped file appears without a restart. The upload form reuses storeUpload, so the screen enforces exactly the editor's rules. Delete removes the file and calls an optional removeDerived hook (the seam TASK-43 fills for sharp variants); a file a document still points at first renders a confirmation naming those documents and linking to their editors. Everything works without JavaScript — copy.js only reveals Copy buttons that are rendered hidden.

Verified by 20 new tests in packages/cms/src/admin/media.test.ts (883 package tests and 11 demo tests pass in full), by pnpm build, typecheck, lint and format:check all clean, and by driving a real server on port 3000 over a scratch content directory: listing and navigation, copy.js served, an upload landing as 2026/09/sunset-over-water.png, a hand-dropped file appearing with no restart, an unreferenced delete, the two-step confirmed delete of a referenced file, a traversal path refused, and the oversized-upload 413 as plain text for a form and JSON for the editor.
<!-- SECTION:FINAL_SUMMARY:END -->
