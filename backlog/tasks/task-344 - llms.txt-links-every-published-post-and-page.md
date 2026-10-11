---
id: TASK-344
title: llms.txt links every published post and page
status: To Do
assignee: []
created_date: '2026-10-11 13:33'
labels:
  - public-site
dependencies:
  - TASK-343
references:
  - packages/cms/src/web/llms.ts
priority: medium
type: enhancement
ordinal: 303800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/web/llms.ts writes the site's pages and then a "Recent posts" section from the same newest posts the feed carries (feedSize, 10 by default), with no dates or excerpts. The andrewshell.org migration found prod's llms.txt lists about 50 posts (asdo_geekity _local/PLAN.md, 2026-10-11).

Andrew, 2026-10-11: llms.txt should link to all pages and posts.

List every published post and page, each linking to its Markdown representation as today, with a post's date and its excerpt (description, or the summary the feeds use). Keep it one file: a large site gets a long llms.txt. Drafts, future-dated, unlisted, private and trashed documents stay out, as they stay out of the sitemap. A site's own content/llms.txt still replaces the generated one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /llms.txt lists every published post and every published page, each linking to its Markdown representation
- [ ] #2 Each post line carries its date and its excerpt; an untitled post or page uses the label TASK-343 gives it
- [ ] #3 Drafts, future-dated, unlisted, private and trashed documents are absent, by the same rule the sitemap uses
- [ ] #4 A site's own content/llms.txt still replaces the generated file
- [ ] #5 docs/public-site.md describes what llms.txt lists
<!-- AC:END -->
