---
id: TASK-67
title: 'Author profiles, author archives and author feeds'
status: To Do
assignee: []
created_date: '2026-09-05 13:51'
labels:
  - web
  - admin
  - content
milestone: m-11
dependencies: []
references:
  - packages/cms/src/admin/accounts.ts
  - packages/cms/src/admin/users.ts
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/feeds.ts
  - packages/cms/src/admin/documents.ts
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
type: feature
ordinal: 99100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-14 makes each user an actor at their author URL, so the URL has to be a page first. Give a user a profile: a display name, a short bio, an avatar and a list of links, edited on the users screen (an admin edits anyone's, a user edits their own) and stored in data/users.json beside the account. Make the author front matter name a user: a post says who wrote it by username, the editor sets it to the signed-in user for a new post and offers the list for an existing one, and an existing file whose author is a display name matching exactly one user's name reads as that user until it is next saved. Serve /author/{username}/ as an archive of that user's published posts, paged like the home page, and /author/{username}/feed/, /feed/atom/ and /feed/json/ as that user's feeds, shaped by the feed item from TASK-63 and linked from the archive. The templates get an author object with the profile so a theme can render a byline and a link; the default theme does. author joins the reserved top-level paths, and a username that is not a URL-safe slug is refused at creation. Nothing federates yet; TASK-68 puts the actor on this URL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A user has a display name, bio, avatar and links on the users screen, stored in data/users.json, editable by that user and by an admin; a user with no profile still has an archive under their username
- [ ] #2 A post's author is a username: the editor sets and offers it, the template context exposes the profile as author, and a file whose author is a display name matching exactly one user reads as that user
- [ ] #3 /author/{username}/ lists that user's published posts newest first with pagination and a 404 for an unknown user; /author/{username}/feed/, feed/atom/ and feed/json/ serve the same posts in the three formats with the archive advertising them
- [ ] #4 author is a reserved top-level path; a username that would not survive as a URL segment is refused when the user is created
- [ ] #5 The default theme shows a byline linking to the archive on a post and a heading with the profile on the archive; the demo's posts and its second user, if any, render
- [ ] #6 doc-2 (author front matter), doc-3 (author feeds), doc-5 (users screen) and the theme README describe it
<!-- AC:END -->
