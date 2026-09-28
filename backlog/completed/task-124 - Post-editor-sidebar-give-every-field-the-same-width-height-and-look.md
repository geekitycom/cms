---
id: TASK-124
title: 'Post editor sidebar: give every field the same width, height and look'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-24 11:58'
updated_date: '2026-09-24 12:03'
labels:
  - admin
  - css
dependencies: []
ordinal: 148800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The post editor sidebar (packages/cms/admin/pages/documents/editor.njk, .admin-editor-side) draws its fields inconsistently. Slug, Permalink, Date, Tags, Categories and Description are full-width boxes of one height, but "In reply to" is a short, thin box, the Author and Comments selects are browser-default size and styling, and the Draft checkbox sits indented off the left edge the other fields share. Likely cause: the shared field rule in admin/static/admin.css (around line 331) lists input[type=text], password and email but not url, and selects in the sidebar get no styling (only .admin-settings select does). The sidebar should read as one column of matching controls. Screenshot from 0.7.0 test site on 2026-09-24 shows the problem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 In reply to (type=url) renders at the same width, height, border and padding as the Slug field
- [x] #2 The Author and Comments selects match the text fields in width, height, border and font
- [x] #3 The Draft checkbox and its label line up with the left edge of the other sidebar fields
- [x] #4 The fix is in the shared admin field styles so other admin forms with url inputs or selects get the same treatment, and no existing admin screen regresses (settings, users, menus checked)
- [x] #5 Help text under every sidebar field uses the same size and spacing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add input[type=url] and select to the shared field rule in admin/static/admin.css, removing the .admin-settings select copy. 2. Give select a min-height matching a one-line text box, since it lays out at line-height: normal. 3. Zero the UA margin on .admin-check checkboxes. 4. Keep .admin-inline selects at their natural width. 5. Measure every control before/after in Chrome on the editor and the settings, users, navigation and federation screens.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured in Chrome (demo on a scratch data dir, pages snapshotted with before/after admin.css). Before: in-reply-to 147x22, 2px UA border; author 56x19 and comments 157x19 unstyled; draft checkbox 4px in from the field edge. After: every sidebar field 310x37 with one border, padding and 14px font; checkbox on the shared left edge. Other screens: Settings > Reading homepage and posts-page selects widen to their text fields (635x37); four settings checkboxes (discussion, federation) move 4px left onto the field edge; general settings, users and navigation unchanged. Help text already uses .admin-hint everywhere, so AC5 needed no change. pnpm --filter @geekity/cms test: 2260 pass, 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The shared admin field rule now covers url inputs and selects, selects match a text box height, and admin-check checkboxes drop the UA margin, so the post editor sidebar is one column of matching controls. Verified by measuring every control in Chrome before and after, on the editor and five other admin screens; cms tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
