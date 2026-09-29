---
id: TASK-164
title: 'Micropub create: publish notes, articles and replies as Markdown files'
status: To Do
assignee: []
created_date: '2026-09-29 01:54'
labels:
  - micropub
  - indieweb
  - content
milestone: m-25
dependencies:
  - TASK-163
references:
  - 'https://www.w3.org/TR/micropub/'
documentation:
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
priority: high
type: feature
ordinal: 188800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core of Micropub. A POST with h=entry, form-encoded or JSON, creates a post through the same save path the admin editor uses, so the file, slug, permalink, author, webmentions, federation and feeds all behave as they do for an editor post. The token's user is the author. Properties map onto front matter: name to title, content (plain or {html}) to the body, summary to description, category to tags, in-reply-to, published to date, post-status draft to draft, and mp-slug to the slug. Record the mapping as a decision and add it to doc-2. Properties the site does not understand are refused rather than silently dropped, so the client can say so.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A form-encoded and a JSON create each return 201 with a Location header pointing at the new post's permalink, proven by tests
- [ ] #2 The written file is indistinguishable from one the editor would write for the same content, and Post Type Discovery gives it the same type
- [ ] #3 The post is authored by the token's user, and publishing it sends webmentions and federates exactly as an editor publish does
- [ ] #4 post-status draft writes a draft that is not published, federated or sent webmentions
- [ ] #5 A token without the create scope gets 403 insufficient_scope
- [ ] #6 Unsupported properties or types (for example like-of before those post types exist) get 400 with a message naming them, and no file is written
- [ ] #7 The property mapping is recorded as a decision and in doc-2
<!-- AC:END -->
