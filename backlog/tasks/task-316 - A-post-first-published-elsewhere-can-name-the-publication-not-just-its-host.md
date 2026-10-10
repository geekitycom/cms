---
id: TASK-316
title: 'A post first published elsewhere can name the publication, not just its host'
status: To Do
assignee: []
created_date: '2026-10-10 09:43'
labels:
  - enhancement
milestone: m-31
dependencies: []
references:
  - /Users/andrewshell/code/personal/blog-asdo-11ty/_includes/layouts/essay.njk
  - packages/cms/src/content/original.ts
priority: low
ordinal: 275800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-293. andrewshell.org post 133, Why You're Great at Setting Bad Goals, was a guest post first published on Smarter Engineers, someone else's Substack (canonical_href https://open.substack.com/pub/albexl/p/why-youre-great-at-setting-bad-goals). Its Eleventy front matter also carried canonical_name: "Smarter Engineers", and the Eleventy essay layout printed 'This essay was originally published on {{ canonical_name | default("my Substack newsletter") }}.' WordPress dropped both keys. TASK-293 brought back canonical_href: rel=canonical points at the original, and the default theme's entry meta prints 'Originally published at <host>' from hostLink(). The label is always the URL's host, so post 133 reads 'Originally published at open.substack.com', which names a generic Substack host rather than the publication, and canonical_name is unread. The other 16 cross-posts are on andrewshell.substack.com, where the host reads fine. Proposal: read canonical_name (the Eleventy key, so the value copies over as canonical_href did) as the label of the original link when it is a non-empty string, falling back to the host. The asdo_geekity migration overlay already carries canonical_name into the post, where core keeps it as an unread extra key, so the value is in place when this lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 canonical_name, a non-empty string next to a valid canonical_href, becomes the label of the theme context's original link; without it the label stays the host
- [ ] #2 The default theme's entry meta prints 'Originally published at Smarter Engineers' for a post with that canonical_name, linking canonical_href
- [ ] #3 canonical_name without a valid canonical_href is ignored and named by geekity sync, like an invalid canonical_href
- [ ] #4 doc-2's extra-keys table and the default theme README document the key next to canonical_href
<!-- AC:END -->
