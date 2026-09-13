---
id: TASK-68
title: >-
  Users are actors: the actor at the author URL, per-user keys, followers and
  delivery; the site actor goes
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:51'
updated_date: '2026-09-13 04:56'
labels:
  - federation
  - admin
  - content
milestone: m-11
dependencies:
  - TASK-66
  - TASK-67
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/federation/federation.ts
  - packages/cms/src/federation/actor.ts
  - packages/cms/src/federation/keys.ts
  - packages/cms/src/federation/records.ts
  - packages/cms/src/federation/delivery.ts
  - packages/cms/src/federation/paths.ts
  - packages/cms/src/admin/federation.ts
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 99200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the site actor (doc-4) with one actor per user, per decision-14. A user's actor is served at /author/{username}/ on an ActivityStreams request, with the profile from TASK-67 as name, summary, icon and attachments, preferredUsername the username, manuallyApprovesFollowers false, and its collections at /author/{username}/inbox/, /outbox/, /followers/ and /following/; the shared inbox is /inbox/ and inbox is reserved. WebFinger answers acct:{username}@host with the author URL and /@{username} as aliases, and /@{username} redirects to the archive. Each user has a key pair under data/keys/ named by the user, minted on first need and checked at boot as the site's is today. Followers are kept per user: content/_data/federation/{username}/followers.json, with the inbox log attributing each activity to the actor it was addressed to and the indexes rebuilt on boot as now. A post is delivered to its author's followers and to the relays; the outbox lists the author's posts; a Delete or Update comes from the author. The federation screen shows the actors and their followers and deliveries per user. Remove the site actor, /ap/actor and its collections, the actorHandle, actorType and avatar settings and the site avatar upload, and SITE_ACTOR_IDENTIFIER, and take the spike's findings (TASK-66) for how the actor id and key id are produced. This is feat(cms)!: a site that federated as the site actor starts again as its users, and no migration of the site actor's followers is provided. The demo is reset to federate as its admin user.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 fedify lookup @{username}@host returns a Person at the author URL with the profile fields, preferredUsername, inbox, outbox, followers, following, the shared inbox at /inbox/ and a public key; a browser GET of the same URL is the archive
- [x] #2 A Follow delivered to /author/{username}/inbox/ or /inbox/ is accepted, the follower lands in that user's followers.json and index, and an Undo removes it; the followers collection pages them
- [x] #3 Publishing a post delivers Create to its author's followers only and Update and Delete likewise; the outbox pages the author's posts; the fed-smoke job passes against the per-user actor
- [x] #4 Each user's key pair lives under data/keys/ named by the user, is minted on first need and refused at boot when unreadable, exactly as the site's keys were; a rebuilt database re-reads every user's followers
- [x] #5 The site actor, /ap/actor, the actor settings and the site avatar are gone, /ap/ is unregistered, and the settings screen and doc-4 no longer mention them; the federation screen is per user
- [ ] #6 The commit is feat(cms)! with a BREAKING CHANGE footer; doc-4 is rewritten around user actors and the package README's route table follows
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. paths.ts: the actor at /author/{identifier}/ with its collections as children (inbox/, outbox/, followers/, following/) and the shared inbox at /inbox/; FEDERATION_PREFIX and every /ap/ path go.
2. keys.ts: SITE_ACTOR_IDENTIFIER goes; a key pair per user under data/keys/{username}.{algorithm}.jwk, minted on first need, and assertActorKeysUsable run for every user at boot.
3. actor.ts: userActor(context, user) built from profileContext — name, summary, icon, attachment, preferredUsername, aliases (alsoKnownAs) — plus one actorId(context, user) helper and the key objects and SenderKeyPair[] built from it by hand, so TASK-69 is a value change. siteActor, ACTOR_CLASSES and the avatar setting go.
4. records.ts: followers per user at content/_data/federation/{username}/followers.json; the inbox log keeps its one chronological directory and each line names the recipient it was addressed to; the rebuild scans the per-user directories so a rebuilt database re-reads every user's followers.
5. store.ts: migration 18 puts a username on followers (primary key username+actor_id) and a recipient on ap_inbox; the follower APIs take a username.
6. federation.ts: the dispatchers key on the username; the outbox lists that user's posts, the followers collection pages that user's followers, following stays empty.
7. article.ts: a post is attributed to the actor of its author (userForAuthor, falling back to the first account) and cc'd to that author's followers.
8. delivery.ts / inbox.ts / relays.ts: all three sendActivity call sites take an explicit SenderKeyPair[] built from actorId; a post is delivered to its author's followers and to the relays; a relay subscription is sent by the first account; updateActor takes a user.
9. mount.ts: /.well-known/webfinger is a Hono route registered before the federation middleware, answering acct:{username}@host, the author URL and /@{username}; /@{username} is a 301 to the archive.
10. index.ts: boot checks every user's keys and rebuilds the per-user indexes; the site actor's exports go.
11. settings: actorHandle, actorType and avatar go, with the site avatar upload; the Federation settings page keeps the relay list alone.
12. admin/federation.ts and its template: one panel per user actor, with that user's followers and deliveries.
13. users.ts: saving a profile tells that user's followers.
14. The site actor's key files and followers file are retired rather than migrated: they are left on disk, never read again, and doc-4 says so.
15. fed-smoke, the demo's site.json, doc-4 and the README route table follow.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Every user is now an actor at their author URL.

