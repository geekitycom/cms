---
id: TASK-294
title: Embed a video in a post without writing iframe HTML
status: To Do
assignee: []
created_date: '2026-10-08 11:05'
labels: []
milestone: m-31
dependencies: []
priority: medium
ordinal: 254800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An author who wants a YouTube or Vimeo video in a post today pastes the provider's <iframe> code into the Markdown. That is HTML the author has to fetch, read and trust, it differs per provider, and it leaves no clean source behind in the file. Geekity should have one official, documented way to put a video in a post, written in the Markdown source without iframe code, that the site renders as a working player.\n\nHow it is written (a bare URL on its own line, a directive, a front matter key or something else) and how it renders (a direct iframe, a click-to-load facade, oEmbed or something else) are decisions for whoever picks this up. They are not settled here.\n\nThe andrewshell.org migration has 12 videos from the Eleventy site ({% youtube %} 9 times, {% vimeo %} 3 times) and YouTube links in 14 WordPress posts, so the importer will need a form to convert them to.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post can include a YouTube or Vimeo video using only something written in its Markdown source, with no iframe HTML
- [ ] #2 The published page shows a working, responsive player for the video
- [ ] #3 The Markdown, JSON, text/plain and feed representations of the post carry something meaningful for the video, at least a link to it
- [ ] #4 Adding a video from the editor does not require writing that syntax by hand
- [ ] #5 The chosen syntax, which providers it supports and how it renders are recorded in a decision, and doc-2 and the default theme README document it
- [ ] #6 A video URL the feature does not recognise stays a plain link
<!-- AC:END -->
