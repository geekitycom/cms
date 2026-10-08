---
id: TASK-293
title: A cross-posted post names its canonical URL elsewhere
status: To Do
assignee: []
created_date: '2026-10-08 11:00'
labels: []
milestone: m-31
dependencies: []
ordinal: 253800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post first published elsewhere, such as a Substack essay republished on the blog, should tell search engines and readers where the original lives. andrewshell.org has 17 such posts; its Eleventy site carried canonical_href in front matter, and the WordPress import lost it. Today the default theme always prints rel=canonical as the page's own URL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A front matter key (named in doc-2) holding an absolute https URL makes the page's <link rel="canonical"> point there instead of at its own URL
- [ ] #2 The value is exposed to themes in the template context, and the default theme shows a short "Originally published at ..." link to it on the post
- [ ] #3 A value that is not an absolute http(s) URL is ignored and named by geekity sync
- [ ] #4 The JSON and Markdown representations and the post's h-entry carry the original URL (u-syndication or u-url per microformats guidance, chosen in the task)
- [ ] #5 doc-2 and the default theme README document the key
<!-- AC:END -->
