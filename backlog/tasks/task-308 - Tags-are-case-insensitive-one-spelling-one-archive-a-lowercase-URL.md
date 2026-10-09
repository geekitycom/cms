---
id: TASK-308
title: 'Tags are case-insensitive: one spelling, one archive, a lowercase URL'
status: To Do
assignee: []
created_date: '2026-10-09 02:03'
labels: []
dependencies: []
references:
  - packages/cms/src/content/store.ts
  - packages/cms/src/web/taxonomy.ts
  - packages/cms/src/admin/taxonomy.ts
documentation:
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
priority: medium
type: enhancement
ordinal: 268800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tags are case-sensitive today: front matter keeps the spelling as typed, the index groups on the exact text, and the archive URL is the tag as written, so WordPress and wordpress are two tags with two archives, and on shll.me /tag/introductions/ answers 200 while /tag/Introductions/ is a 404. Andrew decided on 2026-10-09 to keep readable CamelCase spellings (fediverse practice and screen readers favour #WordCampUS) but treat tags case-insensitively. Files keep their spelling, so an Eleventy build of the same folder still works.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The index, tag counts, the tag list, tag archives, feeds by tag and search by tag treat tags case-insensitively: WordPress and wordpress are one tag with one count and one archive holding both posts
- [ ] #2 A tag's displayed spelling is one spelling chosen consistently (the most used, ties broken by the earliest use) everywhere the site shows the tag, including archive titles, post tag links, the admin tag screens and ActivityPub hashtags
- [ ] #3 A tag archive lives at the lowercase URL (/tag/wordcampus/), and any other casing of the path answers 301 there; pagination and feed URLs under it follow the same rule
- [ ] #4 Saving from the editor or Micropub reuses the site's existing spelling for a tag that matches one ignoring case, and the editor says when it did; the tag rename screen renames every casing of a tag at once
- [ ] #5 Plugins see one entry per tag (siteTags, listTags) in the site's spelling, so Tag suggest keeps matching as it does now
- [ ] #6 Tests cover mixed-case tags across documents for counts, archives, the redirect, feeds and the editor reuse; doc-2 says tags are matched without regard to case and how a static Eleventy build differs when files disagree on case
<!-- AC:END -->
