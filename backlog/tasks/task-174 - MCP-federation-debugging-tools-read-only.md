---
id: TASK-174
title: MCP federation debugging tools (read-only)
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
labels:
  - mcp
  - federation
milestone: m-26
dependencies:
  - TASK-172
references:
  - 'https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/'
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - backlog/docs/doc-7 - Webmentions.md
priority: high
type: feature
ordinal: 198800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Debugging ActivityPub today means grepping content/_data/federation/inbox/*.jsonl on the server and reading the ap_* tables by hand (for example, finding the Create that carried a Mastodon quote, or why me.dm answered 403). Give an agent read-only tools over what the site already records, each with readOnlyHint, an outputSchema, pagination and filters, and every one behind the operator read scope from the MCP endpoint task. Inbox activities hold other people's data, so nothing here is public. Tools, roughly: federation status (actors, key health, follower and relay counts, queue depth, recent failures); inbox search (by type, actor, object, recipient, time range) and fetching one activity's full JSON; what the site sends for a post (its current ActivityStreams object, the activities announced for it, and per-inbox delivery outcomes with reasons); followers and relays; quote approvals; webmentions sent and received for a post; and the access log filtered by path, status or user agent. Keep the set small and well named; agents reason better about few tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each tool is annotated readOnlyHint true, declares an outputSchema, and returns structured content plus a short text summary
- [ ] #2 Inbox search filters by activity type, actor, object id, recipient and time, pages through results, and returns an activity's full JSON on request
- [ ] #3 For a post, the tools show its ActivityStreams object as peers see it, every activity sent for it, and each inbox's delivery outcome and error
- [ ] #4 Followers, relays, quote approvals, webmentions and the access log are queryable with the same filter and paging conventions
- [ ] #5 Every tool requires the operator read scope and returns nothing without it, proven by tests
- [ ] #6 Tested against a fixture site: an agent-style script can answer why did this Create not show as a reply and which inboxes failed for this post from the tools alone
<!-- AC:END -->
