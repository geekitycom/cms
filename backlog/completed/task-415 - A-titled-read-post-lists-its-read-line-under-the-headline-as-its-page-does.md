---
id: TASK-415
title: 'A titled read post lists its read line under the headline, as its page does'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 12:05'
updated_date: '2026-10-15 12:09'
labels: []
milestone: m-39
dependencies: []
references:
  - packages/cms/themes/default/partials/post-list.njk
  - packages/cms/src/web/read-listing.test.ts
priority: medium
type: bug
ordinal: 370800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-395 put a titled read post's read line after its headline and excerpt on a listing, copying where a titled reply, like, repost or bookmark puts its citation. On shll.me (0.32.0) that reads badly next to the post page, which prints the headline, then the read line with its book cover, then the words: on the homepage the excerpt comes first and the read line with its cover trails after it. A titled read post on a listing should follow its own page: kicker, headline, read line (with cover), excerpt, Continue reading. Titled replies, likes, reposts and bookmarks keep their citation after the summary; untitled read posts are unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On a listing, a titled read post prints kicker, headline, read line, excerpt, then Continue reading; a test on every listing layout proves the order
- [x] #2 A titled reply, like, repost or bookmark still prints its citation after its summary, and an untitled read post lists as before
- [x] #3 The partial's header comment and the theme docs describe the order
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Change read-listing.test.ts to expect kicker, headline, read line, excerpt, Continue reading for a titled read post, and watch it fail. 2. In post-list.njk, print a titled post's read line right after the headline and keep the other citations after the summary. 3. Update the header comment and docs/theme/page-shell.md. 4. Run the full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
post-list.njk now builds the read line apart from the other citations. A titled post prints it under its headline and before its excerpt, the order its page uses. Untitled posts print the citations, then the read line, as before. read-listing.test.ts asserts kicker, headline, read line, excerpt, feed-more on /, a tag, a category and the author listing; it failed on all four before the change. listings.test.ts and read-cover.test.ts still pass, so a titled reply, like, repost or bookmark keeps its citation after the summary. The header comment and docs/theme/page-shell.md describe the order. All checks pass, test:11ty included.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A titled read post on a listing prints its read line, with the cover, under the headline and before the excerpt, as its own page does. Other citations keep their place after the summary.
<!-- SECTION:FINAL_SUMMARY:END -->