**Paths.** `src/federation/paths.ts` drops `FEDERATION_PREFIX` and `/ap/` entirely: the actor is `/author/{identifier}/`, its collections are that URL's children with trailing slashes (`inbox/`, `outbox/`, `followers/`, `following/`), and the shared inbox is `/inbox/`. Both templates are built from `AUTHOR_BASE` and `INBOX_BASE` in `web/authors.ts`, so the actor id and the archive cannot drift apart. `ap` came off the reserved taxonomy bases with the prefix.

**Identity.** `actor.ts` is the new heart: `actorId(context, user)` is the one place an actor's id is decided (today `ctx.getActorUri`), and `mainKeyId`/`multikeyId`/`senderKeyPairs` are all built from it. The actor document's `publicKey` and `assertionMethod` are hand-built `CryptographicKey`/`Multikey` objects rather than `getActorKeyPairs`'s, and all three `sendActivity` call sites (delivery, inbox Accept, relay Follow/Undo) hand Fedify an explicit `SenderKeyPair[]`. TASK-69 is therefore one function body.

**Profile.** `userActor` builds a `Person` from `profileContext(user)` — the same shape the archive is headed with — plus `aliases` (serialised `alsoKnownAs`) and `attachment` `PropertyValue`s for the profile links.

**WebFinger.** A Hono route in `mount.ts`, registered before the federation middleware, answering the acct handle, the bare handle, the author URL and `/@{username}`; `/@{username}` is a 301 to the archive. One more gate went in front of Fedify: Fedify treats a bare `Accept: application/json` as an ActivityStreams request, which would have taken the author archive's listing JSON (doc-3) away, so the middleware is skipped for an author-archive path the CMS's own `prefersActivityStreams` says is not an AS request.

**Storage.** Followers are per user at `content/_data/federation/{username}/followers.json`; the inbox log stays one chronological directory and each line names the `recipient` it was addressed to. Migration 18 drops and remakes `followers` keyed `(username, actor_id)` — one actor may follow two of a site's people — and adds `ap_inbox.recipient`. `rebuildFederationIndexes` reads whatever user directories are on disk rather than asking users.json.

**Retired, not migrated.** The site actor's `data/keys/actor.*.jwk` files are left on disk and never read again; the old `content/_data/federation/followers.json` is left where it is, and `migrateFederationToFiles` no longer writes the followers half at all. A follow is an agreement with somebody and there is no honest answer to which user inherits one made with an account that no longer exists. doc-4 and both READMEs say so.

**Relays** are subscribed to by the site's first account (`primaryUser`): an instance-wide agreement, and the one actor that can be chosen without asking.

**Settings.** `actorHandle`, `actorType` and `avatar` are gone from `SiteSettings`, with `ACTOR_TYPES`, `ACTOR_HANDLE_PATTERN`, `profileChanged`, the whole `/admin/settings/avatar` endpoint and its forms. The Federation page keeps the relay list alone; a profile save on `/admin/users` is what now sends `Update` of an actor.

