---
id: TASK-16
title: 'Fedify integration: site actor, key pairs, WebFinger, NodeInfo'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 20:57'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-1
  - TASK-3
  - TASK-14
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - 'https://fedify.dev/manual/integration'
type: feature
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire @fedify/fedify 2.x into Hono via @fedify/hono behind a factory that takes KV and queue implementations (decision-5). Actor dispatcher builds a Person or Service from settings. Key pairs (RSA and Ed25519) are generated on first boot and stored in SQLite. WebFinger resolves the handle. NodeInfo 2.1 reports software geekity-cms.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /.well-known/webfinger?resource=acct:{handle}@{host} returns the actor link
- [x] #2 GET on the actor URL with Accept: application/activity+json returns a Person with publicKey, inbox, outbox, followers, and icon when set
- [x] #3 Key pairs persist across restarts
- [x] #4 GET /.well-known/nodeinfo and the linked document return valid NodeInfo 2.1
- [x] #5 fedify lookup from @fedify/cli against a dev server resolves the actor
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add @fedify/fedify, @fedify/hono and @fedify/vocab 2.3.x to @geekity/cms.
2. Persist actor key pairs: admin store migration 4 adds an actor_keys table (identifier, algorithm, private_jwk, public_jwk, created_at) with listActorKeys/putActorKey on AdminStore.
3. src/federation/keys.ts: loadActorKeyPairs() generates RSASSA-PKCS1-v1_5 and Ed25519 pairs with generateCryptoKeyPair/exportJwk on first boot, stores them, and reloads them with importJwk after that.
4. src/federation/actor.ts: siteActor() builds the configured ACTOR_TYPES class from SiteSettings (name = title, summary = tagline, url = base URL, preferredUsername = actorHandle, icon from an optional avatar setting) with publicKey, assertionMethods, inbox, outbox and followers from the Fedify context.
5. src/federation/federation.ts: createSiteFederation({ kv, queue, origin, ... }) behind a factory that defaults to MemoryKvStore + InProcessMessageQueue (decision-5), with the actor dispatcher at /ap/{identifier} pinned to the sentinel identifier 'actor' so the id never moves when the handle changes, mapHandle for WebFinger, empty followers/outbox stubs for TASK-17/18, and a NodeInfo 2.1 dispatcher reporting geekity-cms at the package version.
6. src/federation/mount.ts: mountFederation() wires it into Hono via @fedify/hono, mounted before the admin and the public site.
7. Wire it into createCms and expose it as cms.federation; re-export the new area through src/federation/index.ts and src/index.ts.
8. Tests, red first, at three seams: the AdminStore key rows, the HTTP surface through createCms().app.request (webfinger, actor document, nodeinfo), and key persistence across two stores over one data directory.
9. Prove criterion 5 with fedify lookup from @fedify/cli against a real server on a random port.
10. Root pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added @fedify/fedify, @fedify/hono and @fedify/vocab 2.3.6 to @geekity/cms, and a new src/federation/ area:

- keys.ts: SITE_ACTOR_IDENTIFIER ('actor') and loadActorKeyPairs(store, identifier), which generates an RSASSA-PKCS1-v1_5 pair and an Ed25519 pair with generateCryptoKeyPair/exportJwk on first boot and reloads them with importJwk after that. A row that will not import is regenerated rather than thrown, so a damaged table heals.
- actor.ts: siteActor() builds the class named by the actorType setting (ACTOR_CLASSES over ACTOR_TYPES) with name/summary/url/preferredUsername from the settings, publicKey + assertionMethods from the key pairs dispatcher, and inbox/outbox/followers/following/sharedInbox from the Fedify context.
- federation.ts: createSiteFederation({ baseUrl, kv?, queue?, allowPrivateAddress?, federationOptions? }) defaulting to MemoryKvStore + InProcessMessageQueue per decision-5. Actor at /ap/{identifier} pinned to the sentinel 'actor', so the id is {baseUrl}/ap/actor and never moves when the handle changes; mapHandle turns the WebFinger username into that identifier. Outbox, followers and following are registered but empty for TASK-17/18; inbox listeners are registered with no handlers for TASK-18. NodeInfo 2.1 at /nodeinfo/2.1 reports geekity-cms at the package.json version.
- mount.ts: mountFederation() puts the @fedify/hono middleware in front of the admin and the public site, handing the dispatchers the stores off the Hono context.

createCms now builds one and exposes it as cms.federation.

Two things the work turned up:

1. Fedify rejects an origin that carries a path, which broke the existing 'site lives in a subdirectory' feeds test. federationOrigin() now derives { handleHost, webOrigin } from the base URL and drops the path. That is the right answer rather than a workaround: /.well-known/webfinger and /.well-known/nodeinfo are defined on the host, not under a subdirectory.
2. This package compiles without lib.dom, so Fedify's CryptoKey/CryptoKeyPair/JsonWebKey references resolved to error types and tripped the no-unsafe-* lint rules. src/types/webcrypto.d.ts maps the three global names onto node:crypto's webcrypto equivalents.

