---
id: TASK-512
title: Split conversation.ts by responsibility and drop the isEvent flag
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 423800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/web/conversation.ts is 1429 lines holding activity folding, thread building, the object-id resolver and the feed adapter. fromActivities (conversation.ts:270) takes 6 arguments including isEvent: boolean. newestFirst (conversation.ts:1153) sorts its argument in place, and one caller copies defensively to avoid it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Activity folding, threads, post lookup and the feed adapter live in separate modules
- [ ] #2 fromActivities has no boolean flag argument
- [ ] #3 newestFirst does not mutate its input and callers no longer copy before calling it
- [ ] #4 Conversation pages and feeds render the same: conversation and feed tests pass without changes to their assertions
<!-- AC:END -->
