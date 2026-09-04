---
id: TASK-40
title: >-
  Relay subscriptions: follow Mastodon-style relays and deliver public
  activities to them
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:02'
updated_date: '2026-09-04 04:34'
labels:
  - federation
  - admin
milestone: m-5
dependencies:
  - TASK-19
  - TASK-20
  - TASK-38
references:
  - 'https://w3id.org/fep/ae0c'
  - 'https://tags.pub/'
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 27750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The user distributes posts through https://tags.pub/, a hashtag relay that boosts any public post carrying a hashtag it tracks, and which the site reaches as a Mastodon-style relay (FEP-ae0c) at `https://tags.pub/user/_____relay_____/inbox`. Fedify ships the relay-server half only (`@fedify/relay`) and says it does not subscribe an application to remote relays, so the client half is ours: a `Follow` whose object is the ActivityStreams Public collection, sent to the relay's inbox; an `Accept` of that follow arriving in our inbox; and from then on every public activity delivered to that inbox as well as to the followers.

Add a `relays` setting: a list of relay inbox URLs, edited on the settings screen (one per line) and mirrored to `site.json`. For each relay the CMS keeps a subscription record (inbox URL, the relay actor id once known, state `pending` or `accepted`, the follow activity id, timestamps). Adding a relay sends the `Follow` of Public to its inbox, signed by the site actor; the inbox handler for `Accept` matches the follow id and marks the subscription accepted (a `Reject` marks it rejected with the reason shown). Removing a relay sends `Undo(Follow)` and drops the record. The delivery service adds every accepted relay inbox as one more recipient group in its fan-out, so `Create`, `Update` and `Delete` for posts (and the actor `Update` from TASK-28) reach relays and are recorded per relay in the delivery outcomes like a follower would be; resend covers them too. The `Article` already carries a `Hashtag` per tag and per category, which is what tags.pub keys on.

