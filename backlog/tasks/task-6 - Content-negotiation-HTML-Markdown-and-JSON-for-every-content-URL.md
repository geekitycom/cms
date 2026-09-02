---
id: TASK-6
title: 'Content negotiation: HTML, Markdown, and JSON for every content URL'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 13:26'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-5
references:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: feature
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement doc-3. Select representation by .md or .json extension first, then by Accept with q-values. Add Vary and Link alternate headers, ETag and Last-Modified with 304 handling, and a 406 with a JSON list of options. Listings negotiate HTML and JSON only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Accept: text/markdown on a post URL returns the stored file text with front matter and Content-Type text/markdown
- [ ] #2 Accept: application/json returns the documented JSON shape with schema, frontMatter, markdown, html, and url
- [ ] #3 Appending .md or .json to a permalink returns that representation regardless of Accept
- [ ] #4 Missing Accept or */* returns HTML
- [ ] #5 Accept with only unsupported types returns 406 with a JSON body listing alternates
- [ ] #6 Responses include Vary: Accept and Link alternate headers, and If-None-Match with a matching ETag returns 304
- [ ] #7 GET / with Accept: application/json returns an array of post summaries without markdown or html unless ?full=1
<!-- AC:END -->
