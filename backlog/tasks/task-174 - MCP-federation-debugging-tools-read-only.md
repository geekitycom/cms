---
id: TASK-174
title: MCP federation debugging tools (read-only)
status: Done
assignee:
  - '@claude'
created_date: 2026-09-29 02:13
updated_date: '2026-10-25T15:37:00Z'
labels:
  - mcp
  - federation
milestone: m-26
dependencies:
  - TASK-172
  - TASK-178
references:
  - https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/
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
- [x] #1 Each tool is registered in the TASK-172 registry, annotated readOnlyHint true, declares an outputSchema, and returns structured content plus a short text summary
- [x] #2 Inbox search filters by activity type, actor, object id, recipient and time, pages through results, and returns an activity full JSON on request
- [x] #3 For a post, the tools show its ActivityStreams object as peers see it, every activity sent for it, and each inbox delivery outcome and error
- [x] #4 Followers, relays, quote approvals and webmentions are queryable with the same filter and paging conventions
- [x] #5 Federation status reports queue depth, retrying deliveries and recent job outcomes
- [x] #6 Every tool requires the operator read scope and returns nothing without it, proven by tests
- [x] #7 Tested against a fixture site: an agent-style script can answer why did this Create not show as a reply and which inboxes failed for this post from the tools alone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: ToolCall gains `site` (ToolSite), a Pick of the request variables (admin, store, config, settings, jobs, conversation, replyContexts, actorProfiles, siteAtRequestStart, federation); the endpoint passes c.var. Plugin tools keep their own context.
1. Shared paging convention in src/mcp/inspect/paging.ts (limit 1-100 default 20, offset; output total + nextOffset; since/until as ISO instants) and nullable() in util/json-schema.ts so view models with nulls fit their output schemas.
2. Store queries: InboxStore.searchInboxActivities; DeliveryStore.listSentActivitiesAbout and searchDeliveries; actorKeyHealth in federation/keys.ts (assertActorKeysUsable built on it).
3. Seven inspect tools: federation_status, inbox_search, post_federation, followers, relays, quote_approvals, webmentions. Reuse admin view models (actorSummary, relayRow, localPosts) and the health widget's queue counts.
4. Post object as peers see it via postObject/postTombstone through the site federation (federation added to c.var, federationContextData(vars)).
5. Tests: store queries, every tool listed read-only with output that fits its schema, filters and paging, scope refusal for every tool, fixture-site agent script answering the two questions.
6. docs/mcp.md tools table and conventions; docs/plugins.md nullable().
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built seven read-only tools under src/mcp/inspect/, all scope inspect, annotated readOnlyHint true / destructiveHint false, each with an outputSchema; every answer has structuredContent and a one-line summary.

- ToolCall now carries `site: ToolSite`, a Pick of GeekityEnv Variables filled from c.var. TASK-175/176/177 extend the Pick (e.g. add 'delivery', 'relays', 'announce') rather than invent a services object. Plugin tools are unchanged.
- `federation` (the Fedify SiteFederation) is now on c.var; federationContextData(vars) builds the dispatcher context data off variables, and contextData(c) delegates to it.
- post_federation builds the object with postObject/postTombstone through federation.createContext, by the rule the ActivityStreams route serves by (served / gone 410 / not-served 404). The test asserts the tool's object deep-equals what GET <permalink> Accept: application/activity+json returns.
- Followers output the store's Follower rows rather than the admin FollowerRow, because the admin row drops inboxId and sharedInboxId, which are what delivery debugging needs. Relays reuse relayRow; status reuses actorSummary and the health widget's countRetryingDeliveries; inbox rows resolve their post with the admin's localPosts.
- json-schema gained nullable() (NullableSchema, exported to plugins with docs) so nullable view-model fields validate against output schemas.
- New store queries: searchInboxActivities, listSentActivitiesAbout, searchDeliveries (json_each for list filters), plus Page<T>. actorKeyHealth reports usable/missing/unusable per key file; assertActorKeysUsable now uses it.
- quote_approvals only reads usernames from federatedUsernames, so a username argument cannot point the reader at another path.
- plugin-tools.test listed exact tool names; it now compares whoami plus the plugin tools, so core tools can grow.

Verification: pnpm build, pnpm test (cms 7599 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Live check: served the fixture site on a port and curled /_geekity/mcp: post_federation with status failed returned the Note and me.example 403; inbox_search with a profile-only token got 403 with insufficient_scope naming inspect. Mutation check: switching inbox_search to profile scope and breaking the recipient filter failed 4 tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adds seven read-only MCP tools behind the inspect scope so an agent can debug federation without opening data/geekity.db: federation_status (actors, follower counts, key-file health, relays by state, queue depth, retrying and failed deliveries, recent failures, newest jobs), inbox_search (filters by type, actor, object, reply target, recipient, time; paged; full JSON on request; names the post each row is about or null), post_federation (the object peers get for a post, every activity sent, per-inbox outcomes with errors), followers, relays, quote_approvals and webmentions, all with one limit/offset/total/nextOffset and since/until convention. Tool calls now carry the request's site variables (ToolSite), and the Fedify federation is on c.var. json-schema gained nullable() for nullable output fields, exported to plugins.

Tests: store query tests; every tool listed read-only with output that fits its schema; filter and paging tests; a profile-only token is refused 403 with no result on every tool; an agent-style script over MCP on a fixture site explains why a Create did not show as a reply (it names the permalink without its trailing slash) and lists the inbox that failed (me.example, HTTP 403). Full build, test, test:11ty, typecheck, lint and format:check pass; also curled against a live server.

Not covered, as the task says: the access log and refused inbox signatures are not stored, so no tool shows them.
<!-- SECTION:FINAL_SUMMARY:END -->
