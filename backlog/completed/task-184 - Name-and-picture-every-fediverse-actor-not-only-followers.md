---
id: TASK-184
title: 'Name and picture every fediverse actor, not only followers'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 12:35'
updated_date: '2026-09-29 23:34'
labels:
  - federation
  - comments
dependencies: []
references:
  - 'https://shll.me/2026/09/test-004-long-content/'
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
priority: medium
type: bug
ordinal: 207800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On https://shll.me/2026/09/test-004-long-content/ a like from mastodon.social shows as "@117132440785278319@mastodon.social" with no avatar, linking to https://mastodon.social/ap/users/117132440785278319 (which mastodon.social redirects to /@nicopeaks). Only followers are named properly: authorNaming in packages/cms/src/web/conversation.ts reads their stored profile, and everyone else is named by actorHandle in src/federation/replies.ts, which guesses @user@host from the last segment of the actor URL. That guess worked for /users/{name} ids, but newer Mastodon versions mint numeric ids (/ap/users/{number}) that carry no username, so every like, boost, reply and quote from a non-follower on such a server gets a number for a name and no avatar. The inbox already verifies each activity signature, which dereferences the sender, so the profile can be captured at receipt rather than fetched while a page is served. A remote profile can always be refetched, so it belongs in the disposable cache under decision-9, not in content files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When an activity arrives from an actor the site does not know, its display name, @preferredUsername@host handle, profile url and icon are stored, without delaying the inbox response and without any fetch while a page is served
- [x] #2 Conversations name an actor from a follower record first, then the stored profile, and fall back to a guess only when neither exists
- [x] #3 The fallback never shows a numeric id as a handle: an actor whose URL ends in a number and has no stored profile is shown by its server, for example someone on mastodon.social
- [x] #4 A stored profile's icon is served through the avatar proxy (TASK-134) like a follower's, and the proxy still refuses URLs the site has not recorded
- [x] #5 Links go to the actor's profile url when known, else the actor id
- [x] #6 Stored profiles are refreshed in the background and can be deleted with the cache and rebuilt, proven by a test that deletes the database
- [x] #7 Interactions already in the inbox log are backfilled once, so the like on test-004-long-content shows a real name and avatar
- [x] #8 Tests use a Mastodon-shaped actor with a numeric /ap/users/ id
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: ActorProfile {actorId, handle, name, iconUrl, url} plus fetchedAt, kept in a new SQLite table actor_profiles (admin migration 21). It is a cache under decision-9: nothing in content/ or data/ files, rebuilt by refetching.
2. federation/profiles.ts: profileFrom(actor) maps an actor document to display fields (shared with followerFrom in inbox.ts, so a follower and a stranger are read one way), and createActorProfileService({admin, config, load}) with capture(actorId) (fire and forget, skips followers, stored profiles, in-flight and recently failed actors), sweep() (every inbox actor that is not a follower and has no profile or a stale one, i.e. the one-time backfill and the background refresh), start/stop/settled. Failures are remembered in memory for an hour.
3. Wire it: createCms builds it after the federation with a loader that runs context.lookupObject through Fedify's document loader; FederationContextData carries it so handleLoggedActivity (Like, Announce, Create) calls capture after logging; serve() starts the sweep and close() stops and settles it; Cms exposes actorProfiles.
4. conversation.ts authorNaming: follower record, else stored profile, else the guess; link goes to the known profile url else the actor id; avatar via avatarHref.
5. replies.ts: actorHandle returns undefined for a numeric last segment; a new fallback names such an actor by its server (host). Mirror it in docs/eleventy.config.example.js.
6. Avatar proxy: isAvatarSource/listAvatarSources also accept an icon_url from actor_profiles whose actor is in ap_inbox.
7. Tests (profiles.test.ts) with a Mastodon-shaped actor at /ap/users/{number}, stubbed fetch: capture at receipt without delaying the 202, naming order, numeric fallback, avatar proxy, links, database deleted and rebuilt, backfill of a pre-existing inbox log.
8. Update doc-4 (and the theme README if it documents author naming), run build/test/typecheck/lint/format:check, local run of the backfill.

