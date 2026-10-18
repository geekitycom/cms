---
id: TASK-377
title: A missing upload falls through to declared redirects
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 02:35'
updated_date: '2026-10-15 11:48'
labels:
  - bug
milestone: m-39
dependencies: []
references:
  - packages/cms/src/web/asset-routes.ts
  - packages/cms/src/web/routes.ts
priority: low
ordinal: 336800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found building the andrewshell.org redirect generator (phase 3's legacy assets). The uploads route claims every /uploads/* path and answers a missing file with the 404 page (asset-routes.ts upload, 'if (asset === undefined) return notFound(c)'), before declared redirects run. So a redirect from an old upload URL can never answer: the same gap TASK-339 closed for taxonomy archives. andrewshell.org's 11ty site served files under /uploads/ that now live elsewhere: /uploads/2019/02/resume.pdf should go to the current /uploads/2026/03/resume.pdf (Andrew), and /uploads/2016/10/CreatorDiagram.png and /uploads/2018/09/Screen-Shot-2018-09-26-at-7.28.39-AM.png have byte-identical copies under other names. Their entries are in content/_data/redirects/legacy.json and answer 404. Proposal: when no file exists for an /uploads/ path, the request falls through to the next handler, so path-only declared redirects (and redirect_from) can answer it. Derived image variants (/uploads/_/…) keep answering 404, since they're never declared.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A request for an /uploads/ path with no file behind it is answered by a matching path-only declared redirect, else 404 as today
- [x] #2 An existing upload is served exactly as today, and a declared redirect never shadows one
- [x] #3 On andrewshell.org, /uploads/2019/02/resume.pdf answers one 301 to /uploads/2026/03/resume.pdf
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in web/redirects.test.ts: a missing /uploads/ path answered by a path-only declared redirect and by redirect_from, else 404; an existing upload with a redirect declared from its own path is served (200, bytes, type); a .geekity-strip temp file and a /uploads/_/ variant path keep answering 404 even with a declared redirect from them.
2. upload() in web/asset-routes.ts: a strip temp path answers 404 directly; any other path with no file calls next(), so the request reaches the not-found handler (resolveRequest): redirect_from, declared redirects, then 404. imageVariant stays as is (registered first, answers 404 itself).
3. Docs: describe the fall-through where redirects and uploads are documented.
4. Verify with pnpm build/test/typecheck/lint/format:check and curl against geekity serve with a declared redirect from a missing upload.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
upload() in web/asset-routes.ts now calls next() when no file is behind an /uploads/ path, so the request reaches the not-found handler (resolveRequest): redirect_from (movedHref), declared path-only redirects (findPathRedirect), then 404. The upload route still runs before that handler, so a declared redirect from a path where a file exists never answers. A .geekity-strip temp path (new isStripTemporary in content/uploads.ts, shared with findUpload) still answers 404 directly, and /uploads/_/ variants are claimed by imageVariant, registered first, which answers 404 itself.

Tests first in web/redirects.test.ts ('a declared redirect from an upload URL (TASK-377)'): the declared-redirect and redirect_from cases failed before the change ({status: 404, location: null} vs 301); the never-shadows and strip/variant cases guard the boundaries. A variant case with a non-image source answered 500 (sharp: unsupported image format) before and after: pre-existing, not in scope, so the test uses a missing source.

AC#1/#2 on a running geekity serve (scratchpad site, _data/redirects/legacy.json): HEAD /uploads/2019/02/resume.pdf 301 location /uploads/2026/03/resume.pdf, curl -L one hop to 200; /uploads/2019/02/other.pdf 404; /uploads/2026/03/resume.pdf (also declared as a from) 200 application/pdf; /uploads/2026/03/beach.jpg.geekity-strip (declared, file present) 404; /uploads/_/2019/02/gone.jpg/320.jpg (declared) 404. Server stopped.

AC#3 left open: andrewshell.org still runs WordPress; check after it moves to the CMS with legacy.json.

Docs: public-site.md Declared redirects (uploads are real pages; /uploads/_/ never reaches a redirect), configuration.md uploads paragraph.

Validation: pnpm build, pnpm test (cms 6125 pass, 0 fail; all packages green), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->
