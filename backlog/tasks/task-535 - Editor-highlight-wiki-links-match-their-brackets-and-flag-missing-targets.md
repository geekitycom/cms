---
id: TASK-535
title: >-
  Editor: highlight [[wiki links]], match their brackets and flag missing
  targets
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-531
  - TASK-532
references:
  - decision-66
ordinal: 437800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: the operator wants the editor to show wiki links as they type and to see at a glance which ones point to a page that does not exist yet. The editor is CodeMirror 6 over a textarea (packages/cms/editor/main.ts, built by scripts/build-editor.js); it takes its URLs from #editor-enhance and has no completion today. Autocomplete was considered and not chosen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 In the post, page and wiki editors a `[[...]]` span is highlighted and its brackets are matched
- [ ] #2 A wiki link whose target slug has no wiki page is underlined as missing, updating as you type; a draft counts as present and a trashed page as missing
- [ ] #3 The editor slugifies with the same function as the server, so the hint agrees with the rendered link
- [ ] #4 With JavaScript off the textarea still works
<!-- AC:END -->
