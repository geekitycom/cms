---
id: TASK-174
title: MCP federation debugging tools (read-only)
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
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - backlog/docs/doc-7 - Webmentions.md
priority: high
type: feature
ordinal: 198800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Debugging ActivityPub today means reading the SQLite stores in `data/geekity.db` by hand (`ap_inbox`, `ap_outbound`, `ap_deliveries_standalone`, `ap_relays`, `followers`, `webmentions_sent`, `comments`), for example to find the Create that carried a Mastodon quote, or why me.dm answered 403. Give an agent read-only tools over what the site already records, through the existing stores (`InboxStore`, `DeliveryStore`, `FollowerStore`, `RelayStore`, `WebmentionStore`, `CommentStore`), each with readOnlyHint, an outputSchema, pagination and filters, and every one behind the operator read scope from TASK-172. Inbox activities hold other people's data, so nothing here is public.

Tools, roughly: federation status (actors, key health, follower and relay counts, federation queue depth and retrying deliveries, recent failures, recent jobs from the jobs queue); inbox search (by type, actor, object, recipient, time range) and fetching one activity's full JSON; what the site sends for a post (its current ActivityStreams object, the activities sent for it, and per-inbox delivery outcomes with the recorded error); followers and relays; quote approvals (per-user `quotes.json`); and webmentions sent and received for a post. Keep the set small and well named; agents reason better about few tools.

Not in scope: the access log only writes to stdout and refused signatures are only logged, so neither can be queried. If a real debugging session needs them, file a task to store them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each tool is registered in the TASK-172 registry, annotated readOnlyHint true, declares an outputSchema, and returns structured content plus a short text summary
- [ ] #2 Inbox search filters by activity type, actor, object id, recipient and time, pages through results, and returns an activity full JSON on request
- [ ] #3 For a post, the tools show its ActivityStreams object as peers see it, every activity sent for it, and each inbox delivery outcome and error
- [ ] #4 Followers, relays, quote approvals and webmentions are queryable with the same filter and paging conventions
- [ ] #5 Federation status reports queue depth, retrying deliveries and recent job outcomes
- [ ] #6 Every tool requires the operator read scope and returns nothing without it, proven by tests
- [ ] #7 Tested against a fixture site: an agent-style script can answer why did this Create not show as a reply and which inboxes failed for this post from the tools alone
<!-- AC:END -->