There is no avatar setting yet, so AVATAR_SETTING names the raw 'avatar' key the federation layer reads out of the settings store: the actor gains an icon the moment something writes it, and the settings form, its validator and the site.json mirror stay untouched. Whoever adds the upload screen should add it to SiteSettings and drop the raw read.

The admin store gained migration 4 (actor_keys, keyed by identifier and algorithm) plus listActorKeys/putActorKey. Keys hang off the identifier rather than the handle, so a rename keeps them.

Verification.

Automated (pnpm test at the root: 497 + 10 tests, 0 failures):
- src/admin/store.test.ts 'actor keys': the table stores one row per identifier and algorithm, replaces rather than duplicates, and keeps one actor's keys away from another's.
- src/federation/keys.test.ts: both algorithms are generated on the first call, written, and read back identically after the store is closed and reopened on the same data directory; an unusable row is regenerated.
- src/federation/federation.test.ts: WebFinger resolves acct:blog@blog.example to {baseUrl}/ap/actor and follows a renamed handle to the same id (AC 1); the actor URL under Accept: application/activity+json answers a Person with publicKey (RSA PEM), two assertion multikeys including a z6Mk Ed25519 one, inbox, outbox, followers, the configured actor type and an icon only when the avatar setting is set (AC 2); a second createCms on the same data directory publishes the identical publicKey and assertionMethod (AC 3); /.well-known/nodeinfo links to /nodeinfo/2.1 and that document reports geekity-cms at the package version, activitypub, and the real user and post counts (AC 4); the home page and the health endpoint still answer, so Fedify only claims its own paths.

Live, against a dev server (createCms over TLS on localhost:4443, self-signed cert):
- fedify lookup from @fedify/cli 2.3.6 fetched the actor and printed the whole Person, both over http://localhost:4321/ap/actor and https://localhost:4443/ap/actor: 'Successfully fetched the object.' (AC 5)
- Fedify's own lookupWebFinger('acct:blog@localhost:4443', { allowPrivateAddress: true }) returned the JRD with the self link pointing at the actor, so the handle form resolves through the library too.
- parseNodeInfo(document, { tryBestEffort: false }) accepted /nodeinfo/2.1, which is the schema check rather than a shape assertion.

Caveat on AC 5: 'fedify lookup @blog@localhost:4443' and 'fedify webfinger acct:blog@localhost:4443' both fail, and neither is a fault in the server. @fedify/webfinger always fetches WebFinger over https (mod.js hardcodes the scheme) and the CLI's -p/--allow-private-address only covers URLs given on the command line, not the WebFinger URL it derives from a handle, so a loopback handle is blocked before the request goes out. The same lookup by actor URL succeeds, and the library call above proves the handle path. A public deployment has neither constraint.

Gates, from the repo root: pnpm build, pnpm test, pnpm typecheck, pnpm lint and pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired Fedify 2.3.6 into the CMS as a new src/federation/ area: createSiteFederation() behind a factory that takes a KvStore and a MessageQueue and defaults to MemoryKvStore + InProcessMessageQueue (decision-5), an actor dispatcher that builds the configured actor type from the site settings, a key pairs dispatcher over a new actor_keys table in the admin database, WebFinger through mapHandle, and a NodeInfo 2.1 dispatcher reporting geekity-cms. createCms mounts it in front of the admin and the public site through @fedify/hono and exposes it as cms.federation, so the demo app federates without changing.

The actor lives at {baseUrl}/ap/actor, under a sentinel identifier rather than the handle, so renaming @blog@host leaves the id, the collections and the stored keys alone. Its inbox, outbox, followers and following are registered and empty; TASK-17 fills the outbox and TASK-18 the inbox and the followers.

Verified with 19 new tests across src/admin/store.test.ts, src/federation/keys.test.ts and src/federation/federation.test.ts (WebFinger, the actor document and its keys, key persistence across two createCms instances on one data directory, NodeInfo, and the untouched public site), and live against a TLS dev server where fedify lookup from @fedify/cli 2.3.6 fetched the actor, Fedify's lookupWebFinger resolved the handle, and parseNodeInfo accepted the 2.1 document under strict parsing. pnpm build, test, typecheck, lint and format:check all pass from the repo root.

Two findings are worth carrying forward: Fedify refuses an origin with a path, so federationOrigin() drops it and federation is host-rooted even for a site in a subdirectory (which is what WebFinger requires anyway); and the package compiles without lib.dom, so src/types/webcrypto.d.ts maps CryptoKey, CryptoKeyPair and JsonWebKey onto node:crypto.
<!-- SECTION:FINAL_SUMMARY:END -->
