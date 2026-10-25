---
id: TASK-176
title: MCP federation repair tools
status: Done
assignee:
  - '@claude'
created_date: 2026-09-29 02:13
updated_date: '2026-10-25T16:36:00Z'
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
- [x] #1 An agent can resend one post, retry failed deliveries for a post or an inbox, and refresh a remote actor, each returning the job or deliveries queued
- [x] #2 Resend runs as the existing resend job on the jobs queue, and bulk actions are queued and paced, never sent in a tight loop
- [x] #3 Annotations are accurate for every tool, and each requires the federation repair scope, proven by tests
- [x] #4 Every call is recorded in the audit log (TASK-178)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a retry is derived from the delivery record at run time, never stored: for a filter {slug?, inbox?}, the newest outcome per (post, recipient actor) that is failed. One Retry = {slug, recipients: [{actorId, inboxId, error}]}.

1. DeliveryService.resend(slug, {to?: actor ids}) narrows the fan-out to the targets holding those actors, so a retry sends the post as it reads now (Update/Create/Delete as a resend would) only to the recipients still failing, at their current inbox.
2. federation/retry-job.ts: failedRetries(services, filter) and a retry-deliveries job on the jobs queue that recomputes the plan when it runs (a repeat finds nothing), resends post by post through the serial delivery queue, and pauses between posts. Register it beside resend; label it on the health widget.
3. mcp/repair/: resend_post (enqueueUnlessActive RESEND_JOB {slugs:[slug], webmentions} exactly as the admin Resend button), retry_deliveries (post and/or inbox; previews the plan and enqueues the job), refresh_actor (signed fetch of the actor; rewrites every follower record holding it through addFollower and the actor profile cache; returns before/after inboxes). Scope repair; readOnlyHint false, destructiveHint false, idempotentHint true, openWorldHint true.
4. Tests first per criterion (mcp/repair/repair.test.ts, retry-job unit test, delivery narrowing), audit record test, scope 403 test, annotations test.
5. docs/mcp.md tools table + repair section; configuration.md admin jobs list.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Retrying failed deliveries did not exist (the admin offers Resend per post, which goes to every recipient, and Retry for a relay's follow). It is new here as a `retry-deliveries` job.

- DeliveryService.resend(slug, to?) narrows the fan-out to targets holding those actor ids, so a retry is a resend (Update/Create/Delete by the usual table) to the failing recipients only, at the inbox their follower record names now. Narrowing by actor rather than inbox is what lets a retry after refresh_actor reach a moved inbox.
- failedRetries() reads the delivery record each run: newest outcome per (post, actor), judged across every inbox, kept when failed and (with inbox) at that inbox. The job recomputes it when it runs, so a repeat after success finds nothing.
- The job paces: posts one at a time with RETRY_PACE_MS (2 s) between, abortable by the job signal, on top of the jobs queue running one job at a time.
- resend_post calls jobs.enqueueUnlessActive(RESEND_JOB, {slugs:[slug], webmentions}) exactly as the admin Resend button (webmentions defaults true like the button).
- refresh_actor fetches signed via siteLoaders + lookupObject, rewrites follower records through addFollower (keeps followedAt) and the actor_profiles row when one is stored. followerFrom now takes loaders instead of an inbox context. Fedify's key cache is not touched: it already refetches a key when a cached one fails to verify.
- Annotations: readOnly false, destructive false, idempotent true, openWorld true for all three.

Verification: pnpm build, pnpm test (cms 7633 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Mutation check: disabling the actor filter fails two repair tests. HTTP is exercised through cms.app.request on /_geekity/mcp (the real route stack); no live server was started.

Known limit (pre-existing resend semantics, not changed): a recipient whose failed delivery was the Create is retried with an Update when the post was announced; Mastodon drops an Update for a status it never stored. A retry also becomes the post's newest activity, so the federation screen's row counts that activity (e.g. 1 of 1).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added three MCP repair tools behind the repair scope: resend_post queues the existing resend job as the admin Resend button does; retry_deliveries finds recipients whose newest delivery of a post failed (by post, inbox, or both) and queues a new paced retry-deliveries job that resends each post to those recipients only; refresh_actor refetches a remote actor signed as the site and rewrites its follower records and stored profile. DeliveryService.resend gained an actor filter. Tests cover annotations, scope refusal, audit records, job payloads, narrowing, pacing and refresh-then-retry. All repo checks pass. Follow-up worth considering: retry a failed Create as a Create rather than an Update.
<!-- SECTION:FINAL_SUMMARY:END -->
