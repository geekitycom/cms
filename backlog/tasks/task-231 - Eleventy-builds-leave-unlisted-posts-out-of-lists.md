---
id: TASK-231
title: Eleventy builds leave unlisted posts out of lists
status: To Do
assignee: []
created_date: '2026-10-03 12:48'
labels:
  - eleventy
  - content
dependencies: []
priority: low
type: bug
ordinal: 246800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-227 added visibility: unlisted (and hides unrecognized values like a draft). The CMS reads the key; the example Eleventy config in apps/demo does not, so an Eleventy build of the same content/ still lists unlisted posts in collections, feeds and the sitemap, and still builds pages for posts with an unrecognized visibility. doc-2 and packages/cms/README.md record the gap. The 11ty compatibility promise (decision-9, doc-2) means a site built either way publishes the same set.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The example Eleventy config excludes unlisted posts from its collections and feeds and adds noindex to their pages
- [ ] #2 A post with an unrecognized visibility value gets no page in the Eleventy build
- [ ] #3 apps/demo's eleventy test covers both, and doc-2 drops the recorded gap
<!-- AC:END -->
