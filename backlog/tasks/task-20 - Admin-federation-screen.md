---
id: TASK-20
title: Admin federation screen
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 22:13'
labels:
  - admin
  - federation
milestone: m-2
dependencies:
  - TASK-18
  - TASK-10
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/admin/federation shows the actor handle and profile summary, the follower list with avatars and follow dates, recent inbox activity from ap_inbox, and per-post delivery status with a Redeliver button.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Followers appear with name, handle, and follow date
- [x] #2 Recent likes, boosts, and replies are listed with links to the remote objects
- [x] #3 Redeliver on a post re-sends its latest activity and shows the result
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add `delivery` to GeekityEnv and set it in createCms so an admin route can redeliver.
2. New src/admin/federation.ts: FEDERATION_PATH (/admin/federation), REDELIVER_PATH (/admin/federation/redeliver), mountFederation(app, { render }); pure helpers for the actor summary, the inbox feed (Like/Announce/Create(Note) with links pulled out of the stored JSON-LD) and the per-post delivery rows (latest outbound activity per objectId + counts).
3. New admin/layouts/federation.njk plus ADMIN_TEMPLATES.federation and admin.css rules; drop the placeholder for the federation section.
4. Red-green through HTTP tests in src/admin/federation.test.ts: followers with name/handle/date (AC1), likes/boosts/replies with links to remote objects (AC2), and redeliver re-sending the latest activity against a stubbed remote inbox with the result flashed (AC3).
5. Re-export through src/admin/index.ts and src/index.ts; update the README admin table and Federation section.
6. Run pnpm build, test, typecheck, lint, format:check from the root.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New src/admin/federation.ts holds the screen: FEDERATION_PATH (/admin/federation), REDELIVER_PATH (/admin/federation/redeliver), FEDERATION_FIELDS.activityId ('activity_id'), and the pure helpers actorSummary, followerRow, inboxRows, localPosts, deliveryRows and redeliveryMessage. mountFederationScreen is called from mountAdmin, so 'federation' is no longer a placeholder section.

Wiring: GeekityEnv gained a 'delivery' variable and createCms sets it, which meant building the federation object and the delivery service before the Hono app rather than after it. That is the only way a request handler can call cms.delivery.redeliver.

Reading the JSON-LD: a Like or an Announce links its own activity id and the local post its objectId names; a Create links the Note's url (falling back to its id) and resolves the post from the Note's inReplyTo. Follow, Undo and Delete are filtered out — their effect is the follower list on the same page — so the inbox query reads four times FEDERATION_RECENT and the delivery panel slices back to it.

Only the newest outbound activity per objectId gets a row, because a post is a Create plus every Update since and the newest is the version a follower who missed everything is owed. A Delete is about a post the index no longer holds, so it falls back to the slug the activity kept.

Also added a linked Followers count to the dashboard's At a glance panel, admin.css rules for the new panels, and a Federation screen paragraph plus two admin table rows in packages/cms/README.md.

Validation: packages/cms/src/admin/federation.test.ts holds ten HTTP-level tests through cms.app.request after a real login. AC #1 'shows a follower's name, handle, avatar, profile and follow date'. AC #2 'lists likes, boosts and replies with links to the remote objects' — asserts the Like's activity id, the Announce's activity id, the reply Note's url, the actor link and three links to the post's editor. AC #3 'sends the latest activity again and says how it went' — publishes a post through the editor against a stubbed remote inbox, redelivers through the form, and asserts the second POST arrived at the follower's inbox with the same activity id and that the screen then reads 'Redelivered Create to 1 follower: 1 sent, 0 failed'. Repo root: pnpm build, pnpm test (577 + 10 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built /admin/federation: the site's actor summary (handle, type, name, summary, actor id, profile, follower count), the follower list with avatars, handles, profile links and follow dates, the recent likes, boosts and replies out of ap_inbox linked to both the remote object and the local post, and one row per federated post with its latest activity, its sent/queued/failed counts and a Redeliver button that calls cms.delivery.redeliver and flashes the result. Adds src/admin/federation.ts, admin/layouts/federation.njk and admin.css rules; puts the delivery service on the Hono context; drops the placeholder for the federation section; adds a Followers count to the dashboard and a Federation screen section to the README. Verified by ten HTTP tests in src/admin/federation.test.ts, the third acceptance criterion against a stubbed remote inbox that records the second POST; pnpm build, test, typecheck, lint and format:check all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
