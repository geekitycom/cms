---
id: TASK-522
title: Shorten HTML error pages in recorded delivery errors
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-28T12:14:00Z'
updated_date: '2026-10-28T20:03:00Z'
labels:
  - federation
  - mcp
dependencies: []
priority: low
type: chore
ordinal: 424800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an inbox answers with an HTML error page, the recorded delivery error is Fedify's message with the whole page appended. On 2026-10-28 federation_status and post_federation on shll.me showed a 403 from https://me.dm/inbox as dozens of lines of Cloudflare markup (IE conditional comments, inline styles, script) cut off by the tool's truncation, when the useful part is the status and the page title, 'Attention Required! | Cloudflare'. The same text fills the admin delivery view. Keep the activity id, inbox and status line, and reduce an HTML body to its <title> (or the first line of text) plus a note that the body was HTML.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A delivery error whose response body is HTML is stored or shown as the status line plus the page title, not the markup
- [ ] #2 A plain-text or JSON error body is kept as it is today, within the existing length limit
- [ ] #3 federation_status, post_federation and the admin delivery view show the shortened error
- [ ] #4 Tests cover a Cloudflare-style HTML 403 body and a JSON error body
<!-- AC:END -->
