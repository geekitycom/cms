---
id: TASK-395
title: >-
  A titled read post lists cleanly: read line after the headline, summary not
  repeating it
status: To Do
assignee: []
created_date: '2026-10-13 21:12'
labels: []
dependencies: []
references:
  - packages/cms/themes/default/partials/post-list.njk
  - packages/cms/src/content/excerpt.ts
  - packages/cms/src/web/context.ts
  - 'https://shll.me/'
priority: medium
type: bug
ordinal: 351800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a listing (the shll.me homepage), a read post with a title renders oddly. Seen with https://shll.me/2026/10/miss-peregrine-s-home-for-peculiar-children/ after its photo was removed:

1. The read line (Finished reading: <book> by <author>, ISBN) prints above the headline. partials/post-list.njk includes partials/read.njk unconditionally before the title, while a named post's other citations (reply context, like, repost, bookmark) are held in the cited block and printed after the title and summary.
2. The summary repeats the read line word for word. The listing's summary is feedExcerpt (src/content/excerpt.ts), which prepends the read line to the body when there is no description, so the listing prints the read line twice and never shows the author's own words (here, 'I enjoyed this book.').

An untitled read post (a note) is unaffected: it prints the read line and then its content.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a listing, a titled read post prints kicker, headline, summary, then the read line, matching where a titled reply, like, repost or bookmark puts its citation
- [ ] #2 On a listing, a titled read post without a description shows an excerpt of its body, not the read line, as its summary
- [ ] #3 Feeds keep their current summary for read posts (the read line leads it), unless the change is recorded as intended
- [ ] #4 An untitled read post on a listing renders as before
- [ ] #5 Each layout has a test on the rendered listing HTML
<!-- AC:END -->
