---
id: TASK-70
title: >-
  WordPress ActivityPub compatibility: a switch that serves the /wp-json/ inbox
  and collection paths and shows when they were last asked for
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:51'
updated_date: '2026-09-13 05:34'
labels:
  - federation
  - admin
milestone: m-11
dependencies:
  - TASK-69
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/admin/settings.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/admin/federation.ts
  - >-
    https://andrewshell.org/.well-known/webfinger?resource=acct:andrew@andrewshell.org
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 99400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A follower's server delivers to the inbox URL it cached from the actor document and replaces it only when it next refetches the actor. A site moved from the WordPress ActivityPub plugin therefore keeps receiving at /wp-json/activitypub/1.0/actors/{id}/inbox and /wp-json/activitypub/1.0/inbox for a while, and those are cache, not identity (decision-14): the CMS carries them until the caches have moved on and no longer. Add a site setting, WordPress ActivityPub compatibility, off by default and absent from a new site's site.json. When it is on, the CMS mounts real inbox routes at those two paths, signature-verified exactly as the canonical ones are, with the plugin's numeric actor id mapped to a user through a field on the user record set by the import (TASK-71), plus GET routes for the outbox, followers and following collections at /wp-json/activitypub/1.0/actors/{id}/ that answer with the user's collections. Each route records the instant it was last asked for, per user, in a file under data/ so a rebuilt database does not forget, and the federation screen shows it beside the switch with a note that once every follower's server has refetched the actor the switch can go off. The spike (TASK-66) says how a second inbox path is served under Fedify. Nothing here is mounted for a site with the switch off.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With the switch off, no /wp-json/ path is registered and site.json does not mention the setting until it is turned on
- [x] #2 With the switch on and a user mapped to WordPress actor id 2, a signed Follow POSTed to /wp-json/activitypub/1.0/actors/2/inbox or to /wp-json/activitypub/1.0/inbox is accepted into that user's followers, an unsigned or badly signed one is refused, and a GET of the outbox, followers and following paths under actors/2 answers with the user's collections
- [x] #3 Every compatibility route records when it was last asked for, per user, in a file under data/ that survives a restart and geekity rebuild; the federation screen shows the instants, or never, beside the switch with the note
- [x] #4 Turning the switch off unregisters the routes on the next request without a restart, or the screen says a restart is needed, whichever the implementation chooses, and a test proves the chosen behaviour
- [x] #5 doc-4 and the package README describe the switch, what it is for and when to turn it off
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add `wordpressActorId` (a positive integer) to `User` in admin/accounts.ts: read tolerantly from users.json, carried by `withoutHash`, accepted by the `writeUsers` test helper. It is what TASK-71's import fills.
2. Add the `wordpressActivityPub` site setting (form field `wordpress_activitypub`), off by default. `siteJsonFor` deletes the key when it is off, as it does for `homepage`, so site.json never mentions it until it is turned on (AC #1).
3. New module federation/wordpress.ts: the plugin's paths (`/wp-json/activitypub/1.0/actors/{id}` and the shared `/wp-json/activitypub/1.0/inbox`), a second Fedify `Federation` over them sharing the canonical KV store, and `withIdempotency('per-origin')` on both federations' inbox listeners so one Follow redelivered to both paths fires once (doc-8). The numeric id arrives as `ctx.recipient`/the dispatcher identifier and is mapped to a user by `wordpressActorId`. Every dispatcher and every inbox handler runs against a context of the *canonical* federation, so the actor served, the Accept sent and the keys signed with are the identity ones (the stored actor id, or the author URL) rather than ids derived from the /wp-json/ path.
4. Last-request-at: `data/wordpress-activitypub.json`, one instant per user per route plus one for the shared inbox, written atomically by the gate middleware before it delegates, so a rebuilt database and a restart do not forget (AC #3).
5. Mount it in mount.ts after the canonical `federationGate` and before the stored-id middleware, behind a per-request gate that reads the setting and 404s when it is off, with the federation built lazily on first use (AC #4). Share the KV store from index.ts.
6. Settings > Federation carries the switch, and beside it a panel of the routes with when each was last asked for, or never, and the note that the switch can go off once every follower's server has refetched the actor (AC #3).
7. doc-4 and the package README describe the switch, what it is for and when to turn it off (AC #5).
8. Tests, red first, at the seams the ACs name: `instance.app.request` for the routes and the signatures, the settings file for AC #1, the data file for AC #3, the rendered settings screen for the panel.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch m12-users-are-actors.

**The setting.** `wordpressActivityPub`, form field `wordpress_activitypub`, on Settings > Federation (`src/admin/settings.ts`, `src/admin/settings-federation.ts`, `admin/layouts/settings/federation.njk`). `siteJsonFor` writes the key only when it is true and deletes it otherwise, the way `homepage` is handled, so site.json never mentions it until somebody turns it on and stops mentioning it again when they turn it off.

**The mapping.** `User.wordpressActorId`, a whole positive number, read tolerantly out of `data/users.json` (anything else is dropped, never refused) and carried by `withoutHash`; `writeUsers` in `admin/__testing__/users.ts` accepts it. TASK-71's import writes it beside `actorId`.

**The routes.** New module `src/federation/wordpress.ts`: a second Fedify `Federation` over `/wp-json/activitypub/1.0/actors/{identifier}` and the shared `/wp-json/activitypub/1.0/inbox`, sharing the canonical KV store (created once in `index.ts`), with `withIdempotency('per-origin')` on both federations' inbox listeners — proved necessary: removing it makes the 'handled once' test deliver two Accepts.

The design decision worth recording: **every dispatcher and every inbox handler runs against a context of the *canonical* federation**, obtained with `canonical.createContext(new URL(context.origin), context.data)`. Fedify derives an actor's id, its key ids and its collection URLs from the dispatcher path, so a document or an `Accept` built off the compat context would tell a peer the person *is* `…/actors/2` — the opposite of what the switch is for. It also fixes `parseUri`: a `Follow` addressed to the canonical author URL is recognised. For the inbox listeners a small `Proxy` puts the delivery's `recipient` — mapped from the number to the username — and `forwardActivity` back on the canonical context. `outboxPage` is now exported from `federation.ts` and takes a `Context` rather than a `RequestContext`.

**The record.** `data/wordpress-activitypub.json`: `{ sharedInbox, users: { <username>: { actor, inbox, outbox, followers, following } } }`, written atomically by the gate middleware before it delegates, so it survives a restart and a deleted database. Matched by `wordPressRequestTarget(pathname)` rather than by Fedify, so a request is recorded whether or not the number still names anybody.

**The gate.** `mountFederation(app, federation, { wordpress })` takes a factory; `wordPressGate` reads the setting per request and builds the second federation on first use, so turning the switch off takes the paths away on the very next request with nothing restarted, both ways. Mounted after the canonical middleware and before the stored-id middleware.

Verified: `pnpm build`, `pnpm test` (1595 + 15 pass, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm fed:smoke` all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the WordPress ActivityPub compatibility switch: a `wordpressActivityPub` site setting, off by default and absent from site.json until it is on, which mounts a second Fedify federation over the plugin's `/wp-json/activitypub/1.0/` inbox and collection paths, mapped to users by a new `wordpressActorId` field on the user record. Every route runs against a context of the canonical federation, so the actor served, the `Accept` sent and the keys signed with are the identity ones a peer already holds rather than ids derived from the /wp-json/ path — which is what eventually lets the switch come off. Both federations share one KV store and use `per-origin` idempotence, so one Follow redelivered to the old and the new inbox is handled once. Each path records when it was last asked for in `data/wordpress-activitypub.json`, and Settings > Federation lists them beside the switch with the instant or 'Never' and the note about turning it off. The gate reads the setting per request, so flipping it takes effect on the next request with no restart. doc-4 and the package README describe all of it.

Verified by new suites in src/federation/wordpress.test.ts (12 tests: signed and unsigned deliveries to both inboxes, the actor and three collections, a number nobody carries, one Follow across two inboxes, a user with no stored id, the switch off and on again, and the record surviving a restart with the database deleted) and src/admin/settings-federation.test.ts and src/admin/accounts.test.ts. pnpm build, test (1595 + 15 pass, 0 fail), typecheck, lint, format:check and fed:smoke all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
