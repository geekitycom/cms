---
id: TASK-543
title: Accept the Delete of an account whose key is gone
status: Done
assignee:
  - '@claude'
created_date: '2026-10-31T15:50:00Z'
updated_date: '2026-10-31T16:13:00Z'
labels:
  - federation
dependencies: []
priority: medium
type: enhancement
ordinal: 444800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an account is deleted its server broadcasts a Delete of the actor to every server it knows. By then its key answers 410 Gone, so the signature cannot be verified; the site answered 401 and logged 'key not fetchable (HTTP 410) ... type=Delete' for each (dozens a day on andrewshell.org). Accept such a Delete when the object is the actor itself and the 410 came from the actor's own document, remove the follower, answer 202, and log nothing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A self-Delete whose key fetch answered 410, with the key in the actor's own document, removes the follower and is answered 202 with no warning
- [x] #2 A Delete of anything but the actor is still refused
- [x] #3 A 410 key outside the actor's document does not get a live actor's Delete accepted
- [x] #4 docs/federation.md describes the exception
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
onUnverifiedActivity calls acceptGoneActorDelete (inbox.ts) and returns 202 when it applies. Verified by inbox.test.ts 'whose key went with it' (red before, green after) and the full cms suite (7940 pass).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A self-Delete whose key answered 410 from the actor's own document is accepted with 202, the follower removed and nothing logged. Released in 0.49.0, deployed to andrewshell.org 2026-10-31.
<!-- SECTION:FINAL_SUMMARY:END -->
