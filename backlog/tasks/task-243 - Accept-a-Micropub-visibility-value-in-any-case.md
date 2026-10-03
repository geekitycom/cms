---
id: TASK-243
title: Accept a Micropub visibility value in any case
status: To Do
assignee: []
created_date: '2026-10-03 16:39'
labels:
  - micropub
  - interop
dependencies: []
references:
  - 'https://github.com/gRegorLove/indiebookclub'
  - packages/cms/src/micropub/create.ts
priority: medium
type: bug
ordinal: 258800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
indiebookclub (0.18.0 on shll.me) posted a read with visibility 'Public' and got 400 'visibility is public or unlisted, not Public.' It builds its Visibility select from q=config's visibility list but ucfirsts each value and submits the label (get_visibility_options in app/Helper/Utils.php, gRegorLove/indiebookclub), so it always sends Public or Unlisted. Every indiebookclub post fails until this is fixed.

Compare a Micropub visibility value case-insensitively at the boundary (create and update in packages/cms/src/micropub/) and store the lowercase value. Front matter stays strict: a hand-typed visibility: Public in a file is still unrecognized and hides the post, as the TASK-227 store test pins. q=config keeps advertising lowercase values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Micropub create or update with visibility Public, PUBLIC or Unlisted is accepted and stores public (no key) or unlisted
- [ ] #2 A value that is not public or unlisted in any case is still refused with its message; private keeps its own message
- [ ] #3 Front matter with visibility: Public still reads as unrecognized
- [ ] #4 indiebookclub's request as App activity recorded it (summary, read-status finished, read-of h-cite, post-status published, visibility Public, category books) answers 201 in a test
<!-- AC:END -->