**Screen.** `/admin/federation` shows one panel per user with their handle, profile, actor id and followers, and the delivery table gained an "Announced by" column. `localPosts` resolves an object id by permalink now that `/ap/posts/` is gone.

**Test seam.** `src/admin/__testing__/users.ts`'s `writeUsers` writes `data/users.json` before a boot, with an optional real argon2 password for the tests that also have to sign in — the setup form only answers for a site with no accounts, and these sites are born with one.

Validation: pnpm build, test (1555 pass, 0 fail), typecheck, lint and format:check all pass, and pnpm fed:smoke passes end to end over real sockets — fedify lookup of http://localhost:PORT/author/andrew/ returns the Person with its inbox, outbox, followers, following, shared inbox at /inbox/ and public key; WebFinger answers acct:andrew@localhost:PORT with the actor as self and /@andrew among the aliases; a signed Follow from a Fedify peer is verified, accepted and written to content/_data/federation/andrew/followers.json; a Like reaches the log; and a Create(Article) and a resent Update(Article) are signed with the explicit SenderKeyPair[] and accepted by the peer.

Evidence per criterion:
- **#1** `src/federation/federation.test.ts` 'a user actor': the Person at /author/ada/ with its profile fields, preferredUsername, the four collections, the shared inbox at /inbox/, the keys and alsoKnownAs, and the same URL answering a browser with the archive; `pnpm fed:smoke` does the same over a socket with the real `fedify lookup`. The lookup is by URL rather than by @handle, which `@fedify/webfinger` cannot do over plain-http loopback at all (doc-8); the handle is proven through the WebFinger document the same run reads.
- **#2** `src/federation/inbox.test.ts`: a signed Follow at /author/blog/inbox/ and at /inbox/, the follower in followers.json and the index, the Undo removing it, and the log naming the recipient; the collection's counting and paging in federation.test.ts; a real signed Follow in fed:smoke.
- **#3** `src/federation/delivery.test.ts` 'two users' proves a post reaches its own author's followers and nobody else's, beside the existing Create/Update/Delete coverage; the outbox pages that user's posts in article.test.ts; fed:smoke passes against the per-user actor.
- **#4** `src/federation/keys.test.ts` (files named ada.\*.jwk, minted on first need, boot refused on a damaged one) and `src/federation/records.test.ts` 'reads every user's followers back, not just one's'.
- **#5** federation.test.ts asserts /ap/actor and its collections 404; settings-federation.test.ts asserts the page carries no actor fields; admin/federation.test.ts asserts the per-user panels and the 'Announced by' column; grep shows no SITE_ACTOR_IDENTIFIER, FEDERATION_PREFIX, actorHandle, actorType or settings avatar left in src, the templates or the demo.
- **#6** is left unchecked: doc-4 is rewritten around user actors and both READMEs' route tables follow, but the commit is not mine to make.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the site actor with one actor per user (decision-14). A user's actor is their author URL, /author/{username}/, with its collections as that URL's children and the shared inbox at /inbox/; the profile, keys, followers and delivery are all per user, and /ap/ is gone. One helper, actorId(context, user), decides an actor's id, and the key objects and all three sendActivity call sites are built from it with explicit SenderKeyPair[], so TASK-69's stored id is a value change (doc-8). WebFinger came off Fedify onto a Hono route that answers all four spellings of a person and publishes the aliases the actor also carries as alsoKnownAs. Followers moved to content/_data/federation/{username}/followers.json and the inbox log now names the recipient of each line; migration 18 rekeys the followers index on (username, actor_id) and adds ap_inbox.recipient. The site actor's keys and followers are retired rather than migrated — left on disk, never read — because a follow is an agreement with somebody. actorHandle, actorType, the site avatar and its upload endpoint are gone; a profile save on /admin/users is what tells followers now, and the federation screen is a panel per user. Verified with 1558 package tests (0 fail) including new ones for the per-user actor document, both inboxes, delivery reaching only its author's followers, the rebuild reading every user's file and /ap/ being unregistered; pnpm build, typecheck, lint and format:check pass, and pnpm fed:smoke passes end to end over real sockets against the per-user actor.
<!-- SECTION:FINAL_SUMMARY:END -->
