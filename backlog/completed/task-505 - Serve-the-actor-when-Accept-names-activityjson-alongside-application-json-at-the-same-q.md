---
id: TASK-505
title: >-
  Serve the actor when Accept names activity+json alongside application/json at
  the same q
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 02:01'
updated_date: '2026-10-24 02:06'
labels:
  - federation
  - bug
dependencies: []
priority: high
ordinal: 417800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A peer that fetches an author URL with Accept: application/activity+json,application/ld+json,application/json (activitypub-bot, which runs the tags.pub relay, sends exactly this) gets the author archive's own JSON instead of the Person. prefersActivityStreams gives every tie in q and specificity to the document, and application/json ties with application/activity+json. The peer finds no public key, refuses the site's signed requests with 401 'public key not found', and the relay Follow on badprose.com retried until it was noticed on the dashboard. A client that names an ActivityStreams type exactly, at the highest q it sends, is asking for the object; application/* and */* still go to the document. See doc-3 and decision-14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 prefersActivityStreams('application/activity+json,application/ld+json,application/json') is true, and so is the same with spaces after the commas
- [x] #2 prefersActivityStreams('application/*'), ('*/*'), ('application/json') and a browser's Accept stay false, and a lower q on the ActivityStreams types still loses
- [x] #3 An author archive and a published post answer that Accept header with the ActivityStreams object (application/activity+json), checked through the app
- [x] #4 doc-3 and the prefersActivityStreams doc state the tie rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Change the tie-break in prefersActivityStreams: at equal q, a more specific ActivityStreams match wins as before, and an equal tie wins too when both are exact types. Wildcard ties still go to the document. Unit test the rule and test the app at an author archive and a post with activitypub-bot's Accept.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found on badprose.com: the tags.pub relay Follow retried because tags.pub answered 401 'public key not found' to both RFC 9421 and draft-cavage signatures. A signed probe from the container showed that, and activitypub-bot's key fetch (lib/activitypubclient.js, Accept: application/activity+json,application/ld+json,application/json) got the author archive's JSON listing, [] on an empty site. Validation: new unit and app tests failed first (application/json; charset=utf-8 instead of application/activity+json), then pnpm build, test (cms 7477), test:11ty, typecheck, lint and format:check passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A peer that names application/activity+json or application/ld+json exactly, at the same q as an exact document type such as application/json, now gets the actor or the post's object instead of the document's JSON. application/*, */* and browsers are unchanged. doc-3 states the rule. Fixes relay follows to activitypub-bot servers such as tags.pub, which could not fetch the site's public key.
<!-- SECTION:FINAL_SUMMARY:END -->
