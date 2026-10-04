---
id: TASK-240
title: Federate a reply to the author it answers
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:28'
updated_date: '2026-10-03 23:17'
labels:
  - federation
  - micropub
dependencies: []
references:
  - packages/cms/src/federation/delivery.ts
  - packages/cms/src/federation/citations.ts
  - packages/cms/src/federation/article.ts
priority: medium
type: bug
ordinal: 255800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Quill reply on shll.me (0.18.0, https://shll.me/2026/10/greg-photo-quill/) to the author's own Mastodon post https://indieweb.social/@andrewshell/117249870148068466 published correctly, with a u-in-reply-to h-cite on the page, but the Mastodon account got no notification. Its ActivityStreams Note has to: as:Public, cc: the author's followers, inReplyTo set to the status's web URL (/@andrewshell/117249870148068466), and no tag. Delivery (fanOut in packages/cms/src/federation/delivery.ts) sends a reply to followers and relays only; only likes and reposts add the cited author's inbox (citedAuthor, from citingActivity in packages/cms/src/federation/citations.ts, TASK-169). So the replied-to author's server never receives the reply unless that account follows the site, and the Note carries no Mention that Mastodon would notify on.

Fix it the way likes and reposts work: when a reply's target resolves as a fediverse object (lookupObject signed as the author, as citingActivity does), the Note's inReplyTo is the object's own id, it carries a Mention tag for the object's author with that actor in cc, and delivery adds the author's inbox (skipping one the followers already share). A target that is not a fediverse object federates as today. An Update or Delete of the reply reaches the same inbox. Unlisted replies keep their addressing (followers in to, Public in cc) plus the mentioned author.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reply to a fediverse status federates a Create whose inReplyTo is the status's ActivityPub id, with a Mention tag and the status author in cc
- [x] #2 The Create, and later Update and Delete of the reply, are delivered to the status author's inbox as well as the followers, once per shared inbox
- [x] #3 A reply to a page that is not a fediverse object federates exactly as today
- [x] #4 Tests use the stubbed remote host in delivery.test.ts (carol's status) and check the JSON-LD sent to her inbox
- [x] #5 A real reply from shll.me to a Mastodon post notifies the Mastodon account, or the notes say why it could not be checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a reply's resolved target, RepliedObject { id: URL; author: Actor | undefined }, found by one lookup shared with citingActivity (federation/citations.ts: lookupCited, signed as the author). A target on the site's own origin is not looked up, so a self-thread never posts to its own inbox.
1. Tests first in delivery.test.ts, against carol's status on the stubbed host: Create inReplyTo = status id, Mention tag for carol, carol in cc, delivered to carol's inbox and the followers' shared inbox; Update and Delete reach carol too; an author whose shared inbox is the followers' gets one POST; a reply to a plain page and to the site's own post federate as today; an unlisted reply keeps followers in to, Public in cc, plus carol.
2. citations.ts: extract the lookup from citingActivity; add repliedTo(context, document).
3. article.ts: postObject/postCreateActivity/postUpdateActivity take an optional RepliedObject: inReplyTo becomes its id, a Mention tag names its author, the author joins cc.
4. delivery.ts: the object Shape carries replyTo; announce, update, withdraw and resend pass it and add the author's inbox through citedAuthor (dedup per shared inbox already in fanOut).
5. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: CitedObject { id: URL; author: Actor | undefined } in federation/citations.ts, found by lookupCited, the lookup citingActivity already did (signed as the post's author), now shared. repliedTo(context, document) resolves a reply's in-reply-to through it; a target on the site's own origin is not looked up, so a self-thread never fetches itself or posts to its own inbox.
article.ts: postObject, postCreateActivity and postUpdateActivity take an optional CitedObject. With one, inReplyTo is the status's ActivityPub id, a Mention tag names its author (@user@host from preferredUsername and the actor id's host), and the author joins cc (public: to Public, cc followers + author; unlisted: to followers, cc Public + author).
delivery.ts: the object Shape carries replyTo; announce (Create), revise (Update, on save and on resend) and withdraw (Delete) add the author's inbox through citedAuthor, which fanOut already skips when the followers share it. A changed reply target keeps the object id, so it goes as an Update to the new author only.
Known limits: only delivery resolves the target. The Note the object dispatcher serves at the permalink and the outbox's Create still name the URL the post cites and carry no Mention, since a lookup per peer fetch would make every read a network call. Mastodon keeps the embedded object from the Create, so threading and the notification come from the delivered copy.
Tests (delivery.test.ts, stubbed remote host): Create to carol's inbox and the shared inbox with inReplyTo = STATUS_ID, Mention and carol in cc; one POST when the author (dora) shares the followers' inbox; Update on edit and on resend, and Delete on draft, reach carol; unlisted addressing plus carol; a reply to PLAIN_PAGE and to the site's own post federate as before. Failing first: the new tests failed with only https://remote.example/inbox delivered and inReplyTo = https://remote.example/@dora/2. Removing the own-origin guard makes the self-reply test fail with three fetches of https://blog.example/2026/03/earlier/.
Validation: pnpm build, pnpm test (3791 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean.
AC #5 not checked: it needs a real reply published from shll.me to a Mastodon post after this ships, which could not be done from here. To check it, deploy, reply from shll.me to a status of an account that does not follow the site, and confirm the mention notification arrives.

2026-10-03: on 0.19.0 at shll.me, a new reply to a status on indieweb.social notified that account (reported by the site owner).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A reply whose target resolves as a fediverse status federates with inReplyTo set to the status's ActivityPub id, a Mention of its author with them in cc, and delivery to the author's inbox (once per shared inbox) for Create, Update and Delete. Verified by delivery.test.ts against the stubbed remote host and live: a reply from shll.me on 0.19.0 notified the indieweb.social account.
<!-- SECTION:FINAL_SUMMARY:END -->
