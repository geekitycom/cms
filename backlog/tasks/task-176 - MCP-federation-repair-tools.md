---
id: TASK-176
title: MCP federation repair tools
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
updated_date: '2026-09-29 02:14'
labels:
  - mcp
  - federation
milestone: m-26
dependencies:
  - TASK-174
priority: medium
type: feature
ordinal: 200800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once an agent has found a problem it should be able to fix the common ones without shell access to the server: resend a post (what geekity resend does), retry failed deliveries for a post or an inbox, and re-fetch a remote actor whose key or inbox changed. Each is a write, annotated honestly (readOnlyHint false; destructiveHint only where something is removed; idempotentHint where repeating is safe) and behind the federation repair scope. resend --all showed that back-to-back delivery can trip a remote server's bot protection (me.dm's Cloudflare answered 403 to one of seven Updates), so bulk actions go through the delivery queue rather than a tight loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An agent can resend one post, retry failed deliveries for a post or an inbox, and refresh a remote actor, each returning what was queued
- [ ] #2 Bulk actions are queued and paced, never sent in a tight loop
- [ ] #3 Annotations are accurate for every tool, and each requires the federation repair scope, proven by tests
- [ ] #4 Every call is recorded in the audit log (TASK-178)
<!-- AC:END -->
