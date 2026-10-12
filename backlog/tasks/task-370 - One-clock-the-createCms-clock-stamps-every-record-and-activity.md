---
id: TASK-370
title: 'One clock: the createCms clock stamps every record and activity'
status: To Do
assignee: []
created_date: '2026-10-12 16:29'
labels: []
milestone: m-37
dependencies: []
priority: medium
type: chore
ordinal: 329800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
createCms takes a now option and the content index uses it, but about 55 direct new Date() / Date.now() reads in packages/cms/src bypass it. Most are timestamps on stored records (store/: followedAt, receivedAt, attemptedAt, createdAt, updatedAt; federation/relays.ts, records.ts, quotes.ts) and some end up in output, such as the Update activity id built in federation/delivery.ts. A test that pins now through createCms therefore gets a mixed timeline: content at the pinned time, records at the real time, and output it cannot predict. Thread the one clock through so every timestamp the CMS writes or sends comes from it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Outside the composition root and the system clock definition, no non-test module under packages/cms/src calls new Date() or Date.now() without arguments, except where the code measures elapsed wall time (timeouts, durations), and each such exception is listed in a check that fails on a new unlisted call
- [ ] #2 With now pinned through createCms, the timestamps stored for followers, inbox activities, deliveries, webmentions and relay records equal the pinned time (a test proves it)
- [ ] #3 With now pinned, an Update activity id for an edited post is predictable and a test asserts it exactly
- [ ] #4 Public export names are unchanged apart from any additive option; existing tests pass unchanged in behaviour
<!-- AC:END -->
