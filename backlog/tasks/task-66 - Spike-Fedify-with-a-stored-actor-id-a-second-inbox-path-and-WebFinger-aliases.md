---
id: TASK-66
title: >-
  Spike: Fedify with a stored actor id, a second inbox path and WebFinger
  aliases
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:51'
updated_date: '2026-09-13 03:33'
labels:
  - federation
milestone: m-11
dependencies: []
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/federation/federation.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/scripts/fed-smoke.ts
  - 'https://fedify.dev/manual/actor'
  - 'https://fedify.dev/manual/inbox'
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: spike
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-14 needs three things from Fedify that its documented shape does not obviously give. Fedify derives an actor's id and the key id it signs with from the path template the actor dispatcher is registered under, so it is not clear it will serve an actor whose stored id is https://example.com/?author=2 while the dispatcher path is /author/{identifier}/, nor whether a signature whose keyId is the author URL's key verifies at a peer that knows the account by the stored id. Fedify registers one inbox path and one shared inbox path, and an HTTP signature covers the request path, so the compatibility switch's /wp-json/activitypub/1.0/ inbox routes cannot simply forward to another route. And WebFinger must list the author URL, the stored id and /@username as aliases and resolve any of them. Find out, with a throwaway CMS and the fed-smoke tooling (@fedify/cli, and a real Mastodon account if one is to hand), what Fedify allows directly, what the CMS's own middleware has to do instead (as mount.ts already does for the permalink), and what it cannot do at all. The answer decides the shape of TASK-68 and TASK-70 and is recorded, not built.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A written finding, in doc-4 or a new doc, that says for each of the three questions what Fedify does natively, what the CMS middleware must do, and what a peer (fedify lookup, and Mastodon if tried) accepted
- [x] #2 The finding names the Fedify APIs involved (actor dispatcher, key pairs dispatcher, mapAlias or its equivalent, inbox listeners, createContext and respondWithObject) with versions
- [x] #3 A recommendation for the inbox paths, the shared inbox path and how a stored actor id is served, that TASK-68 and TASK-70 can follow without a second investigation
- [x] #4 Throwaway code is not merged; anything reusable is noted for the tasks that follow
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the Fedify 2.3.6 sources for handleActor, getKeyPairsFromIdentifier, handleWebFinger, setInboxListeners and routeActivity to see what is derived from the dispatcher path.
2. Write a throwaway experiment suite under the scratchpad that drives real Fedify code: a Hono app, a federation object, signed requests with signRequest, and a stubbed fetch for the peer, modelled on inbox.test.ts and fed-smoke.ts.
3. Q1 stored actor id: prove an actor dispatcher may return a Person whose id is a stored URL, prove the CMS middleware can serve that id at a query-string URL through createContext + respondWithObject and 301 a browser, and prove an activity can be signed with a keyId under the stored id that a peer verifies.
4. Q2 second inbox path: try (a) a second Federation object registered on the /wp-json/ paths and (b) a hand-rolled route that calls verifyRequest then routeActivity; record which verifies a signature at the real path.
5. Q3 WebFinger aliases: prove what mapAlias and mapActorAlias do, prove whether the self link can be the stored id, and prove a CMS-owned /.well-known/webfinger route mounted before the Fedify middleware wins.
6. Cross-check against the live WordPress actor at andrewshell.org with curl and fedify lookup.
7. Write the findings into doc-4 (a new section) and the task notes, delete the throwaway code, and run build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The findings are written up in full in doc-8 ("Fedify under decision-14: stored actor ids, a second inbox path and WebFinger aliases"), which TASK-68, TASK-69 and TASK-70 should read before they start. The short version, all of it proven against @fedify/fedify 2.3.6, @fedify/hono 2.3.6, @fedify/vocab 2.3.6 and @fedify/cli 2.3.6:

**Q1, a stored actor id.** Fedify serves one natively. handleActor serialises whatever the actor dispatcher returns and never touches `id`, so a dispatcher registered at /author/{identifier}/ may answer with a Person whose id is https://example.com/?author=2; fedify lookup of the author URL read it back without complaint. Trailing-slash path templates work, and with them ctx.getActorUri, getInboxUri, getOutboxUri and getFollowersUri produce exactly the URLs decision-14 names. What Fedify does NOT take from the document is the key id: getKeyPairsFromIdentifier builds it as new URL('#main-key', ctx.getActorUri(identifier)). With no stored id that derivation is already correct. With one, the CMS must build CryptographicKey and Multikey by hand at {storedId}#main-key and {storedId}#multikey-1, and hand ctx.sendActivity an explicit SenderKeyPair[] instead of { identifier }. Proven: the delivered request's Signature-Input carried keyid="…/?author=2#main-key" and the body a DataIntegrityProof at …#multikey-1, and replaying it through verifyRequest and doesActorOwnKey — the exact pair of checks a receiving Fedify runs — both accepted it. This costs nothing, because the CMS never uses the sendActivity(sender, 'followers', …) overload, the only one that insists on { identifier }: delivery.ts groups recipients itself and inbox.ts and relays.ts name one. The stored id itself cannot be a Fedify route (its router cannot match a query string), so CMS middleware serves it exactly as mount.ts already serves a post's stored activitypub.id: path+query against the base URL, respondWithObject for a peer, 301 to the archive for a browser. Proven with ?author=2 on the site root, home page left untouched.

