---
id: TASK-253
title: 'Ask a known oEmbed provider before reading its page, and add Giphy'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 23:59'
updated_date: '2026-10-04 00:03'
labels:
  - webmention
  - indieweb
dependencies: []
priority: medium
type: bug
ordinal: 268800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-251 asks YouTube, TikTok and Reddit's oEmbed endpoints only after reading the page, so a YouTube page's own link can win. A youtu.be link redirects to a ~1 MB watch page, and at TASK-250's 3 s save-time deadline reading it once left no time for the endpoint, so the author was missing. For a provider in the table its own link is the same endpoint, so ask the table's endpoint first and read the page only when the endpoint gives nothing. Add Giphy (giphy.com/gifs/…, endpoint https://giphy.com/services/oembed): its page names no oEmbed endpoint and its title carries ' - Find & Share on GIPHY', while the endpoint answers with the clean title, author and the GIF (type photo), which TASK-252 uses.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A URL in the table asks its endpoint before any page read, and reads the page only when the endpoint fails or names nothing
- [x] #2 Giphy is in the table and a Giphy URL gets the endpoint's title and author, tested with stubbed hosts
- [x] #3 decision-19's table amendment is updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. TDD: rewrite the TASK-251 tests in reply-context.test.ts that pin page-then-endpoint order so table URLs expect [endpoint] alone when it answers, [endpoint, page] when it fails or names nothing; the page's own-link test becomes 'the table's endpoint is asked first, and the page link is not asked again'; the h-entry test becomes 'h-entry used when the endpoint names nothing'; refused page plus failed endpoint keeps the page reason; a hanging endpoint stays inside the one deadline. Add Giphy stubbed-host tests (giphy.com/gifs/... named from the endpoint, page with ' - Find & Share on GIPHY' never read) and an unlisted Giphy path.
2. reply-context.ts fetchReplyContext: knownEndpoint(target) first through fetchOembed (same guards, byte limit, one deadline); when describe() of that answer names something, return it without reading the page. Otherwise read the page with what is left of the deadline (never negative); h-entry wins; a non-table page asks its own oEmbed link; a table page does not ask oEmbed again. Failure keeps the page's refusal reason.
3. Add Giphy (giphy.com, www.giphy.com; /gifs/<slug>) -> https://giphy.com/services/oembed. Oembed fields unchanged.
4. Amend decision-19's TASK-251 table text with a TASK-253 amendment (order and Giphy); update the theme README line if it names the order.
5. Optional live check of youtu.be and a Giphy URL at 3 s from a scratch script; pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fetchReplyContext now asks knownEndpoint(target) first through fetchOembed (same fetchPublic guards, byte limit, one deadline); when describe() of that answer names a title or author it returns without reading the page. Otherwise the page is read with what is left of the deadline (not fetched at all when none is left, reason 'timed out'); h-entry wins, then og:title/<title>; a table page's own oEmbed link is not asked again since it is the endpoint that just failed. A URL outside the table is unchanged (page, then its linked endpoint). Giphy added: giphy.com and www.giphy.com /gifs/<slug> -> https://giphy.com/services/oembed. Oembed fields unchanged (title, author_name, author_url).

Tests (reply-context.test.ts, stubbed hosts): TASK-251's order-pinning tests rewritten, not dropped. YouTube watch/shorts/youtu.be, TikTok, Reddit and Giphy (giphy.com, www.giphy.com) now expect only the endpoint request; a Giphy photo answer gives title and author; a Reddit page that would 403 is never asked; endpoint 404, network error, answer with no title/author, or bidi-only title -> page read and named from og:title, requests [endpoint, page], page's own link not asked; both failing keeps 'answered 403' with [endpoint, page]; h-entry used when the endpoint names nothing; unlisted URLs incl. giphy.com/someone and giphy.com/gifs/ ask only the page; a hanging endpoint or a hanging page each end within the one 100 ms timeout. Failing-before run showed page-first request order, Giphy named 'Cat Kitten GIF - Find & Share on GIPHY' from its page, and a hanging endpoint still answered by the page.

Live check 2026-10-03 from a laptop at a 3 s deadline (scratch script, real DNS): youtu.be/dQw4w9WgXcQ 189 ms with title and author Rick Astley (TASK-251 lost the author here); youtube watch 63 ms; Vimeo (not in table) unchanged via page + linked endpoint. Giphy 103 ms with title and author, but the endpoint's title itself ends in ' - Find & Share on GIPHY' (checked with curl on three GIFs), so the description's 'clean title' premise does not hold; stripping that suffix is not built here.

decision-19: appended a TASK-253 amendment with the order and the table including Giphy. Theme README citation paragraph updated.

Validation: pnpm build, pnpm test (3849 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A cited YouTube, TikTok, Reddit or Giphy URL is now named from that provider's known oEmbed endpoint before its page is read, and the page is read only when the endpoint fails or names nothing, so a slow page (youtu.be's ~1 MB watch page) no longer starves the endpoint at the 3 s save-time deadline. Giphy (/gifs/ pages) joined the table. Everything else is unchanged: h-entry, og:title and <title> fallback, a non-table page's linked endpoint, the guards, byte limit and single deadline. Verified with rewritten stubbed-host tests for each criterion (failing first), a live 3 s run where youtu.be now carries its author, and the full build/test/typecheck/lint/format suite. decision-19 and the theme README record the change. Giphy's endpoint title still carries ' - Find & Share on GIPHY' (measured), which this task does not strip.
<!-- SECTION:FINAL_SUMMARY:END -->
