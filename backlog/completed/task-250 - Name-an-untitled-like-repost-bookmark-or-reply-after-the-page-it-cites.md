---
id: TASK-250
title: 'Name an untitled like, repost, bookmark or reply after the page it cites'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 23:43'
updated_date: '2026-10-03 23:51'
labels:
  - micropub
  - content
dependencies: []
priority: medium
type: enhancement
ordinal: 265800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-242 names a new post with no title or text from its type and its target's host and path words. A YouTube like on shll.me (0.19.0) was filed at /2026/10/liked-youtube-com-watch/: the video's identity is in ?v=, so every YouTube like gets the same words. The site already fetches the cited page's title after a save (reply contexts, decision-19, TASK-244). For a new post whose slug would come from its target, fetch the cited page's context before choosing the slug, within a short timeout, and use its title: liked-, reposted-, bookmarked- or reply-to- followed by the first few words of the title. Keep what was fetched in the reply-context store so the save does not fetch it twice. When the fetch fails, times out or finds no title, fall back to today's host-and-path words. Only a new post's slug; an existing post keeps its permalink. A photo post keeps 'photo'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new like, repost, bookmark or reply with no title or text whose target has a title gets the prefix plus the title's first words as its slug, from Micropub and from the editor
- [x] #2 The fetched context is stored, and the target is not fetched a second time after the save
- [x] #3 A target that fails, times out or has no title falls back to the host-and-path slug, and the save waits no longer than the timeout
- [x] #4 An existing post's slug never changes; tests use stubbed hosts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests first (stubbed fetch + lookup, never the network): editor and Micropub creates of a like/repost/bookmark/reply with no title or text whose target has a <title> or oEmbed title get liked-/reposted-/bookmarked-/reply-to- plus the title's first words; the context lands in replyContexts.json and the target is fetched once across save and settle; a failing, untitled or slow target falls back to the host-and-path slug within the timeout; an existing post never fetches and keeps its slug.
2. ReplyContextService.describe(target): the stored context when the file holds one, else one fetch within CITED_SLUG_TIMEOUT_MS (3 s) that is stored on success and remembered, so handle() of the save that follows does not fetch it again. A failed or timed-out fetch stores nothing and handle() fetches as before with the full timeout.
3. writeDocument: DocumentSite gains citedContext(target); typeSlug becomes async and is reached only by a new post (an existing one stops at its own slug), naming the post prefix + first NOTE_SLUG_WORDS words of the context's name, else targetWords.
4. GeekityEnv carries replyContexts; the editor and Micropub pass c.var.replyContexts.describe.
5. Amend decision-19 (a new untitled citing post fetches at save within 3 s), update doc-2 and README slug fallback; build/test/typecheck/lint/format:check and a curl run against a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built on the reply-context service rather than a second fetch path. ReplyContextService.describe(target) returns the stored context when replyContexts.json holds one, else fetches once through fetchReplyContext (same SSRF guard, byte limit, head-of-page and oEmbed rules) with CITED_SLUG_TIMEOUT_MS = 3000, writes it to the file before the post is written, and remembers the target so handle() for the save's own change skips it. A failed, untitled or timed-out fetch stores nothing and handle() fetches as before with the full 10 s timeout. writeDocument reaches it through DocumentSite.citedContext (a plain function, so writeDocument stays testable); the editor and Micropub pass c.var.replyContexts.describe, which GeekityEnv now carries. typeSlug became async and is reached only by a new post, since document.slug sits earlier in the chain.

Choices: timeout 3 s. Measured from here, YouTube's watch page read to 1 MB took 0.36 s and its oEmbed 0.07 s, scripting.com 0.21 s, a Mastodon profile 0.62 s; 3 s is about five times the slowest, covers the page plus its oEmbed round trip on one shared deadline, and keeps a Publish click or a Quill request short. Word cap: NOTE_SLUG_WORDS (5), because a title is prose like a note's opening words, not address parts; the address fallback keeps TARGET_SLUG_WORDS (4). Only the context's name is used: a note with no name of its own (a Mastodon toot) falls back to address words. decision-19 amended for the save-time fetch; doc-2 and README mp-slug row updated.

Tests: src/admin/cited-title-slug.test.ts (stubbed fetch and lookup): editor and Micropub for like/repost/bookmark/reply (oEmbed, <title>, h-entry name), fetched once and stored (page + oEmbed once each across save and settle; fails when the handle() skip is removed), held context used, fallbacks for a failing, untitled and nameless-note target, a hanging target answered under 3 s + 1 s, an existing post keeps its slug. The title cases failed before the change with the address slug (e.g. actual 'liked-video-example-watch', expected 'liked-rick-astley-never-gonna-give').

Validation: pnpm build, test (3837 + 30 pass), typecheck, lint, format:check. Live: a scratch site on :4250 took real Micropub creates: YouTube like -> /2026/10/liked-rick-astley-never-gonna-give/ (0.96 s), scripting.com bookmark -> bookmarked-scripting-news (0.22 s), down.invalid like -> liked-down-invalid-watch (0.01 s); replyContexts.json held both contexts; the page answered 200. Server stopped, scratch files removed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A new like, repost, bookmark or reply with no title or text is now named after the page it cites: liked-rick-astley-never-gonna-give instead of liked-youtube-com-watch. The save asks the reply-context service, which uses a stored context or fetches once within 3 s, stores what it finds in replyContexts.json, and keeps the save's own change from fetching it again; a failed, untitled or slow target falls back to the host-and-path words, and an existing post never fetches or moves. Verified with stubbed-host tests for the editor and Micropub, the full build/test/typecheck/lint/format run, and real Micropub creates against a scratch site. decision-19 amended; doc-2 and README updated.
<!-- SECTION:FINAL_SUMMARY:END -->
