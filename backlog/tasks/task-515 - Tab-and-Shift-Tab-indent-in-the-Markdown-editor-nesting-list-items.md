---
id: TASK-515
title: Tab and Shift-Tab indent in the Markdown editor, nesting list items
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24T18:27:00Z'
updated_date: '2026-10-24T18:34:00Z'
labels:
  - editor
dependencies: []
priority: medium
type: feature
ordinal: 417800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the post editor, Tab moves focus to the next form field. CodeMirror leaves Tab unbound by default so keyboard users are never trapped. Writing a nested bulleted list then means leaving the editor, coming back, and typing spaces by hand. The author expects Tab to nest the list item they are on and Shift-Tab to bring it back out, like other writing tools. Ordered lists need the nesting to line up with the parent item's text (three spaces under `1. `), or Markdown renders the item as a sibling instead of a child.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tab on a list item nests it under the item above, indenting to that item's text column, so a bullet under `- ` gets two spaces and an item under `1. ` gets three
- [x] #2 Shift-Tab on a nested list item moves it back out to its parent's indent
- [x] #3 With several lines selected, Tab and Shift-Tab move them together and keep their relative indents
- [x] #4 Tab and Shift-Tab on a line that is not a list item indent and dedent the line instead of leaving the editor
- [x] #5 Escape then Tab still moves focus out of the editor, and the admin docs say so
- [x] #6 Unit tests cover the indent rule for bullets, ordered lists, the first item, Shift-Tab at the top level and multi-line selections
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pure rule in packages/cms/src/admin/list-indent.ts: for the first selected line, find the item above (sibling text column for Tab, parent indent for Shift-Tab) and return one shift for every selected non-blank line; undefined when the line is not a list item.
2. Unit tests beside it.
3. Bind Tab/Shift-Tab in editor/main.ts to a command that applies those shifts, falling back to indentMore/indentLess on plain lines. Add @codemirror/commands and @codemirror/view as direct devDependencies.
4. Document the keys and the Escape-then-Tab exit in docs/admin.md.
5. Check it in Chrome against the demo site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Checked in Chrome against the demo site with real key presses: Tab nested `- two` to two spaces and `2. two` to three; Enter after a nested item continued at that level; Shift-Tab brought the item back out and did nothing at the top level; a two-line selection moved as a block both ways; a plain line indented and dedented; Escape then Tab moved focus to the Write tab. Unit tests 14/14, cms suite 7499/7499, lint and typecheck clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tab and Shift-Tab now work in the post editor instead of moving focus to the next field. On a list item, Tab nests the item under the item above at that item's text column (two spaces under `- `, three under `1. `), so Markdown renders it as a child; Shift-Tab moves it back to its parent's indent. A multi-line selection moves as a block. On plain lines the keys indent and dedent. Escape then Tab still leaves the editor, as docs/admin.md now says. The rule is a pure function in src/admin/list-indent.ts with unit tests; editor/main.ts binds it. Known limit: a nested ordered item keeps its number (`2.` stays `2.`), so the nested list starts at 2 until renumbered by hand.
<!-- SECTION:FINAL_SUMMARY:END -->
