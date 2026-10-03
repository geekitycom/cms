---
id: TASK-246
title: >-
  Read a cited page's title and oEmbed link from the head of a page over the
  size limit
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 18:07'
updated_date: '2026-10-03 18:28'
labels:
  - webmention
  - indieweb
dependencies: []
priority: medium
type: bug
ordinal: 261800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-244 found that a YouTube watch page is about 1.3 MB, over the reply-context fetch's 1,000,000-byte limit (packages/cms/src/webmention/reply-context.ts), so the whole page is refused and a liked or replied-to YouTube video shows its bare URL. The title, og:title and the oEmbed <link rel="alternate"> all sit in <head>, near the start.

When a fetched page is over the limit, read up to the limit and look for those in what was read instead of refusing it. An h-entry is still only trusted from a page read in full, so a truncated page gives only its head's title and oEmbed. The existing test that refuses a large page changes to this rule; amend decision-19 with it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A cited page over the size limit whose head names a title or an oEmbed endpoint gets that title and author, with a stubbed host serving more than the limit
- [x] #2 A truncated page's h-entry is not used; no more than the limit is ever read
- [x] #3 decision-19 records the rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. fetch-public.ts: add opt-in FetchPublicOptions.overflow ('refuse' default | 'truncate'). In truncate mode a body over maxBytes (declared or streamed) is read up to exactly maxBytes, the stream is cancelled, and the ok result carries truncated: true. Every ok result carries truncated; other callers (avatars, indieauth) keep refusing.
2. reply-context.ts: fetch the page with overflow 'truncate'; skip citedEntry when truncated so only <title>, og:title, description and the oEmbed link are read. The oEmbed JSON keeps the refusing default, since truncated JSON does not parse.
3. Tests first in reply-context.test.ts: replace the 'too big' refusal with a truncated page giving its head's title, plus oEmbed title/author from a head over the limit; a truncated page with an h-entry in the read part is not described by it; a pull-counting stream proves no more than the limit is kept and the stream is cancelled; a page with nothing readable in its head still refuses with 'nothing to show'. Keep the oEmbed-over-limit test.
4. Append a TASK-246 amendment to decision-19.
5. pnpm build/test/typecheck/lint/format:check; scratch YouTube check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fetchPublic gained an opt-in overflow: 'truncate' that cuts a body at maxBytes (streamed or declared by Content-Length), cancels the rest, and marks the result truncated. Every ok PublicFetch now carries truncated; avatars and indieauth leave overflow unset and keep refusing. fetchReplyContext opts in and skips citedEntry on a truncated page; the oEmbed JSON fetch keeps refusing.
Tests (reply-context.test.ts): head of an over-limit page gives its title and a meta past the limit is absent (with and without Content-Length); an h-entry on a truncated page is not used (mutation check: removing the guard makes it fail with name 'Growing tomatoes'); an endless pull stream is cancelled after at most limit + one 100-byte chunk; a big page with nothing in its head is 'nothing to show'; an over-limit page's oEmbed link gives title and author. All five failed first with 'larger than N bytes'.
Validation: pnpm build && pnpm test (3795 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check, exit 0. Live: fetchReplyContext('https://www.youtube.com/watch?v=dQw4w9WgXcQ') from a scratch script returned name 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', author Rick Astley with https://www.youtube.com/@RickAstleyYT, and the description excerpt.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A cited page over the 1,000,000-byte limit is now read up to the limit instead of refused, and described by its head's title, description and oEmbed endpoint; its h-entry is not trusted. fetchPublic takes an opt-in overflow: 'truncate' that only the cited-page fetch uses; oEmbed JSON and every other caller still refuse an oversized body. decision-19 gained a TASK-246 amendment. Verified with five new tests that failed first, a mutation check, the full build/test/typecheck/lint/format suite, and a live YouTube watch page that now yields its title and channel.
<!-- SECTION:FINAL_SUMMARY:END -->