The federation screen gains a Relays panel: each relay with its state, when it was accepted, its last delivery outcome, and a Retry that re-sends the `Follow` for one stuck in pending. Announces the relay sends back (a hashtag account boosting a post) already land in the inbox log and appear as boosts. Relay records are operational state and may live in the same SQLite index tables TASK-32 rebuilds, with the relay list itself in `site.json` as the source; a boot with an accepted relay in the file and no record re-sends the `Follow`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Adding a relay inbox URL on the settings screen stores it, mirrors it to site.json, and sends a signed Follow of the Public collection to that inbox, proved by a stubbed relay that records the request
- [x] #2 An Accept of that Follow arriving in the inbox marks the relay accepted; a Reject marks it rejected with the reason shown on the federation screen
- [x] #3 Publishing, editing or withdrawing a post delivers the Create, Update or Delete to every accepted relay inbox as well as to the followers, with a delivery outcome recorded per relay, and a pending or rejected relay receives nothing
- [x] #4 Removing a relay sends Undo(Follow) to it and stops deliveries to it
- [x] #5 The federation screen lists each relay with its state and last outcome and offers Retry for a pending one
- [x] #6 Resend on a post reaches accepted relays too
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Setting. Add `relays: readonly string[]` to SiteSettings (default []) along the path notifyServer took: DEFAULT_SITE_SETTINGS, SETTINGS_FIELDS (`relays`), readSiteSettings (a newline-joined value in the settings table), writeSiteSettings, settingsProblems (every non-empty line an absolute http(s) URL, deduplicated), settingsFromForm, formFromSettings, settingsSiteData, siteJsonFor (an array, written even when empty), seedSiteSettings, SiteData, and a textarea under the Federation heading.
2. Store. Migration 9: `ap_relays` (inbox_id PRIMARY KEY, actor_id, state pending/accepted/rejected, reason, follow_id, created_at, updated_at) with RELAY_STATES, Relay/NewRelay, listRelays, getRelay, getRelayByFollow, putRelay, deleteRelay, plus lastDeliveryToInbox(inboxId) so the screen can show a relay's last outcome without a follower row.
3. Relay service. New src/federation/relays.ts: relayRecipient, acceptedRelays, and createRelayService({federation, admin, config}) giving subscribe(inbox) (record pending with a fresh Follow id, send a signed Follow of PUBLIC_COLLECTION to the inbox), retry(inbox) (a fresh Follow for a stuck record), unsubscribe(inbox) (Undo of the stored Follow, then drop the record), sync() (diff settings.relays against the records: new URL subscribes, missing record re-Follows, dropped URL unsubscribes), accept/reject matching (follow id, then relay actor id, then a pending relay on the accepting actor's origin), and settled().
4. Inbox. federation.ts gains .on(Accept, handleAccept) and .on(Reject, handleReject); inbox.ts logs the activity and hands it to the relay matcher, which marks the record accepted or rejected with the reason.
5. Delivery. Widen fanOut from follower inbox groups to delivery targets: each follower group as now, plus one target per accepted relay keyed by its inbox, its outcome recorded against the relay's actor id. updateActor() stops short-circuiting when there are no followers but there is a relay. Redelivery goes through the same fanOut, so resend reaches relays for free.
6. Screens. A Relays panel on /admin/federation: inbox, state, when it was accepted, the rejection reason, the last delivery outcome, and a Retry button for a pending one (RELAY_RETRY_PATH). The settings save calls relays.sync() so adding a line Follows and removing one Undoes.
7. Wiring. Build the relay service beside delivery in createCms, put it on GeekityEnv, expose cms.relays, sync() at boot, await settled() in close(), export everything from the package root.
8. Docs: doc-4, packages/cms/README.md, the root README settings docs.
9. Verify: pnpm build, test, typecheck, lint, format:check from the root, then the demo on 3000 against a stub relay that records the signed Follow, answers Accept, and records deliveries — add it through settings, publish a post, retry, remove it — with the demo restored and the real tags.pub never contacted.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

The client half of the Mastodon relay protocol (FEP-ae0c), which Fedify does not ship: Fedify has `@fedify/relay` for being a relay and nothing for subscribing to one.

- **`src/federation/relays.ts`** (new) — `createRelayService({federation, admin, store, config})` giving a `RelayService`: `sync()` (reconcile the records with the `relays` setting), `retry(inboxId)`, `settled()`. Plus the free functions `relayRecipient`, `acceptedRelays`, `acceptRelay(admin, activity)`, `rejectRelay(admin, activity)` and `relayAnswering(admin, activity)`, and the types `CreateRelayServiceOptions`, `RelayLogger`, `RelayService`, `RelaySyncReport`.
- **Setting.** `relays: readonly string[]` follows the exact path `notifyServer` took — `SiteSettings`, `DEFAULT_SITE_SETTINGS` (`[]`), `SETTINGS_FIELDS.relays`, the reader (a newline-joined value in the settings table), the writer, `settingsProblems`, `settingsFromForm`, `formFromSettings`, `settingsSiteData`, `siteJsonFor` (an array, written even when empty), `seedSiteSettings`, `SiteData` and a textarea under the Federation heading. New helpers `relayList(value)` and `normalizeRelayInbox(value)`.
- **Store.** Admin migration 9: `ap_relays` (`inbox_id` primary key, `actor_id`, `state`, `reason`, `follow_id`, `created_at`, `updated_at`) with `RELAY_STATES`, `Relay`, `NewRelay`, `listRelays`, `getRelay`, `getRelayByFollow`, `putRelay`, `deleteRelay`. Also `lastDeliveryToInbox(inboxId)`, which is how the screen finds a relay's last outcome without a follower row to look it up by.
- **Delivery.** `fanOut` now walks `deliveryTargets(admin)` — a new exported `DeliveryTarget {inboxId, recipients, actorIds}` — instead of follower groups. A follower group and a relay are the same shape from there, which is what lets a relay be recorded like a follower without pretending to be one. `updateActor()` no longer short-circuits on zero followers when a relay is accepted.
- **Inbox.** `handleAccept` and `handleReject` in `inbox.ts`, registered in `createSiteFederation`. Both log the activity and hand it to the relay matcher.
- **Screens.** A Relays panel on `/admin/federation` (`relayRow`, `RELAY_STATE_LABELS`, `RELAY_RETRY_PATH`, `FEDERATION_FIELDS.relay`) with the state, when it last moved, the rejection reason, the last delivery and a Retry for a waiting one. The settings save calls `c.var.relays.sync()` and flashes what it did.
- **Wiring.** `createRelayService` beside delivery in `createCms`, `relays.sync()` at boot, `relays` on `GeekityEnv` and on `Cms`, `await relays.settled()` in `close()`, everything exported from the package root.
- **Docs.** doc-4 gained a Relays section and two lines elsewhere; `packages/cms/README.md` gained a Relays section and had its Delivery and federation-screen paragraphs corrected; the root README's settings paragraph, key list and field table.

## Decisions

- **A relay stands in for its own id until it answers.** Fedify's `extractInboxes` drops any recipient whose `id` is null, silently — a `Recipient {id: null, inboxId}` sends nothing at all. So `relayRecipient` uses `actorId ?? inboxId` as the id. It is only ever used to key the inbox and to build a collection-synchronisation header for a shared inbox, and a relay publishes no shared inbox, so the substitution costs nothing. This cost an hour to find and is the one non-obvious thing in the file.
- **The answer is matched three ways.** The follow id first, which is what FEP-ae0c says an `Accept` names. Then the relay's actor id, which catches an answer to a follow a Retry has since replaced. Then a single pending subscription on the answering actor's origin — a relay answering from the host its inbox is on can only be answering about that inbox. Two pending subscriptions on one host are left alone rather than guessed between; both cases are tested.
- **`accepted`/`rejected` are free functions over the store, not methods on the service.** Nothing about them is queued or sent, and the inbox listener that calls them has the store on its context and no service. Keeping them off the interface is what avoided putting the relay service on `FederationContextData`.
- **`sync()` is synchronous and returns what it decided.** The follows and undos it queues are the async part and `settled()` waits for them; the report — which relays were added and which removed — is known the moment the setting is read, and the settings screen needs it to write its flash without waiting for a relay that may take days to answer.
- **A failed follow stays pending with the reason on it.** A relay that was down is not a relay that refused, and Retry is what the screen offers for the difference. Only a `Reject` sets `rejected`, and a rejected relay has no Retry: it said no, and asking again is a decision taken by removing the line and adding it back.
- **The record is written before the `Follow` goes out.** A relay fast enough to answer while the POST is still in flight — or a synchronous test — has to find something to mark accepted.
- **Redelivery says \"recipients\", not \"followers\".** A relay is one of them and is not a follower.
- **Only an accepted relay is delivered to.** Posting into an inbox that has not agreed is the thing the handshake exists to prevent.

## Verification

**Tests.** 25 new cases: 5 in `src/admin/store.test.ts` (the `ap_relays` round trip and `lastDeliveryToInbox`), 3 in `src/admin/settings.test.ts` (the textarea, the mirror, normalisation and refusal), 5 in `src/admin/federation.test.ts` (the panel, the states, the reason, Retry sending a fresh Follow, an unknown relay refused), and 12 in the new `src/federation/relays.test.ts` over a stubbed relay host, the way `inbox.test.ts` stubs a peer: the signed Follow of Public, the pending record, `Accept`, `Reject` with its reason, the two answer-matching edge cases, `Undo` on removal, an untouched neighbour, the boot follow and the boot no-op, and delivery — Create to relay and follower, the outcome row, nothing to a pending or rejected relay, the Update, and Redeliver reaching the relay.

One trap the tests found and now avoid: a relay follow to an unreachable host under Fedify's default `InProcessMessageQueue` leaves a retry timer running that keeps the process alive past the suite. The relay-setting tests therefore stub `fetch` and run with `queue: null`.

**Checks, from the repository root.** `pnpm build` clean; `pnpm test` 724 pass / 0 fail (`@geekity/cms`) and 11 pass / 0 fail (demo); `pnpm test:11ty` 9 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean; `pnpm fed:smoke` passed unchanged.

**Live, against the demo on port 3000** signed in as `ada`, with three stub relays on 127.0.0.1 written for the run — one that accepts, one that rejects with a reason, one that never answers. The real tags.pub was never contacted: it was never in the setting. The demo config was temporarily given `federation: { allowPrivateAddress: true }` so Fedify would deliver to loopback, and put back afterwards.

- **AC #1.** Saving `http://127.0.0.1:3456/user/_____relay_____/inbox` on the settings screen wrote `\"relays\": [\"…\"]` into `apps/demo/content/_data/site.json` and the stub recorded one POST to its inbox: `type: Follow`, `actor: http://localhost:3000/ap/actor`, `object: https://www.w3.org/ns/activitystreams#Public`, an HTTP `signature` header, and `signature.type: RsaSignature2017` — the Linked Data signature a Mastodon-style relay verifies, which Fedify attaches on its own.
- **AC #2.** The stub's signed `Accept` moved the row to Accepted and recorded `http://127.0.0.1:3456/actor` as the relay's actor id, both visible on `/admin/federation`. The rejecting stub on 3457 produced `Rejected` with `This relay is invitation only.` printed under its inbox.
- **AC #3.** Publishing `relay-smoke-test` delivered `Create` of the `Article` to the relay's inbox; editing it delivered `Update`; saving it as a draft delivered `Delete`. The screen's Last delivery column read `Update queued`. Across all three, the rejected relay on 3457 and the pending one on 3458 received nothing beyond their own Follow — their logs stayed at 1 and 2 lines.
- **AC #4.** Emptying the field sent an `Undo` to all three inboxes, each naming the follow id it had been sent, and the panel went back to \"The site subscribes to no relay\". A republish afterwards left the accepted relay's log at 7 lines: a removed relay is delivered nothing.
- **AC #5.** The panel listed all three with inbox, state, date, last delivery and reason; only the waiting one carried a Retry, and pressing it POSTed a second `Follow` under a fresh id (`…#relay-follow/e62273ee…` after `…/e28ad0e2…`) and flashed \"The follow has been sent to … again.\"
- **AC #6.** Redeliver on the post's row sent the `Update` to the relay again — the stub's Update count went from 1 to 2 — and the flash read `Redelivered Update to 1 recipient: 0 sent, 1 queued, 0 failed.` (queued because the demo runs Fedify's default queue).

The demo was put back: the test post's file deleted, `notifyServer` returned to `https://rpc.rsscloud.io`, `relays` left empty, `apps/demo/geekity.config.ts` restored from its backup, and `git diff apps/demo/content/_data/site.json` showing only the pre-existing keys plus `\"relays\": []`. `pgrep -fl \"tsx watch\"`, `pgrep -fl stub-relay` and `lsof -nP -iTCP:3000` all report nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The site can now subscribe to a Mastodon-style relay (FEP-ae0c), which is the half Fedify does not ship: `@fedify/relay` is for being a relay, and nothing there subscribes to one.

One setting, `relays`, is the whole of the interface: relay inboxes one per line on `/admin/settings`, mirrored to `site.json` like every other setting. Adding a line sends that inbox a `Follow` whose object is the literal Public collection, signed by the site actor and carrying the Linked Data signature a Mastodon-style relay verifies; removing a line sends `Undo` of the same follow. The relay answers `Accept` or `Reject` — possibly days later, because a subscription may need a human to approve it — and `src/federation/relays.ts` matches that answer to the subscription by the follow id, then by the relay's actor id, then by a single waiting subscription on the answering actor's own origin.

Only an accepted relay is delivered to. From there it is one more inbox in the fan-out: `fanOut` now walks `deliveryTargets(admin)`, where a follower group and a relay are the same shape — an inbox, the recipients Fedify addresses it with, and the actors the outcome rows are written against. That is what lets a relay be recorded like a follower without pretending to be one, and it is why Redeliver reaches relays for free. The subscription records live in a new `ap_relays` table keyed by inbox; they are operational state derivable from the file, so a relay the settings name that has no record is followed again on the next boot.

`/admin/federation` gained a Relays panel: inbox, state, when it last moved, why it was refused, the last activity delivered there and how that went, and a Retry for one still waiting.

The one thing worth knowing before changing the file: Fedify silently drops any recipient whose `id` is null, so a relay stands in its inbox for its id until it has answered.

Verified by 25 new node:test cases — 12 of them in the new `src/federation/relays.test.ts` over a stubbed relay host — and by a live pass against the demo with three stub relays on loopback, one accepting, one rejecting with a reason, one that never answers: the signed Follow with its `RsaSignature2017`, the Accept and the Reject on the screen, `Create`/`Update`/`Delete` reaching only the accepted one, `Undo` on removal and nothing delivered afterwards, Retry sending a fresh follow, and Redeliver reaching the relay. `pnpm build`, `test` (724 + 11), `test:11ty` (9 + 5), `typecheck`, `lint`, `format:check` and `fed:smoke` all pass. The real tags.pub was never contacted, and the demo was restored.
<!-- SECTION:FINAL_SUMMARY:END -->
