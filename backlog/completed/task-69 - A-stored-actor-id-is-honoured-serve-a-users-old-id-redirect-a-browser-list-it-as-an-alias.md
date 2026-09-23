---
id: TASK-69
title: >-
  A stored actor id is honoured: serve a user's old id, redirect a browser, list
  it as an alias
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:51'
updated_date: '2026-09-13 05:16'
labels:
  - federation
  - admin
milestone: m-11
dependencies:
  - TASK-68
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/admin/accounts.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/federation/actor.ts
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 99300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-14: a user record may carry the actor id they had elsewhere, such as https://andrewshell.org/?author=2, and it is identity rather than cache. The CMS never mints one, but when data/users.json names one for a user, that exact URL returns the user's actor document on an ActivityStreams request with that URL as its id and {id}#main-key as its key id, returns a 301 to the author archive otherwise, and appears in WebFinger's aliases beside the author URL and /@{username}. Matching is on the whole URL, query string included, and happens before the public site resolves the path, so a stored id on the site root with a query string works. Activities the user sends name the stored id as actor. The users screen shows a stored id read-only with a note that it is what the fediverse knows this user by; it is set by the import (TASK-71) or by hand in the file, never by the screen. This is the same rule TASK-65 applies to a post's activitypub.id, done for people, and the spike (TASK-66) says how the id and key id are produced under Fedify.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a stored actor id in data/users.json, an ActivityStreams GET of that URL returns the Person whose id is that URL and whose publicKey id is that URL plus #main-key, and a browser GET is a 301 to the author archive
- [x] #2 WebFinger for the user lists the stored id, the author URL and /@{username} as aliases and resolves a lookup by any of them to the same actor
- [x] #3 Create, Update, Delete and Accept activities the user sends name the stored id as actor, and a peer verifying the signature through fedify lookup accepts them
- [x] #4 A stored id with a query string on the site root (?author=2) is served the same as one with a path, and does not disturb the home page for any other request
- [x] #5 The users screen shows the stored id read-only with its note; a user without one behaves exactly as before
- [x] #6 doc-4 and the package README describe the stored-id rule for users beside the one for posts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. accounts.ts: add an optional readonly actorId to User — the whole URL a user was published under elsewhere — read in userFrom (dropped rather than refused when it is not an absolute URL, as a bad email is), carried through withoutHash. No setter: TASK-71's import or a hand edit writes it.
2. federation/actor.ts: actorId(context, user) answers the stored id when the record carries one and ctx.getActorUri otherwise. Nothing else changes — the key ids, the multikeys, aliases, every activity's actor and every sender key pair are already built from it (TASK-68, doc-8).
3. federation/mount.ts: storedActorAt(c), a sibling of storedObjectAt — path plus query against the base URL, matched against every user's stored id — served by respondWithObject(userActor(...)) for a peer and a 301 to the author archive for a browser, in the same middleware the post's stored id is served from and so before the public site resolves the path. A stored id that is the author URL itself falls through, as a post's does.
4. federation/mount.ts: webFingerSubject also matches the stored id, so a lookup by it resolves; aliases and the self link already follow actorId.
5. admin/users.ts and the users template: the row carries the stored id, rendered read-only beside the profile form with a note that it is what the fediverse knows this user by and that only the import or the file sets it. admin/federation.ts's actorSummary shows the same id, so the screen says what a peer would get.
6. __testing__/users.ts takes an actorId so the federation suites can write one.
7. doc-4 and the package README: the stored-id rule for people beside the one for posts, and the users.json field.
8. Tests first, at the HTTP seam: the actor at the stored id, the 301, WebFinger, a Create naming it as actor and the key ids in the document, a query-string id leaving the home page alone, and a user without one unchanged.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
A stored actor id is honoured, for people as for posts (decision-14).

**The field.** `User.actorId` in `src/admin/accounts.ts`: the whole URL, query string and all, read out of `data/users.json` by `storedActorIdFrom`, which drops anything that is not an absolute http/https URL rather than refusing to load the file — the rule a bad email already follows. No setter and no form writes one: TASK-71's import does, or somebody editing the file. `withoutHash` carries it, so every screen and dispatcher sees it.

**One value change.** `actorId(context, user)` in `src/federation/actor.ts` answers the stored id when there is one and `ctx.getActorUri` otherwise. TASK-68 built everything else off that function, so the actor's `id`, `publicKey` (`{stored}#main-key`), the multikeys (`#multikey-0`/`-1`), `alsoKnownAs`, every activity's `actor` and every `SenderKeyPair` followed with no further edit. `url` and the collections deliberately did not: those are cache, and a peer refetches them.

