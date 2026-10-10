---
id: TASK-337
title: A comment imported from a site user is attributed to that user
status: To Do
assignee: []
created_date: '2026-10-10 22:40'
labels:
  - enhancement
milestone: m-31
dependencies: []
priority: low
ordinal: 296800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org import (2026-10-08 export). WordPress records who wrote a comment while signed in: comment_user_id. Andrew's 5 replies (comments 4, 20, 22, 26 and 27 on posts 223 and 501) carry comment_user_id 2, his WordPress user. plugin-wordpress ignores it, so Geekity shows them as a stranger's comment: an author h-card linking to https://andrewshell.org/ with rel="nofollow ugc noopener noreferrer", and nothing marking him as the site's author. Since v0.29.0 a signed-in user's reply is a reply post, so a native one would be shown as the author's own. Proposal: when an imported comment's comment_user_id maps to a Geekity user (the same mapping post authors use, which matches by user name, as import wordpress-actor --wordpress-id does), the record names that user, and the thread shows it the way it shows a user's reply post: the user's own name and link, no nofollow ugc, marked as the site's author. Converting such comments into reply posts is out of scope; they stay migrated comment records (TASK-336).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 plugin-wordpress records the Geekity user on an imported comment whose comment_user_id maps to one
- [ ] #2 The thread shows such a comment as that user's, with their profile link and no rel=nofollow ugc, as it shows a user's reply post
- [ ] #3 On the andrewshell.org import, comments 4, 20, 22, 26 and 27 show as Andrew's
<!-- AC:END -->
