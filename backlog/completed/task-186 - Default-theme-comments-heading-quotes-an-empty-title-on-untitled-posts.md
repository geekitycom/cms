---
id: TASK-186
title: 'Default theme: comments heading quotes an empty title on untitled posts'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-30 04:31'
updated_date: '2026-10-01 11:42'
labels:
  - theme
  - accessibility
dependencies: []
priority: low
type: bug
ordinal: 205800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On an untitled note or reply with comments, h2.comments-title in packages/cms/themes/default/partials/conversation.njk (line ~126) prints 'One comment on “”' because it quotes the empty `title`. Found while building TASK-144, which gave untitled posts a hidden h1 naming the post type, author and date.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An untitled note with comments has a comments heading that names no empty title (for example 'One comment' or a heading using the post's label)
- [x] #2 A titled post's comments heading is unchanged
- [x] #3 A test over HTTP covers both cases
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm 3288d82 (TASK-187) already dropped the quoted title from h2.comments-title.
2. Add an HTTP test on the untitled note fixture in headings.test.ts asserting the exact heading 'One reply'.
3. Prove the test fails when the old quoted-title markup is restored.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The template fix landed in 3288d82 (TASK-187 paper restyle): h2.comments-title now reads 'One reply' / 'N replies' and quotes no title on any post. AC #2 is read against that decision. A titled post's heading no longer quotes its title either, by design in TASK-187, and conversation-markup.test.ts pins it exactly ('3 replies', 'One reply'). This task adds the missing untitled case: headings.test.ts asserts the coffee note's heading is exactly 'One reply'. With the old 'on “{{ title }}”' markup restored, that test and the two titled ones fail. Full suite: 2672 pass, 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an HTTP test that an untitled note with one comment is headed exactly 'One reply'. The template fix itself shipped in 3288d82. Verified by restoring the old quoted-title markup (the new test and both titled-post tests fail) and by the full suite passing.
<!-- SECTION:FINAL_SUMMARY:END -->
