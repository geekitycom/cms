---
id: TASK-273
title: 'The editor on DaisyUI: layout, groups, tabs, buttons and the cited card'
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-270
  - TASK-269
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 232800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the editor (documents/editor.njk, 497 lines, and the markup editor/main.ts builds at runtime) is laid out with utilities and the macros: the writing column and the side column, the collapsible groups, the Write/Preview tabs, the buttons (Save draft, Publish, Update, Move to trash, View), the upload control and status line, the cited-page card with its Remove toggle and alt-text field, and the conflict screen with its two versions side by side. The CodeMirror surface is the one authored exception: its .cm-* rules stay in the stylesheet source and read the theme's base tokens so the surface follows the chosen theme. Uploads, drag-and-drop, preview and the file-hash conflict check behave exactly as before. The MCP server's page architect has pages/cms-content-editor for the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The editor renders through the macros with a two-column layout that stacks on a narrow screen, and editor.test.ts, editor-location.test.ts, editor-geolocation.test.ts, cited-preview.test.ts and cited-image-alt.test.ts pass
- [ ] #2 Write and Preview are DaisyUI tabs with aria-selected, the upload control and status line are drawn with the macros' classes from editor/main.ts, and the CodeMirror surface follows the chosen theme in light and dark
- [ ] #3 The cited-page card is a card with its Remove toggle and alt-text field working as before, and the conflict screen shows both versions readable side by side
- [ ] #4 The editor and conflict templates carry no legacy admin-* class; the only authored rules left for them are the .cm-* ones
<!-- AC:END -->
