---
id: TASK-233
title: >-
  Read posts: webmention the read-of url, show the read line in feeds, keep the
  summary in step
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 13:04'
updated_date: '2026-10-03 13:56'
labels:
  - micropub
  - indieweb
  - feeds
dependencies: []
priority: medium
type: bug
ordinal: 248800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gaps left by TASK-229 (read posts), recorded in its notes. (1) A read-of url is not sent a webmention, unlike the like-of, repost-of and bookmark-of citations (targetsOf in src/webmention/service.ts adds citations). (2) Feeds print a read post's summary, not the read line the page and the federated Note show; a reader sees indiebookclub's summary or nothing. (3) indiebookclub stores a summary such as 'Want to read: Title by Author'; a later update of read-status to finished leaves that summary, so the post and its description disagree. Decide whether a read post's summary is derived from the read (and not stored), or replaced when read-status changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Publishing a read post whose read-of has a url sends that url a webmention, as a citation does
- [x] #2 RSS, Atom and JSON Feed items for a read post open with the same read line the page shows; FEED_ITEM_REVISION is bumped
- [x] #3 After read-status changes, nothing the site publishes still says the old status
- [x] #4 Tests cover each
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: the read line is one HTML string built by readLine(read) in content/read.ts, the markup partials/read.njk prints today (p.read-line, data.p-read-status, span.p-read-of h-cite with cite.p-name, p-author, data.p-uid). Every surface takes it from there: the theme context's read.line, the federated Note, the feed item, and the summary (its text).

1. content/read.ts: readLine(read) with escaping; unit test. Theme partial prints read.line; context gains it. Federation reading() replaced by readLine (Note content now carries the mf2 classes the page does).
2. Webmention: targetsOf adds read-of's url like a citation's (test in webmention/send.test.ts publishing a read post through the editor).
3. Feeds: FeedItem.html opens with the read line for a read post, ahead of photos and body; FEED_ITEM_REVISION 8 -> 9 with a history entry; refresh ETags in feed-enclosure.test.ts, anonymous-pages.golden.json, feed-item.test.ts, images/site.test.ts as needed.
4. Summary: a read post's summary is derived, not stored. The editor's write path (which Micropub create and update go through, decision-27) keeps no description on a read post, so indiebookclub's summary is not written and a read-status change drops one an older file carries. feedExcerpt of a read post without a description is the read line's text, so page meta, JSON-LD, list summary, feeds and an Article summary all say the current status; postLabel of an untitled read post reads the line too. q=source then returns no summary for a read post. Decision-27 amendment row.
5. Verify: pnpm build/test/typecheck/lint/format:check; live server: replay indiebookclub's request, update read-status to finished, fetch page, RSS/Atom/JSON feeds, JSON-LD and AS object, confirm none says Want to read.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: readLine(read) in content/read.ts is the one read line, the HTML partials/read.njk used to build (p.read-line, data.p-read-status, span.p-read-of h-cite with cite.p-name, p-author, data.p-uid, u-url when linked). The theme context's read.line, the partial, federation/article.ts reading(), FeedItem.html, feedExcerpt and postLabel all take it from there.

Decisions:
- Webmention: targetsOf sends read-of's url alongside the citations' (src/webmention/service.ts).
- Feeds: FeedItem.html opens with the read line, ahead of photos and body, so a read post with a cover photo still opens with its sentence. FEED_ITEM_REVISION 8 -> 9 with a history entry; feed-enclosure ETags and the anonymous-pages RSS ETag refreshed (bytes unchanged, sha256 fixtures held).
- The federated Note now carries the page's microformats classes in its read line (it was plain <p>/<cite>). One builder instead of two near-copies.
- Summary (AC #3): a read post's summary is derived, not stored. The editor's write path (which Micropub create and update go through) writes no description on a post with a read, so indiebookclub's summary is accepted and not stored, and the first save of an older file that changes its read drops the one it carried. feedExcerpt falls back to the read line's text, so meta/og/twitter description, JSON-LD, listing summary, feed summaries and an Article override's summary say the current status; postLabel of an untitled read reads the line first, so the page title, JSON-LD headline and og:title follow too. q=source returns no summary for a read post. Rejected: rewriting the stored summary on read-status change, which keeps a second copy a hand edit or a client's wording can leave stale. Recorded as a decision-27 amendment; editor hint under the Read fields says the Description is not kept for a read.
- A hand-written description in a read post's file is still published until the next save through the editor or Micropub; that is the author's own file.

Validation: pnpm build, pnpm test (3665 + 30 pass), typecheck, lint, format:check clean. Failing first: feed-item test (html lacked the line; revision 8), read.test.ts (no readLine), send.test.ts read test (sent [] vs the read-of url), indiebookclub AC #2 (RSS did not open with the line) and AC #3 (page said Want to read). Live: scratch server on :4329 with a minted token; curl replay of indiebookclub's JSON answered 201; update replace read-status finished answered 204; the page, index.md, index.json, home, /feed/, /feed/atom/, /feed/json/, /llms.txt and the AS object each contain 'Want to read' 0 times; meta description and JSON-LD say 'Finished reading: The Left Hand of Darkness by Ursula K. Le Guin, ISBN: 9780441478125'; the file has no description. An older file carrying description 'Want to read: Dune' updated to reading via Micropub lost the key and the page described itself 'Currently reading: Dune by Frank Herbert'. Server stopped, scratch script removed.

Orchestrator change: the admin editor refuses a save of a read post whose Description is not empty, with a message, instead of dropping the typed text silently. Micropub still accepts a client's generated summary for a read and stores none (indiebookclub's summary duplicates the read). Test: posts.test.ts 'refuses a description on a read rather than dropping it'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Read posts now say their read line in one place: readLine(read) in content/read.ts builds the HTML the theme partial, the federated Note and the feeds all print. A read-of url is sent a webmention like a citation. RSS, Atom and JSON Feed items open with the read line (FEED_ITEM_REVISION 9). A read post's summary is derived from the read and never stored: the editor's write path drops the description on a read (indiebookclub's summary included), and summaries, meta descriptions, JSON-LD and untitled labels read the line, so a read-status change shows everywhere; q=source returns no summary for a read (decision-27 amendment). Verified with new tests in read.test.ts, feed-item.test.ts, send.test.ts and indiebookclub.test.ts, the full suite, typecheck, lint and format check, and a curl replay against a running site where no published surface said Want to read after the update to finished.
<!-- SECTION:FINAL_SUMMARY:END -->
