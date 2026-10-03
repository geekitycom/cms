---
id: TASK-247
title: >-
  Strip direction-control characters from fetched names and drop an author a
  title already names
status: To Do
assignee: []
created_date: '2026-10-03 18:07'
labels:
  - webmention
  - theme
dependencies: []
priority: low
type: bug
ordinal: 262800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-244 found two blemishes on cited pages. Flickr's oEmbed author_name carries invisible Unicode bidi controls (U+202A-U+202E, U+2066-U+2069, U+200E/U+200F); they are escaped but printed, and the same holds for h-card names today, so a hostile name can reorder the text around it. SoundCloud's oEmbed title is 'Flickermood by Forss' with author_name 'Forss', so the citation reads 'Flickermood by Forss by Forss'.

In packages/cms/src/webmention/reply-context.ts, strip bidi control characters from every fetched name, author name and summary before storing. In the citation and reply-context partials, when the title already ends with ' by <author name>', do not print the author name again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Bidi control characters are removed from fetched titles, author names and words before they are stored, tested with a stubbed host
- [ ] #2 A title ending in 'by <author>' is not followed by the same author name again
<!-- AC:END -->
