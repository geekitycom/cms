---
id: TASK-475
title: A post's Markdown includes its photos and its recording
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
labels:
  - markdown
  - public-site
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
  - packages/cms/themes/default/partials/photos.njk
  - packages/cms/themes/default/partials/recording.njk
ordinal: 400800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A photo post's photos and a podcast or video post's enclosure appear only as front matter in its Markdown. The HTML draws figures and a player with Download, Transcript or Captions, and Other versions links. The Markdown should carry them as Markdown: an image with its alt text per photo, and links to the recording, its transcript or captions, and its alternates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each photo of a post appears in its Markdown as an image with the photo's alt text, in the order the HTML draws them
- [ ] #2 A post with an enclosure links the recording (with its type and length where known), its transcript or captions, and each alternate version
- [ ] #3 The data is on the Markdown partial context, documented, and tested
<!-- AC:END -->
