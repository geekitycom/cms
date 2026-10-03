---
id: TASK-241
title: Put a titled post's citation after its title
status: To Do
assignee: []
created_date: '2026-10-03 16:30'
updated_date: '2026-10-03 16:31'
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
- [ ] #1 A titled bookmark, like, repost or reply prints its title header first and the citation or reply context after it, before the content, on its page and in listings
- [ ] #2 An untitled note, like, repost, bookmark or reply prints them at the top as today
- [ ] #3 Parsing the page with microformats-parser gives the same h-entry properties as before
- [ ] #4 Theme README describes the placement
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current layout (themes/default/layouts/post.njk:38-59): the {% if named %} branch includes reply-context.njk and citations.njk deliberately before the header, under the comment 'A reply cites the post it answers'; the untitled branch prints them after the kicker. This task reverses the titled branch's order on the site owner's call (2026-10-03): move the two includes below </header>. post-list.njk includes them at lines 40 and 44 and needs the same named/untitled split.
<!-- SECTION:NOTES:END -->
