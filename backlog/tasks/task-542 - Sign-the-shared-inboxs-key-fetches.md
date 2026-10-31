---
id: TASK-542
title: Sign the shared inbox's key fetches
status: Done
assignee:
  - '@claude'
created_date: '2026-10-31T15:39:00Z'
updated_date: '2026-10-31T16:13:00Z'
labels:
  - federation
dependencies: []
priority: high
type: bug
ordinal: 443800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A delivery to the shared inbox (/inbox/) is verified with an unsigned fetch of the sender's key, because the federation sets no shared key dispatcher. A peer in authorized fetch mode (indieweb.social) answers that fetch 401, so the delivery is refused, and Fedify caches the failure for 10 minutes, so the same key is refused at the personal inbox too, which does sign. Seen on andrewshell.org 2026-10-31: a quote of missing-printed-magazines from @andrewshell@indieweb.social stayed 'Post pending' because its Create hit /inbox/ (key not fetchable, HTTP 401) and the QuoteRequest to /author/andrew/inbox/ was then refused 15 times on the cached failure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A delivery to the shared inbox from a peer that serves its key only to signed requests is accepted
- [x] #2 The shared inbox signs its key fetches as a site user
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
setSharedKeyDispatcher signs shared-inbox key fetches as primaryUser. inbox.test.ts 'a peer in authorized fetch mode' reproduced the production refusal line (401) before the fix and passes after.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The shared inbox signs key fetches as the site's first account, so authorized-fetch peers are verified and no cached 401 refuses them at the personal inbox. Released in 0.49.0; after deploy andrewshell.org logged no inbox refusals.
<!-- SECTION:FINAL_SUMMARY:END -->
