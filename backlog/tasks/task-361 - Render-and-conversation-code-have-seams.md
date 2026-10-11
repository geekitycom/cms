---
id: TASK-361
title: Render and conversation code have seams
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-35
dependencies:
  - TASK-360
type: chore
ordinal: 320800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/render.ts createRenderer is a 600-line closure with three copies of the 404/410/500 renderer. web/conversation.ts gather() is 160 lines with a nested-ternary group chooser and mutable dedupe state across loops. index.ts passes createRenderer 15 inline callbacks, some holding real logic (backlinks front-page check).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Status pages render through one function
- [ ] #2 gather is split into per-source steps merged at the end, and the group choice is a table keyed by interaction kind
- [ ] #3 Logic in the renderer callbacks moves into web modules
- [ ] #4 Conversation and render tests pass unchanged
<!-- AC:END -->