9. Revised after a local run against mastodon.social returned 401 to an unsigned actor GET: the loader (signedProfileLoader) signs the fetch as the site's first account instead of relying on Fedify's unsigned, cached document loader; the test stub refuses unsigned actor GETs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: actor_profiles SQLite cache (admin migration 21) holding handle, name, icon_url, url, fetched_at per actor id; federation/profiles.ts with profileFrom (the one reading of an actor document, now also used by followerFrom), signedProfileLoader and createActorProfileService (capture, sweep, start, stop, settled). handleLoggedActivity (Like, Announce, Create) calls capture after logging; capture returns void and fetches in the background. serve() starts the sweep (at once, then every 6 h): every inbox actor that is not a follower and has no profile or one older than 7 days; failures are skipped for an hour (kept in memory). conversation.ts names from the follower record, then the stored profile, then guessedName; actorHandle returns nothing for an all-digit last segment and guessedName falls back to the host. The avatar proxy's isAvatarSource/listAvatarSources accept an actor_profiles icon while the inbox log names the actor. FederationContextData, GeekityEnv, delivery and relay options carry actorProfiles; Cms exposes it. Eleventy example mirrors the fallback. doc-4, packages/cms/README.md (personal data table) and the theme README updated.

Finding from a local run against the real mastodon.social: it answers an unsigned GET of /ap/users/{id} with 401 {"error":"Request not signed"}. The inbox gets through because Fedify signs its key fetch as the recipient. So the profile fetch is signed as the site's first account (senderKeyPairs + context.getDocumentLoader), as relay follows are. The test stub now refuses unsigned actor GETs the same way.

Evidence: packages/cms/src/federation/profiles.test.ts, 12 tests, stubbed fetch, Mastodon-shaped actor at /ap/users/117132440785278319. Each was checked to fail against a matching defect (no capture call, no actor_profiles clause in isAvatarSource, no max age, no retry window, no numeric rule). AC #6 test deletes data/geekity.db, reboots, sees the host fallback, sweeps, sees the name again. AC #7: test boots over a pre-existing inbox log line and start() backfills it once. Local run: scratch site from geekity init, a data/ with no profiles, an inbox log line from http://127.0.0.1:3185/ap/users/117132440785278319 served by a stand-in that 401s unsigned GETs; serve() made one signed GET, stored Nico Peaks, curl of the post showed title="Nico Peaks", href to the profile page and a /_geekity/avatars/ src; an unrecorded avatar key was 404; a second boot over the same data made no second GET. Both servers stopped.

Not provable here: the live shll.me page. Once deployed, the first serve() sweep should fetch https://mastodon.social/ap/users/117132440785278319 signed as shll.me's first account and show @nicopeaks. Confirm on https://shll.me/2026/09/test-004-long-content/ after deploy.

Gates: pnpm build && pnpm test (2498 + 31 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0; pnpm test:11ty 16 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fediverse actors who are not followers are now named and pictured from their own actor document. A Like, Announce or Create makes the inbox ask the new actor profile service for the sender's profile; it is fetched in the background, signed as the site's first account (mastodon.social 401s unsigned actor GETs), and kept in a new actor_profiles SQLite cache. A sweep at serve() and every six hours backfills any inbox actor without a profile and refreshes profiles older than a week, which also rebuilds the cache after geekity.db is deleted. Conversations name an actor from the follower record, then the profile, then a guess that shows an all-digit id by its server; links go to the profile page, and profile icons go through the avatar proxy, which still refuses unrecorded URLs. Verified with profiles.test.ts (12 tests, stubbed network, numeric Mastodon id, each checked against a matching defect), a local serve over a pre-existing inbox log against a signature-requiring stand-in with curl of the page and avatar route, and the full build/test/typecheck/lint/format gate plus test:11ty. The live shll.me page still needs checking after deploy.
<!-- SECTION:FINAL_SUMMARY:END -->
