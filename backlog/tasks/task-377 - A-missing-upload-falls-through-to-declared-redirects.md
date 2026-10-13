---
id: TASK-377
title: A missing upload falls through to declared redirects
status: To Do
assignee: []
created_date: '2026-10-13 02:35'
labels:
  - bug
milestone: m-31
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
- [ ] #1 A request for an /uploads/ path with no file behind it is answered by a matching path-only declared redirect, else 404 as today
- [ ] #2 An existing upload is served exactly as today, and a declared redirect never shadows one
- [ ] #3 On andrewshell.org, /uploads/2019/02/resume.pdf answers one 301 to /uploads/2026/03/resume.pdf
<!-- AC:END -->
