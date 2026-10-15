---
id: TASK-395
title: >-
  A titled read post lists cleanly: read line after the headline, summary not
  repeating it
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 21:12'
updated_date: '2026-10-15 01:23'
labels: []
milestone: m-39
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
- [x] #1 On a listing, a titled read post prints kicker, headline, summary, then the read line, matching where a titled reply, like, repost or bookmark puts its citation
- [x] #2 On a listing, a titled read post without a description shows an excerpt of its body, not the read line, as its summary
- [x] #3 Feeds keep their current summary for read posts (the read line leads it), unless the change is recorded as intended
- [x] #4 An untitled read post on a listing renders as before
- [x] #5 Each layout has a test on the rendered listing HTML
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Test first (src/web/read-listing.test.ts): a site with a titled read with words, a titled read with none and an untitled read, all tagged, filed and by one user; on each layout that includes partials/post-list.njk (home, tag, category, author; the demo theme overrides only post.njk) assert the order kicker, headline, summary, read line, Continue reading; the summary is the body's words; the untitled read keeps kicker, read line, words; RSS/Atom/JSON summaries still open with the read line.
2. excerpt.ts: postExcerpt(document) = description, else the body's first paragraph; feedExcerpt keeps prepending the read line.
3. Context gains excerpt (postExcerpt); summary unchanged, so meta description, JSON-LD and feeds keep the read line (TASK-233).
4. post-list.njk: the read partial moves into the cited block, so a titled read cites after title and summary and an untitled read prints it where it did; the summary prints post.excerpt.
5. Docs: template-context.md excerpt row, page-shell.md listing note. Verify with the full suite and a live render.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision: the listing gets its own line rather than changing `summary`. TASK-233 made a read's summary its read line on purpose for meta description, og/twitter, JSON-LD and the feeds, so `summary` (feedExcerpt) is unchanged and the context gains `excerpt` (postExcerpt in content/excerpt.ts: description, else the body's first paragraph, never the read line). post-list.njk prints `post.excerpt` under the headline and includes partials/read.njk at the end of the `cited` block, so a titled read prints it after title and summary like a titled reply/like/repost/bookmark, and an untitled read prints it where it did. A titled read with no body prints no p-summary and the read line after the headline. Docs: template-context.md (excerpt row), page-shell.md (read section).

Layouts: the default theme's home, tag, category and author layouts are the only ones that include post-list.njk; the demo theme overrides only post.njk. read-listing.test.ts runs every case on /, /tag/books/, /category/reading/ and /author/ada/.

Validation: read-listing.test.ts failed first: the read line sat before the headline (positions [43, 391, 687, 801, 924] for kicker, read line, title, summary, more), the summary was 'Finished reading: Dune by Frank Herbert, ISBN: 9780441013593' instead of 'I enjoyed this book.', and a titled read with no body printed the read line as its p-summary. AC #4: the untitled read's listing HTML on all four listings was dumped before and after; the diff is one blank line moving, the markup is otherwise identical. AC #3: RSS description, Atom summary and JSON Feed summary still equal the read line (test). pnpm build, test (cms 6145 pass, demo 32, plugins all pass), typecheck, lint, format:check clean. Live: demo content copy plus a titled read on :4395; /posts/ printed kicker, h2.feed-title, p-summary 'I enjoyed this book.', p.read-line, feed-more in that order; /feed/json/ summary is the read line. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A titled read post on a listing now prints kicker, headline, its own words as the summary, then the read line, the order a titled reply, like, repost or bookmark uses; the read line is printed once. The context gains `excerpt` (postExcerpt: description, else the body's first paragraph), which the listing prints; `summary` and the feeds keep the read line (TASK-233). An untitled read lists as before. Verified by read-listing.test.ts on the home, tag, category and author listings plus feed summaries, excerpt unit tests, the full suite and checks, and a live render of a demo-content site.
<!-- SECTION:FINAL_SUMMARY:END -->
