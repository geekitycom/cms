---
id: TASK-518
title: Cap the MCP request body before parsing it
status: To Do
assignee: []
created_date: '2026-10-25T16:59:00Z'
labels:
  - mcp
  - security
milestone: m-26
dependencies: []
priority: medium
type: bug
ordinal: 420800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The MCP endpoint (packages/cms/src/mcp/endpoint.ts) calls c.req.json() with no size cap, so upload_media refuses oversize data only after the whole JSON body is parsed. Add a content-length and streamed-size guard like the one Micropub uses (requireSiteToken / its body limit), sized from largestUploadLimit plus base64 overhead, and answer an oversize body with 413 before parsing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A request body over the cap gets 413 and is not parsed
- [ ] #2 A body without content-length is cut off at the cap while streaming
- [ ] #3 An upload_media call at the largest allowed file size still succeeds
- [ ] #4 docs/mcp.md states the limit
<!-- AC:END -->
