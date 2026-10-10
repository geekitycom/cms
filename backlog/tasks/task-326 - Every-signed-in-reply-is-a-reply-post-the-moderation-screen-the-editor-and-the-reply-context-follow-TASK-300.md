---
id: TASK-326
title: >-
  Every signed-in reply is a reply post: the moderation screen, the editor and
  the reply context follow TASK-300
status: To Do
assignee: []
created_date: '2026-10-10 14:37'
labels:
  - comments
dependencies:
  - TASK-300
references:
  - packages/cms/src/comments/reply-post.ts
  - packages/cms/src/webmention/reply-contexts.ts
priority: medium
type: enhancement
ordinal: 285800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gaps left by TASK-300 (decision-47), which made a signed-in user's reply from the thread a reply post:
- A reply written on the moderation screen (/admin/comments) is still stored as a native comment, so the same person's replies take two shapes depending on where they wrote them.
- A reply post written in the editor or over Micropub that answers a native comment sends the commenter no reply notice email; only the thread form does.
- A top-level reply post's in-reply-to is its own site's post permalink, which is still fetched over HTTP for its reply context; held replies already read from the index.
- The reply post's page says "In reply to a post by Ann" when it cites a comment; the theme labels any untitled context "a post".
- In the thread, a reply post's author link carries rel="nofollow ugc", which is for strangers' links, not the site's own users.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reply from the moderation screen is a reply post with the same in-reply-to, visibility default (unlisted) and inline display as one from the thread; existing owner comments are left as they are
- [ ] #2 A reply post answering a native comment whose writer asked for email sends the reply notice once, whether it was written in the thread, on the moderation screen, in the editor or over Micropub, and not again when the post is edited
- [ ] #3 A reply post whose in-reply-to is a post or page on this site takes its reply context from the index, with no HTTP fetch of the site's own page
- [ ] #4 A reply post citing a comment says "In reply to a comment by <name>"; citing a post or page it keeps today's wording
- [ ] #5 A reply post's author link in a thread carries no nofollow or ugc; visitor, webmention and fediverse author links keep them
- [ ] #6 doc-6 Native Comments describes the moderation-screen reply
<!-- AC:END -->
