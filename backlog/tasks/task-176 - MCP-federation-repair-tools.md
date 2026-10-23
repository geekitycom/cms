---
id: TASK-176
title: MCP federation repair tools
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
updated_date: '2026-10-23 16:55'
labels:
  - mcp
  - federation
milestone: m-26
dependencies:
  - TASK-174
  - TASK-178
priority: medium
type: feature
ordinal: 200800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once an agent has found a problem it should be able to fix the common ones without shell access to the server: resend a post, retry failed deliveries for a post or an inbox, and re-fetch a remote actor whose key or inbox changed. Resend is already a job (`RESEND_JOB` in `federation/resend-job.ts`, behind `geekity resend` and the admin federation screen's resend button), so the tool enqueues that job on the jobs queue rather than sending in-process. Check whether retrying failed deliveries exists today; if not, it is new work here.

Each tool is a write, annotated honestly (readOnlyHint false; destructiveHint only where something is removed; idempotentHint where repeating is safe) and behind the federation repair scope. resend --all showed that back-to-back delivery can trip a remote server's bot protection (me.dm's Cloudflare answered 403 to one of seven Updates), so bulk actions go through the queues rather than a tight loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An agent can resend one post, retry failed deliveries for a post or an inbox, and refresh a remote actor, each returning the job or deliveries queued
- [ ] #2 Resend runs as the existing resend job on the jobs queue, and bulk actions are queued and paced, never sent in a tight loop
- [ ] #3 Annotations are accurate for every tool, and each requires the federation repair scope, proven by tests
- [ ] #4 Every call is recorded in the audit log (TASK-178)
<!-- AC:END -->
