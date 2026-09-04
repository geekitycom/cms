---
id: TASK-32
title: >-
  Followers and the inbox log live in content/_data/federation; SQLite indexes
  them
status: To Do
assignee: []
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 00:19'
labels:
  - federation
milestone: m-4
dependencies:
  - TASK-18
  - TASK-20
  - TASK-29
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: task
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The inbox handlers write `content/_data/federation/followers.json` (one object per follower: actor id, inbox, shared inbox, handle, name, icon, url, followed time) and append inbound Like, Announce and Create activities to `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`, one compact JSON-LD activity per line. Both are published with the site and reach Eleventy and the theme as data. SQLite keeps `followers` and `ap_inbox` purely as indexes: they are rebuilt from the files on boot, and every file write updates them in the same step. The followers collection, delivery fan-out and the federation screen read the index as they do now. Existing rows migrate to the files once on first boot. Writes to each file are atomic and serialised in process; a Follow and an Undo arriving together cannot tear the file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Follow appends the follower to followers.json and an Undo(Follow) or actor Delete removes it; the file is valid JSON after every step
- [ ] #2 Likes, boosts and replies are appended to the month's inbox JSONL file and appear on the federation screen
- [ ] #3 Deleting the database and booting rebuilds the followers and inbox indexes so the followers collection, the federation screen and delivery fan-out are identical to before
- [ ] #4 Existing followers and ap_inbox rows are written to the files on first boot and a test proves the followers collection is unchanged across that boot
- [ ] #5 An Eleventy build of the content directory sees the followers and the inbox entries as data (test in test/eleventy.test.ts or the demo)
- [ ] #6 Editing followers.json by hand and restarting is reflected in the collection
<!-- AC:END -->
