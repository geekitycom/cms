---
id: TASK-241
title: Put a titled post's citation after its title
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:30'
updated_date: '2026-10-03 17:54'
labels:
  - theme
dependencies: []
references:
  - packages/cms/themes/default/layouts/post.njk
  - packages/cms/themes/default/partials/post-list.njk
priority: low
type: enhancement
ordinal: 256800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On https://shll.me/2026/10/scripting-news/ (0.18.0), a bookmark with a title, the default theme prints the citation ('Bookmarked http://scripting.com/', the u-bookmark-of h-cite) above the post header, so the page opens with a link before its kicker and 'Scripting News' heading. For an untitled note, like or repost the citation is the post's opening line and belongs at the top; for a titled post it reads after the title. The reply context (u-in-reply-to h-cite) sits in the same place and has the same problem for a titled reply.

Place the citation and the reply context by whether the post shows a title: after the header, before e-content, when it does; at the top as today when it does not. The same rule in post listings (partials/post-list.njk). Keep the markup inside the h-entry so mf2 parsing is unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A titled bookmark, like, repost or reply prints its title header first and the citation or reply context after it, before the content, on its page and in listings
- [x] #2 An untitled note, like, repost, bookmark or reply prints them at the top as today
- [x] #3 Parsing the page with microformats-parser gives the same h-entry properties as before
- [x] #4 Theme README describes the placement
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/web/citation-placement.test.ts: a titled and an untitled bookmark, like, repost and reply, plus an untitled note; assert document order (title header, then citation or reply context, then content) on each page and in the front-page listing, and pin each h-entry's mf2 properties to the output captured from the current theme before the change.
2. Run it red against the current theme (titled order fails, mf2 pins pass).
3. layouts/post.njk: move the reply-context and citations includes below </header> in the named branch, leave the untitled branch as is.
4. partials/post-list.njk: capture the citation block once (set/endset) and print it under the kicker for an untitled entry and after the title and summary for a titled one. Placement stays in the layouts; what a citation prints stays in citations.njk and reply-context.njk for TASK-244.
5. Update the layout comments and the theme README (reply-context and citations sections, listing section).
6. pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check; curl the demo site for a titled bookmark.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current layout (themes/default/layouts/post.njk:38-59): the {% if named %} branch includes reply-context.njk and citations.njk deliberately before the header, under the comment 'A reply cites the post it answers'; the untitled branch prints them after the kicker. This task reverses the titled branch's order on the site owner's call (2026-10-03): move the two includes below </header>. post-list.njk includes them at lines 40 and 44 and needs the same named/untitled split.

Built test-first: src/web/citation-placement.test.ts went red on exactly the eight titled cases (four pages, four listing entries) while the untitled and mf2 cases passed on the old theme, then green after the change.

layouts/post.njk: the named branch now prints header.post-header, then reply-context.njk and citations.njk, then recording, photos and e-content. The untitled branch is unchanged (hidden h1, kicker, citations). post-list.njk captures the reply context and citations once with {% set cited %}...{% endset %} and prints it under the kicker for an untitled entry, after the title and p-summary (before Continue reading) for a titled one. read.njk and photos stay where they were in the listing. Placement lives only in the two layouts; citations.njk and reply-context.njk are untouched, so TASK-244 can change what a citation says without touching where it goes.

mf2 proof: dumped every h-entry (each post page plus the front-page listing) through microformats-parser before and after the change; the outputs are identical once object keys are sorted (only key order moved, because name/summary now parse before the cite). The test also pins each entry's property keys, url, name and cited h-cite url.

Live check: demo server with a titled bookmark of http://scripting.com/ ('Scripting News') and an untitled like added to the gitignored playground copy. Titled page: post-header line 84, p-name 88, u-bookmark-of h-cite 92, e-content 98. Untitled like page: kicker 85, h-cite 90, e-content 96. Listing: titled entry prints feed-title, p-summary, h-cite, feed-more in that order; untitled like prints h-cite before its e-content. Server stopped and playground posts removed.

Validation: pnpm build, pnpm test (3744 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A titled post (bookmark, like, repost, reply) now prints its title header first and its citation or reply context after it, before its content, on its page and in listings; an untitled post still opens on the citation under its kicker. Placement moved in layouts/post.njk and partials/post-list.njk only; the citation partials are unchanged. Theme README describes the rule. Verified with the new citation-placement test (red then green), a before/after microformats-parser dump that is identical up to key order, a curl of the demo server with a titled bookmark of scripting.com, and pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
