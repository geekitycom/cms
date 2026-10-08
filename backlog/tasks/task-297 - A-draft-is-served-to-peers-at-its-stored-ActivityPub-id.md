---
id: TASK-297
title: A draft is served to peers at its stored ActivityPub id
status: To Do
assignee: []
created_date: '2026-10-08 11:15'
labels: []
milestone: m-31
dependencies: []
priority: high
type: bug
ordinal: 257800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mount.ts activityStreamsDocument checks isFederatedDocument for the permalink lookup, but the stored-id branch (storedObjectAt → getByStoredObjectId, then `if (wantsObject) return await article(c, federation, stored)`) serves the object with no draft, schedule or visibility check. Only trash is filtered. A draft: true, future-dated or non-public post whose front matter carries activitypub.id (for example https://site/?p=123 from a WordPress import) can be fetched in full by any peer that asks with an ActivityStreams Accept header. This was found by reading the code, not reproduced. The andrewshell.org migration imports 63 drafts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A request with an ActivityStreams Accept header for the stored id of a draft, scheduled, or non-public post answers 404, as the permalink would
- [ ] #2 A browser at that stored id is not redirected to the draft's permalink
- [ ] #3 A published post at its stored id is served as today
- [ ] #4 A regression test reproduces the leak before the fix
<!-- AC:END -->
