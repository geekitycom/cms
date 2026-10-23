---
id: TASK-502
title: 'Editor word count and words written today, in normal and focus mode'
status: To Do
assignee: []
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 14:25'
labels:
  - writing-goals
milestone: m-48
dependencies:
  - TASK-498
  - TASK-499
ordinal: 415800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The post and page editor always shows the body's current word count and the words the user wrote today, in the normal view and in the focus mode bar ("1,240 words · 312 today"). The page carries today's total, each autosave response updates it, and the bundle adds the words typed since the last autosave using the shared module. See decision-63, "The editor".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The normal editor shows the current word count of the body, updating as the writer types
- [ ] #2 Focus mode shows the same count and today's words in its bar
- [ ] #3 Words written today rise as the writer types and match the ledger after the next autosave
- [ ] #4 Deleting text lowers the word count but never lowers words written today
- [ ] #5 Without JavaScript the editor shows the counts as of page load
- [ ] #6 The counter is announced politely to screen readers at most when typing pauses, not on every keystroke
- [ ] #7 Words written today show only for a user tracking writing goals; the current word count shows for everyone
<!-- AC:END -->
