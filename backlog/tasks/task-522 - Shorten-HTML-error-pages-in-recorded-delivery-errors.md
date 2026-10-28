---
id: TASK-522
title: Shorten HTML error pages in recorded delivery errors
status: Done
assignee:
  - '@claude'
created_date: '2026-10-28T12:14:00Z'
updated_date: '2026-10-28T20:17:00Z'
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
- [x] #1 A delivery error whose response body is HTML is stored or shown as the status line plus the page title, not the markup
- [x] #2 A plain-text or JSON error body is kept as it is today, within the existing length limit
- [x] #3 federation_status, post_federation and the admin delivery view show the shortened error
- [x] #4 Tests cover a Cloudflare-style HTML 403 body and a JSON error body
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Rewrite an error whose body after the first line is an HTML page into the first line plus the page title, in the delivery store on record, on settle and on read, so rows already stored are shortened too.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A delivery error whose response body is an HTML page (a Cloudflare challenge, a proxy error page) keeps Fedify's status line and becomes 'An HTML page titled "..."' (or 'An HTML page.' with no title), entities decoded. The rewrite runs in the delivery store when a row is recorded or settled and when it is read, so rows stored whole by older versions are shortened too, and federation_status, post_federation and the federation screen all read through it. Plain-text and JSON bodies are unchanged. Tests use the real me.dm Cloudflare error from shll.me, a titleless page, a JSON body and a row written whole into the database.
<!-- SECTION:FINAL_SUMMARY:END -->
