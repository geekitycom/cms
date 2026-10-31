---
id: TASK-540
title: Federate a reply to a page off the fediverse without inReplyTo
status: Done
assignee:
  - '@claude'
created_date: '2026-10-31T15:28:00Z'
updated_date: '2026-10-31T16:13:00Z'
labels:
  - federation
dependencies: []
priority: high
type: bug
ordinal: 441800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A reply post whose in-reply-to is an ordinary web page (no ActivityPub object behind it) federates with inReplyTo set to that URL. Mastodon stores it as a reply whose parent it cannot find (in_reply_to_id null) and drops it from every home feed (app/lib/feed_manager.rb filter_from_home: status.reply? && in_reply_to_id.nil? -> :filter) and from the profile's Posts tab. Seen on andrewshell.org 2026-10-31: missing-printed-magazines replies to https://jetgirl.art/missing-printed-magazines/, delivered to indieweb.social and me.dm with 2xx, but no follower saw it.

The cause is the fallback in federation/article.ts replyTargetId: when the target is neither a local post nor a resolved CitedObject, the raw URL is sent. The served object (federation-routes article, outbox, MCP inspect) builds postObject without the delivery-time lookup, so whether a remote target is a fediverse object has to be recorded when delivery resolves it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reply whose in-reply-to does not resolve to a fediverse object is delivered with no inReplyTo
- [x] #2 A reply whose in-reply-to resolves to a fediverse object is delivered with inReplyTo naming that object's id, as now
- [x] #3 A reply to a post on this site keeps inReplyTo naming that post's object id
- [x] #4 The object a peer fetches, and the outbox, agree with what delivery sent: no inReplyTo once the target was found not to be a fediverse object, the resolved id once it was
- [x] #5 A reply never resolved since this change (federated before it) is served as before
- [x] #6 docs/federation.md says when a reply carries inReplyTo
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivery records what repliedTo found in content/_data/federation/replyTargets.json (object id, or null for no fediverse object); postObject reads it, so the served object, outbox and MCP inspect match the Create. Never-resolved targets keep the old raw-URL inReplyTo. Verified: delivery.test.ts reply suite (red without the null branch, green with), article.test.ts reply suite, full cms suite 7937 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replies to pages with no fediverse object now federate without inReplyTo; delivery records each target's resolution in content/_data/federation/replyTargets.json so served and outbox objects agree. Released in 0.49.0, deployed to andrewshell.org 2026-10-31. Posts federated before the fix stay hidden on Mastodon until moved to draft and republished under a reissued id.
<!-- SECTION:FINAL_SUMMARY:END -->
