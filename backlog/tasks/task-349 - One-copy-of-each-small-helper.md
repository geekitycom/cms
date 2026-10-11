---
id: TASK-349
title: One copy of each small helper
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-32
dependencies:
  - TASK-348
type: chore
ordinal: 308800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The architecture review found many hand-copied helpers in packages/cms/src: messageOf (21 copies), isRecord (14 including plugins), the form string coercion field()/text() (about 20), exists()/ENOENT checks (about 6), two full HTML entity decoders (web/sanitize.ts, webmention/html.ts), HTML escapers (12 copies that disagree on > " and quote), and Math.ceil(total/size) page counts outside web/pagination.ts. Each should exist once, so a fix lands once.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 messageOf, isRecord, the form string coercion and a file exists check each have one definition in cms, imported everywhere they were copied
- [ ] #2 HTML escaping uses one text escaper and one attribute escaper; no file keeps a private escaper, and existing output tests still pass
- [ ] #3 The two full entity decoders are one function
- [ ] #4 Page counts outside pagination.ts call a pagination.ts helper
- [ ] #5 Nullable form-field variants that mean something different (null or undefined for empty) stay distinct and named for what they do
<!-- AC:END -->
