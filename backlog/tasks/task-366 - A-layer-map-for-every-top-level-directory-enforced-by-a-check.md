---
id: TASK-366
title: 'A layer map for every top-level directory, enforced by a check'
status: To Do
assignee: []
created_date: '2026-10-12 11:31'
updated_date: '2026-10-12 11:31'
labels: []
milestone: m-36
dependencies:
  - TASK-365
priority: medium
type: chore
ordinal: 325800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After content/ is clean, the rest of packages/cms/src still forms cycles: site/ and web/ import each other (22 and 18 imports), admin/ imports web/ 33 times, web/ imports admin/ 17 times, and config.ts and env.ts are imported by and import from feature directories. Write down an ordered layer map (for example util and files at the bottom, then content and site, then features such as comments, webmention, federation and micropub, then web and admin delivery, then cms/ as the composition root) and make every directory follow it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docs/ (or a decision record) states the layer order and what each layer may import
- [ ] #2 A check that runs in pnpm test or pnpm lint enforces the map for every top-level directory under packages/cms/src and names the offending import and the rule it breaks
- [ ] #3 No cycles remain between top-level directories in non-test code, or each remaining one is listed as an explicit, documented exception
- [ ] #4 Public exports from the package index and @geekity/cms/plugin keep their names
- [ ] #5 Existing tests pass unchanged in behaviour
<!-- AC:END -->
