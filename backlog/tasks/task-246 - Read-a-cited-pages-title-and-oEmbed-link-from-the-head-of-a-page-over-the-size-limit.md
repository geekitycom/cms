---
id: TASK-246
title: >-
  Read a cited page's title and oEmbed link from the head of a page over the
  size limit
status: To Do
assignee: []
created_date: '2026-10-03 18:07'
labels:
  - webmention
  - indieweb
dependencies: []
priority: medium
type: bug
ordinal: 261800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-244 found that a YouTube watch page is about 1.3 MB, over the reply-context fetch's 1,000,000-byte limit (packages/cms/src/webmention/reply-context.ts), so the whole page is refused and a liked or replied-to YouTube video shows its bare URL. The title, og:title and the oEmbed <link rel="alternate"> all sit in <head>, near the start.

When a fetched page is over the limit, read up to the limit and look for those in what was read instead of refusing it. An h-entry is still only trusted from a page read in full, so a truncated page gives only its head's title and oEmbed. The existing test that refuses a large page changes to this rule; amend decision-19 with it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A cited page over the size limit whose head names a title or an oEmbed endpoint gets that title and author, with a stubbed host serving more than the limit
- [ ] #2 A truncated page's h-entry is not used; no more than the limit is ever read
- [ ] #3 decision-19 records the rule
<!-- AC:END -->