**Serving the URL.** `activityStreamsActor`/`storedActorAt` in `src/federation/mount.ts`, a sibling of `storedObjectAt` in the same middleware and so ahead of the public site: path plus query against `baseUrl`, `respondWithObject` for a peer, 301 to the author archive for a browser, and `undefined` — the home page, untouched — for everything else. A user whose stored id is their own author URL falls through, as a post whose stored id is its permalink does.

**WebFinger.** `webFingerSubject` also matches the stored id; `self` and `aliases` already came from `actorId`/`actorAliases`, so the document is WordPress's: subject the acct handle, self the stored id, aliases [stored id, archive, /@username].

**Two things beyond the plan, both in the same seam.** A `Follow` addressed to the stored id — which is what a peer that just read the actor document sends — was being ignored, because `parseUri` cannot parse a query-string URL; `followedUser` now falls back to matching the stored id. And the `Accept` named `follow.objectId` rather than the user's own id, so a follow of the archive was answered by an actor the signing key did not belong to; it names `actorId(context, followed)` now.

**Screens.** `/admin/users` shows a stored id read-only under the username with a note that it is what the fediverse knows the user by and that only the import or the file sets it. `/admin/federation`'s actor panel shows the same id, because the panel exists to say what a peer would get.

Evidence per criterion:

- **#1** `src/federation/federation.test.ts` 'a user whose record carries a stored actor id': the Person at the author URL with id, publicKey `{stored}#main-key` and both multikeys under the stored id; the Person served at `/?author=2` itself; and the 301 to `/author/ada/` for a browser. `pnpm fed:smoke` does the same over a socket with the real `fedify lookup`.
- **#2** The same file: the JRD's subject, its three aliases and its self link, and a lookup by each of the four resources resolving to the same person with the stored id as self. Proven again in fed:smoke against the running server.
- **#3** `src/federation/delivery.test.ts`: Create, Update and Delete all name the stored id as actor, the `Signature-Input` header names `{stored}#main-key` and the FEP-8b32 proof names `{stored}#multikey-1`; `updateActor` sends an Update whose object is the actor under the stored id. `src/federation/inbox.test.ts`: the Accept comes from the stored id, and a Follow addressed to it is accepted. The verification half is fed:smoke, whose new sixth leg delivers an Update of the migrated actor to a real Fedify peer on another port — the peer dereferenced the key id in the signature, found the key at `?author=2`, and answered 202 ('the peer verified a signature made under …?author=2#main-key').
- **#4** federation.test.ts: `/`, `/?author=9` and `/?p=2` all still answer 200 with the home page beside a `?author=2` id, and a path-shaped stored id (`/wp-json/activitypub/1.0/actors/2`) is served and redirected identically.
- **#5** `src/admin/users.test.ts` 'a stored actor id (TASK-69 AC #5)': the id and its note are on the screen, it is in no input, a profile save leaves it alone, and a site with no stored id says nothing about one. `src/admin/accounts.test.ts` covers the file end: read back whole, dropped when it is not a URL, and untouched by `setUserProfile`/`setUserEmail`.
- **#6** doc-4 gained 'A stored actor id' under Actors, with the WebFinger and Objects sections updated to match; the package README gained "A user's stored actor id" with the `users.json` shape, and its WebFinger and `data/users.json` paragraphs follow.

Validation: pnpm build, test (1577 package + 15 demo, 0 fail), typecheck, lint and format:check all pass; pnpm fed:smoke passes end to end twice.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A user record may now carry an actorId — the ActivityStreams id that person was published under somewhere else, such as WordPress's https://example.com/?author=2 — and the CMS serves them under it for the life of the account (decision-14). One function changed to make it so: actorId(context, user) in src/federation/actor.ts answers the stored id where there is one, and TASK-68 had already built the key ids, the multikeys, alsoKnownAs, every activity's actor and every sender key pair off it. Beside that, src/federation/mount.ts gained a sibling of storedObjectAt that serves the stored URL itself — path and query against baseUrl, the Person for a peer, a 301 to the author archive for a browser, and the home page untouched for every other request — and WebFinger learned to resolve by it. Two gaps found on the way: a Follow addressed to the stored id was ignored because Fedify's router cannot parse a query string, and the Accept named the URL that was followed rather than the user's own id; both are fixed in inbox.ts. The users screen shows a stored id read-only with a note that only the import or the file sets one, and the federation screen shows it as the actor's id. Verified with 1577 package tests (0 fail) covering the actor document, the URL and its redirect, WebFinger's four resources, Create/Update/Delete/Accept naming the stored id with a matching Signature-Input and integrity proof, the home page left alone, the users screen and the file parsing; build, typecheck, lint and format:check pass; and pnpm fed:smoke gained a sixth leg in which a real Fedify peer on another port verifies an Update signed under ?author=2#main-key by dereferencing that URL.
<!-- SECTION:FINAL_SUMMARY:END -->
