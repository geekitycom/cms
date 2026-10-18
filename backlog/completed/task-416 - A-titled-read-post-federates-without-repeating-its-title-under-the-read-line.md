---
id: TASK-416
title: A titled read post federates without repeating its title under the read line
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 12:27'
updated_date: '2026-10-15 12:31'
labels: []
milestone: m-39
dependencies: []
references:
  - packages/cms/src/federation/article.ts
priority: medium
type: bug
ordinal: 371800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A titled read post federates as a Note (packages/cms/src/federation/article.ts). Its content is the citation, the read line, then noteContent, which puts the title in as a paragraph when the body does not open with it. On Mastodon (seen 2026-10-15 with https://shll.me/2026/10/miss-peregrines-home-for-peculiar-children/) this reads: Finished reading: <book> by <author>, ISBN… / <title> / <words>. The title sits between the read line and the words, and here it repeats the book's name. A Note should open with its title when it has one, as its page does (headline, then read line, then words). A read post whose title is just the book's name, which the read line already gives, should leave the title out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A titled read post's Note content opens with its title, then the read line, then its words; a test proves it
- [x] #2 A read post whose title equals the book's name, ignoring case and spacing, federates without the title paragraph; a test proves it
- [x] #3 Untitled notes, replies and other titled Notes keep their content as today
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in federation/article.test.ts: a titled read Note opens with its title paragraph, then the read line, then its words; a read whose title equals the read-of name (case and spacing ignored) has no title paragraph; a titled like keeps citation, title, words as today (AC#3).
2. In federation/article.ts build the Note heading separately from the body: for a read post the heading leads the citation and read line; otherwise it sits after them as today. Drop the heading when the title equals the read-of name.
3. Check feed-item.ts for the same ordering problem.
4. Run build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
federation/article.ts: the Note's title paragraph is built by noteHeading. A read post puts it before the citation and the read line. Every other Note still puts it after them, as today. The heading is dropped when the text opens with the title (as before), or when a read post's title equals read-of name, compared case-insensitively with whitespace collapsed.
Titled likes, replies, reposts and bookmarks keep citation, title, words (AC#3). A new test pins that for a titled like. The page puts the title before the citation for those too, so a later task could align them. That would change content Mastodon already shows, and AC#3 asks to keep it.
Feeds (web/feed-item.ts) have no such problem: the title goes in the item's own title field and the content is citations, read line, body.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A titled read post's Note now opens with its title paragraph, then the read line, then its words, as its page does. A read post titled with just the book's name (case and spacing ignored) leaves the title out. Other Notes keep their content. Tests in federation/article.test.ts: 'a titled read post's Note (TASK-416)' (two cases, both failed before the change) and 'a titled like's Note' (pins today's order). Verified with pnpm build, test, test:11ty, typecheck, lint and format:check, all passing.
<!-- SECTION:FINAL_SUMMARY:END -->