**Q2, a second inbox path.** A second setInboxListeners call on one Federation throws "Inbox listeners already set." verifyRequest + ctx.routeActivity is a dead end: routeActivityInternal re-verifies from scratch, wanting an Object Integrity Proof or a dereferenceable activity id, and a Mastodon or WordPress Follow has neither — it returned false and never reached the listener. What works is a second Federation object mounted as a second @fedify/hono middleware after the canonical one, registered on /wp-json/activitypub/1.0/actors/{identifier} with inboxes at …/actors/{identifier}/inbox and /wp-json/activitypub/1.0/inbox. A signed Follow to the personal path was 202 with ctx.recipient === '2' (the plugin's numeric id, straight off the path); to the shared path 202 with recipient null; unsigned, 401 — signature verification happens at the real path, with no rewriting or forwarding. The canonical inbox kept working and the first middleware still owned WebFinger and the actor URL. GETs of …/actors/2 and its outbox, followers and following all answered 200. Two refinements the experiments found: wrap the compat middleware in a per-request gate reading the setting (a …/actors/2 GET flipped 404→200→404 with no restart), and share one KvStore between the two federations with .withIdempotency('per-origin') on both listener sets — the default per-inbox key folds in the recipient, so the same Follow redelivered to both paths fired the listener twice; per-origin plus a shared store fired it once.

**Q3, WebFinger aliases.** Fedify's own WebFinger cannot do what WordPress does. The self link is hard-coded to ctx.getActorUri(identifier) and setWebFingerLinksDispatcher only appends, so asking it for a self produced two self links with the derived one first; aliases is computed and cannot be added to. mapAlias does make a lookup by the stored id, by /@username and by the author URL resolve 200, but the answer has the resource as subject and the author URL as self. So the CMS should own /.well-known/webfinger: a Hono route registered before the federation middleware wins outright, and a hand-written one reproduced the plugin's document exactly (subject acct:andrew@host, aliases [stored id, /author/andrew/, /@andrew], self the stored id, a profile-page link to the archive). The actor should carry aliases too, which @fedify/vocab serialises as alsoKnownAs. Not provable locally: fedify lookup @user@host over loopback, because @fedify/webfinger always uses https: for an acct: resource — the same with Fedify's handler as with a hand-written one, so it is a property of the CLI and loopback rather than of the design. Lookups by URL do work over loopback, and that is what the smoke test should assert on.

**Live reference** (WordPress ActivityPub 7.1 at andrewshell.org, read 2026-09-12, curl with an ActivityStreams Accept header): id ?author=2, url /author/andrew/, key ?author=2#main-key owned by ?author=2, inbox /wp-json/activitypub/1.0/actors/2/inbox, sharedInbox /wp-json/activitypub/1.0/inbox, collections under actors/2/, alsoKnownAs all three URLs, and WebFinger whose self is the stored id.

**Throwaway code.** Two files, packages/cms/scripts/spike-66.ts (14 node:test cases, all passing) and packages/cms/scripts/spike-66-peer.ts (a loopback server driven by fedify lookup and curl), were written, run and deleted. Nothing from them is merged; doc-8 carries the recipes instead, and its recommendation section is written so TASK-68, TASK-69 and TASK-70 need no second investigation.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Answered all three of decision-14's open questions against the pinned Fedify 2.3.6, with throwaway experiments that drove real Fedify code — a Hono app, a real Federation object, requests signed with signRequest, verifyRequest and doesActorOwnKey on the replay, and a loopback server read by fedify lookup and curl — and recorded the answers in doc-8 with a recommendation TASK-68, TASK-69 and TASK-70 can follow directly. A stored actor id is served natively by the actor dispatcher but is not what Fedify derives the signing key id from, so the key objects are built by hand and sendActivity takes an explicit SenderKeyPair[]; the id itself, being a query-string URL, is served by CMS middleware the way mount.ts already serves a post's stored id. A second inbox path is a second Federation object mounted after the canonical one, gated per request on the setting and sharing a KV store with per-origin idempotency; ctx.routeActivity was tried and rejects signature-only deliveries. WebFinger's self link cannot be moved off the dispatcher path, so the CMS takes over /.well-known/webfinger with a route registered before the federation middleware. The two spike scripts were deleted; pnpm build, test (1498 + 14 passing), typecheck, lint and format:check all pass on the clean tree.
<!-- SECTION:FINAL_SUMMARY:END -->
