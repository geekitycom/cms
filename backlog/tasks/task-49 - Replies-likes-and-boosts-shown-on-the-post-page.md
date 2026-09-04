---
id: TASK-49
title: 'Replies, likes, and boosts shown on the post page'
status: To Do
assignee: []
created_date: '2026-09-04 01:34'
labels:
  - web
  - federation
  - theme
milestone: m-7
dependencies:
  - TASK-18
  - TASK-39
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The inbox log holds every fediverse reply, like and boost a post receives, and TASK-39 turns replies into feeds, but the HTML page never shows any of it. Render a conversation section under each post from the index: replies as a thread (author name, handle and avatar linking to the remote profile, sanitised content, time, a link to the remote note; nested by `inReplyTo` where a reply answers a reply the site has seen), and likes and boosts as counts with the actors behind them on hover or expand. The section is one template partial the theme may override, with the data handed to it in one documented shape so a theme can restyle it, and it also reaches an Eleventy build through the same data files the inbox log lives in. A deleted remote note (a `Delete` arriving for a reply) drops it. The thread is the shape native comments (next task) and webmentions join, so its data model is a comment with a `source`, not an ActivityPub-specific one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post with replies in the inbox log shows them under the post with author, avatar, content, time and a link to the remote note, newest last, nested where a reply answers a reply
- [ ] #2 Likes and boosts appear as counts with the actors listed on expand
- [ ] #3 Reply content is sanitised and a Delete of a reply removes it from the page
- [ ] #4 The section is a theme-overridable partial fed a documented data shape, and a page with no interactions renders no empty section
- [ ] #5 An Eleventy build of the same content can render the same replies from the data files
<!-- AC:END -->
