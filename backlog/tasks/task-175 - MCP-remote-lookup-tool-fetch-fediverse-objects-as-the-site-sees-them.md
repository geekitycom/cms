---
id: TASK-175
title: 'MCP remote lookup tool: fetch fediverse objects as the site sees them'
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
updated_date: '2026-10-23 16:55'
labels:
  - mcp
  - federation
milestone: m-26
dependencies:
  - TASK-172
  - TASK-178
references:
  - 'https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/'
priority: medium
type: feature
ordinal: 199800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Half of federation debugging is the other side: what does the remote actor document, inbox or note look like, and what does WebFinger return for a handle. Add a tool that resolves a handle through WebFinger and fetches a remote actor or object as ActivityStreams JSON, signed as the site's actor (as Fedify's lookup does), returning the status, the headers that matter and the body. It makes outbound requests, so it is annotated openWorldHint, guarded by the public-address checks in `util/public-address.ts` (the bounded fetch in `webmention/fetch-public.ts` already does this for webmentions and client metadata), bounded in time and size, and behind the operator read scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Given @user@host or a URL, the tool returns the WebFinger result and the fetched actor or object JSON, with the HTTP status
- [ ] #2 Requests are signed as a chosen local actor (default: the site author), so servers requiring authorized fetch answer
- [ ] #3 Private, loopback and link-local addresses are refused, and responses are bounded in time and size, proven by tests
- [ ] #4 The tool is annotated openWorldHint true and readOnlyHint true, and requires the operator read scope
<!-- AC:END -->
