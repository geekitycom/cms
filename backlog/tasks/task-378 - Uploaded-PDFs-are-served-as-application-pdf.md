---
id: TASK-378
title: Uploaded PDFs are served as application/pdf
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 02:38'
updated_date: '2026-10-15 11:48'
labels:
  - bug
milestone: m-39
dependencies: []
references:
  - packages/cms/src/files/static-files.ts
  - packages/cms/src/content/media.ts
  - packages/cms/src/files/upload-types.ts
priority: medium
ordinal: 337800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org migration (v0.31.0). Every PDF under content/uploads is served as Content-Type: application/octet-stream, so a browser downloads it instead of showing it. That includes Andrew's resume, /uploads/2026/03/resume.pdf, which prod WordPress serves as application/pdf (opened inline). The upload route takes its type from CONTENT_TYPES in files/static-files.ts (line ~102, falling back to application/octet-stream), and that table has no .pdf. content/media.ts accepts .pdf uploads as a document kind, so the two tables disagree about the same files. On this site every other upload type in use (png, jpg, gif, webp, mp3) is served correctly. Proposal: serve each upload with the type of its kind in media.ts's table, so any type the site accepts is served as what it is. Or, at least, add .pdf → application/pdf and check every accepted extension against the served type.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An uploaded .pdf is served with Content-Type: application/pdf
- [x] #2 Every extension media.ts accepts is served with a specific type, not application/octet-stream; a test pins the two tables together
- [x] #3 On andrewshell.org, /uploads/2026/03/resume.pdf opens in the browser, as it does on WordPress today
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Make the upload table the one source for how an upload extension is served: a servedType(media) helper (canonical declared type, plus '; charset=utf-8' for entries marked text: true).
2. Move content/media.ts to files/upload-types.ts (it has no imports), because the layer-boundary test forbids files/ importing content/; repoint every importer.
3. In files/static-files.ts drop the upload extensions from CONTENT_TYPES, keeping only theme-only types as THEME_CONTENT_TYPES; contentTypeFor looks the extension up in UPLOAD_MEDIA_TYPES first, then the theme table, then octet-stream.
4. Tests first: findAsset serves a .pdf as application/pdf; every extension in UPLOAD_MEDIA_TYPES is served as its canonical type (pins the tables).
5. Verify with curl against geekity serve with an uploaded PDF; run build/test/typecheck/lint/format:check.
6. AC #3 needs andrewshell.org on the CMS; leave unchecked and the task In Progress.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Uploads now take their served Content-Type from UPLOAD_MEDIA_TYPES via servedType() (canonical declared type, with '; charset=utf-8' for the entries marked text: true: .txt, .md, .vtt, .srt). static-files.ts keeps only the theme-only extensions (css, js, mjs, json, map, svg, ico, fonts, webmanifest) in THEME_CONTENT_TYPES. One table, not two kept in sync.

content/media.ts moved to files/upload-types.ts: static-files.ts sits in the files layer and layer-boundary.test.ts forbids it importing content/. The file had no imports, so the move only repoints importers; content/index.ts still re-exports the same names.

Behavior change beyond .pdf: an uploaded .md is now served as text/markdown; charset=utf-8 (it was application/octet-stream). Every other extension serves the same type as before.

Tests: static-files.test.ts 'serves an uploaded PDF as application/pdf' and 'serves every extension an upload may have as the type that upload is' both failed first with actual 'application/octet-stream', expected 'application/pdf'; both pass now.

Live check: geekity serve on a scratch site (geekity init, port 3478). A PDF uploaded through POST /admin/media/upload landed at /uploads/2026/10/cv.pdf, and a copied one at /uploads/2026/03/resume.pdf; curl -sI returned 200, content-type: application/pdf, for both. Server stopped.

Validation: pnpm build, pnpm test (cms 6121 pass, 0 fail; plugins and demo pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.

AC #3 stays open: andrewshell.org is still WordPress, so it can only be checked once the site runs on the CMS. Task left In Progress.
<!-- SECTION:NOTES:END -->
