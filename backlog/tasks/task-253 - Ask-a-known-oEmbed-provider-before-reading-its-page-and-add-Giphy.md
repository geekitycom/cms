---
id: TASK-253
title: 'Ask a known oEmbed provider before reading its page, and add Giphy'
status: To Do
assignee: []
created_date: '2026-10-03 23:59'
labels:
  - webmention
  - indieweb
dependencies: []
priority: medium
type: bug
ordinal: 268800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-251 asks YouTube, TikTok and Reddit's oEmbed endpoints only after reading the page, so a YouTube page's own link can win. A youtu.be link redirects to a ~1 MB watch page, and at TASK-250's 3 s save-time deadline reading it once left no time for the endpoint, so the author was missing. For a provider in the table its own link is the same endpoint, so ask the table's endpoint first and read the page only when the endpoint gives nothing. Add Giphy (giphy.com/gifs/…, endpoint https://giphy.com/services/oembed): its page names no oEmbed endpoint and its title carries ' - Find & Share on GIPHY', while the endpoint answers with the clean title, author and the GIF (type photo), which TASK-252 uses.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A URL in the table asks its endpoint before any page read, and reads the page only when the endpoint fails or names nothing
- [ ] #2 Giphy is in the table and a Giphy URL gets the endpoint's title and author, tested with stubbed hosts
- [ ] #3 decision-19's table amendment is updated
<!-- AC:END -->
