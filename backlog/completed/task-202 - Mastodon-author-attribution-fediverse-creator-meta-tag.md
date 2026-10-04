---
id: TASK-202
title: 'Mastodon author attribution: fediverse:creator meta tag'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:13'
updated_date: '2026-10-02 06:58'
labels:
  - federation
  - theme
  - seo
milestone: m-27
dependencies:
  - TASK-192
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/federation/actor.ts
  - 'https://blog.joinmastodon.org/2024/07/highlighting-journalism-on-mastodon/'
priority: medium
type: feature
ordinal: 218800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a post is shared on Mastodon, the link preview can name the author's fediverse account with a follow link, if the page carries <meta name="fediverse:creator" content="@user@host"> and the account lists the site's domain under author attribution in its Mastodon profile. Print that tag in the head of every post and page whose author resolves to a user, naming the user's own actor handle on this site (@username@host, from WebFinger), and on the homepage of a solo-author site. Document in the README that the owner must add the domain under Settings > Public profile > Verification > Author attribution in their Mastodon account (or the account they want credited).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post by a user carries <meta name="fediverse:creator"> with that user's @username@host handle; a page about nobody in particular carries none
- [x] #2 The handle matches what WebFinger answers for the user
- [x] #3 The README explains the Mastodon-side author attribution setting
- [x] #4 Sharing a post on a Mastodon instance whose account lists the domain shows the author attribution in the preview card, or the notes record what was checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in packages/cms/src/web/page-shell.test.ts: a post by a user carries fediverse:creator @username@host; the same value resolves through /.well-known/webfinger to that user (subject and self link); a solo site's homepage names the site author; a tag archive, a post by a name nobody answers to, and a several-authors homepage carry none.
2. One source for the account: accountOf(username, baseUrl) in federation/paths.ts on federationOrigin's handleHost; acctOf (WebFinger subject) and the admin federation summary's handle build on it.
3. A fediverseHandle template filter in web/templates.ts that calls accountOf with the environment's baseUrl, so a theme never spells the host.
4. base.njk head: print the meta beside article:author, from siteAuthor on an entry and soloAuthor on the root page, only when the profile has a username.
5. README: the Mastodon-side author attribution setting.
6. Verify: build, test, typecheck, lint, format:check; run the demo and compare the meta to a real WebFinger response with curl.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: after TASK-192. The tag on a solo-author homepage names the site author, which TASK-192 changes from a free-text name to a username; build on the new shape.

Built: accountOf(username, baseUrl) in federation/paths.ts is now the one source for {username}@{host} (federationOrigin's handleHost). WebFinger's acctOf and the admin federation summary's handle build on it, and a new fediverseHandle template filter in web/templates.ts prints @{account} with the environment's baseUrl. base.njk prints <meta name="fediverse:creator"> beside article:author from siteAuthor on an entry and soloAuthor on the root page, only when the profile has a username. So a post by a name no user answers to, a tag archive, and a several-authors homepage print none. On a solo site an entry with no author names the site author, which is what siteAuthor (TASK-192) and article:author already do.

Verified: pnpm build, test (3099 + 30 pass), typecheck, lint, format:check all clean. page-shell.test.ts 'the fediverse:creator tag (TASK-202)' covers AC #1 and AC #2 (the meta value is fed back to /.well-known/webfinger, which answers with that subject and the user's actor as self). Live: a scratch site on port 3471 served @ada@localhost:3471 on /2026/09/by/ and on / (solo), none on /tag/notes/; curl of /.well-known/webfinger?resource=acct:ada@localhost:3471 answered subject acct:ada@localhost:3471 and self http://localhost:3471/author/ada/. Server stopped.

AC #4 not checked, and blocked by more than a deployment. Mastodon credits a fediverse:creator account only when that account's attribution_domains include the link's domain. For a remote account Mastodon reads them from the actor's attributionDomains (app/services/activitypub/process_account_service.rb, set_immediate_attributes!). The handle this tag names is the user's actor on this site, not a Mastodon account, so the Mastodon settings screen the description mentions does not apply, and the actor document served at /author/ada/ carries no attributionDomains (checked with curl). Fedify 2.3.8's Person has no attributionDomains property. Until the actor publishes attributionDomains: [site host], a real Mastodon will not show the credit. The README says this. Follow-up needed, not created: publish attributionDomains on every actor.

2026-10-02: shll.me/ and posts print <meta name="fediverse:creator" content="@a@shll.me">. Sharing a post URL on me.dm (https://me.dm/@andrewshell/117369998450640643) did not exercise the credit: the post URL is an ActivityPub object, so Mastodon rendered it as an accepted quote of a@shll.me and built no preview card (card: null). The credit needs a link Mastodon cards, such as https://shll.me/ itself (answers 406 to activity+json).

2026-10-02, after TASK-210 shipped: me.dm toot https://me.dm/@andrewshell/117370013142466994 linking https://shll.me/: the API's card.authors lists account a@shll.me and the card shows 'More from Andrew Shell'. Mastodon only attaches that account when its attribution_domains include the link's host, so me.dm stored shll.me from the actor.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posts and pages by a user, and a solo-author homepage, print <meta name="fediverse:creator"> with the user's own @username@host, built by the same accountOf helper as WebFinger. Verified by tests that feed the handle back into WebFinger, curl on a scratch site and on shll.me, and a me.dm preview card of https://shll.me/ showing 'More from Andrew Shell' (with TASK-210's attributionDomains).
<!-- SECTION:FINAL_SUMMARY:END -->
