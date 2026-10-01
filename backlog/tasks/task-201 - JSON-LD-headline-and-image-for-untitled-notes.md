---
id: TASK-201
title: JSON-LD headline and image for untitled notes
status: To Do
assignee: []
created_date: '2026-10-01 17:07'
labels:
  - theme
  - seo
  - schema-org
dependencies: []
references:
  - packages/cms/themes/default/partials/jsonld.njk
  - backlog/decisions
priority: low
type: enhancement
ordinal: 217800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme's JSON-LD BlogPosting takes headline from the post's title (partials/jsonld.njk, decision-16), so a note, which has no title, has no headline. Its image comes from metaImage, so a note with no image in it has none either. Google lists headline and image as recommended for article rich results, so notes rarely qualify. Seen live on shll.me: /2026/09/this-post-should-be-able/ prints a BlogPosting with description but no headline or image. Give an untitled post a headline built the same way the theme builds the note's hidden h1 and its <title> (the summary or opening words, trimmed to Google's 110 characters on a word boundary), and fall back to the author's photo, then the site icon, for image when the post has none. Titled posts and pages keep today's values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An untitled note's BlogPosting has a headline matching its visible title text (the hidden h1 / <title>), at most 110 characters, cut on a word boundary
- [ ] #2 A post with no image of its own has image set to the author's photo, or the site icon when there is no photo; a post with an image keeps it
- [ ] #3 Titled posts and pages print the same headline and image as before
- [ ] #4 A note's page passes Google's Rich Results Test for Article with no missing recommended headline or image
<!-- AC:END -->
