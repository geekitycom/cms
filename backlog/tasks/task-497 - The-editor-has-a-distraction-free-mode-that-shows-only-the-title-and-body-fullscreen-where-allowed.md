---
id: TASK-497
title: >-
  The editor has a distraction-free mode that shows only the title and body,
  fullscreen where allowed
status: To Do
assignee: []
created_date: '2026-10-23 10:50'
labels:
  - admin
  - editor
  - accessibility
milestone: m-47
dependencies:
  - TASK-495
references:
  - packages/cms/editor/main.ts
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/src/admin/keyboard.test.ts
ordinal: 422800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-62: writing with the admin shell and sidebar in view is noisy. A Write in focus button and Ctrl/Cmd+Shift+F hide everything but the title and body, centred at a reading measure, with a quiet status line (word count and autosave status). There is no save button in this mode: autosave keeps the work and the writer exits to save or publish.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Write in focus button beside the Write/Preview tabs, and Ctrl/Cmd+Shift+F, enter the mode; it exists only when JavaScript runs
- [ ] #2 The mode hides the admin shell, the admin bar, the sidebar and every editor section but the title and body, and sets the body in a centred column at about 70ch in the admin theme, in light and dark
- [ ] #3 It requests the Fullscreen API where available; when refused or unavailable it fills the window instead; leaving browser fullscreen also leaves the mode
- [ ] #4 A status line shows the word count and the TASK-495 autosave status; the mode has an Exit button and no save button
- [ ] #5 Escape, the shortcut and Exit leave the mode and return focus to the control that entered it; focus never lands on hidden controls (they are inert while the mode is on)
- [ ] #6 Preview tab, upload and video controls either stay usable in the mode or are hidden with it; the editor content and cursor position are unchanged on enter and exit
- [ ] #7 Tests cover entering and leaving by each route, inert hidden content, and the no-JS editor being unchanged; a headless-browser check screenshots the mode in a light and a dark admin theme; docs/admin.md describes the mode and shortcut
<!-- AC:END -->
