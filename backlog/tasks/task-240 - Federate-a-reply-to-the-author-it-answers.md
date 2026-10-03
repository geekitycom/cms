---
id: TASK-240
title: Federate a reply to the author it answers
status: To Do
assignee: []
created_date: '2026-10-03 16:28'
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
- [ ] #1 A reply to a fediverse status federates a Create whose inReplyTo is the status's ActivityPub id, with a Mention tag and the status author in cc
- [ ] #2 The Create, and later Update and Delete of the reply, are delivered to the status author's inbox as well as the followers, once per shared inbox
- [ ] #3 A reply to a page that is not a fediverse object federates exactly as today
- [ ] #4 Tests use the stubbed remote host in delivery.test.ts (carol's status) and check the JSON-LD sent to her inbox
- [ ] #5 A real reply from shll.me to a Mastodon post notifies the Mastodon account, or the notes say why it could not be checked
<!-- AC:END -->
