---
id: TASK-512
title: Split conversation.ts by responsibility and drop the isEvent flag
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 13:06'
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
- [x] #1 Activity folding, threads, post lookup and the feed adapter live in separate modules
- [x] #2 fromActivities has no boolean flag argument
- [x] #3 newestFirst does not mutate its input and callers no longer copy before calling it
- [x] #4 Conversation pages and feeds render the same: conversation and feed tests pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the conversation, feed, RSVP, backfill and boundary tests are green (401 pass).
2. Move the reading context (ConversationContext, Reading) into web/conversation-context.ts.
3. Move post lookup (documentNamed, ownDocumentNamed, threadRootOf, rootOf, commentedPost, PostsByObjectId) into web/conversation-lookup.ts.
4. Move activity folding (fromActivities, fromQuotes, quotesOf, activitiesAround, withdrawnBy, reactions, authorNaming, federatedInteraction, the Group/Part shapes) into web/activity-folding.ts. Split the RSVP branch out of fromActivities: the activities around a post are read once into a Heard value, fromActivities folds reactions and replies, fromAnswers folds RSVPs, and gather calls fromAnswers only for an event. fromStored loses its flag the same way: gather moves a stored RSVP into the answers group for an event.
5. Move gathering (gather, merged, fromStored, fromReplyPosts, namesIn, interactionOf, reply-post and byline authors) into web/conversation-gather.ts.
6. Move thread building (threadOf, sortThread, countReplies, ancestorsOf, rsvpGroups, placed/directReplies/repliesFed/saidIn/conversational, byPublished) into web/conversation-threads.ts.
7. Move the feed adapter (feedComments, spokenIn, newestFirst) into web/conversation-feed.ts; newestFirst copies before sorting and feedComments stops copying. Add a test that newestFirst leaves its input untouched.
8. conversation.ts keeps createConversation and the reader's operations. Update importers (feed-routes, index, markdown-representation) to the new modules rather than re-exporting.
9. Run the related tests after each step, then the full verify chain.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split web/conversation.ts (1429 lines) into: conversation-context.ts (ConversationContext, Reading), conversation-lookup.ts (documentNamed, threadRootOf, rootOf, commentedPost, PostsByObjectId), activity-folding.ts (heardAbout, fromActivities, fromAnswers, fromQuotes, quotesOf, activitiesAround, withdrawnBy, authorNaming, federatedInteraction, Group/Part), conversation-gather.ts (gather, merged, fromStored, fromReplyPosts, namesIn, interactionOf, documentAuthor), conversation-threads.ts (threadOf, sortThread, countReplies, ancestorsOf, rsvpGroups, saidIn, conversational, repliesFed, byPublished) and conversation-feed.ts (spokenIn, feedComments, newestFirst). conversation.ts (411 lines) keeps createConversation and the reader's operations.

isEvent flag: the activities around a post are read once into a Heard value; fromActivities(context, heard, stored, naming) folds reactions and replies, and fromAnswers(heard, naming) folds RSVPs; gather calls fromAnswers only for an event. Dropping the RSVP branch from fromActivities changes nothing for an event's Accept/TentativeAccept/Reject: they match no reaction and replyFrom returns undefined for anything but Create, which is what a non-event already relied on. fromStored lost its flag too: gather passes an event's stored comments through answersApart, which moves an RSVP into the answers group.

newestFirst copies before sorting; feedComments no longer copies. New conversation-feed.test.ts proves the input is untouched (it fails against the old in-place sort).

Importers updated rather than re-exported: web/index.ts (feedComments, spokenIn, ConversationContext), feed-routes.ts, markdown-representation.ts. Package exports unchanged. All new modules sit in web/, so layer-boundary holds. Related tests (27 files, 401 tests) green before and after.

Evidence for the criteria: tsc --noEmit clean (also with --noUnusedLocals for the new modules); 27 related test files, 401 tests, pass unchanged; conversation-feed.test.ts passes and fails against an in-place sort. The full verify chain (build, test, test:11ty, typecheck, lint, format:check) was still running at handoff, so the task stays In Progress until it is confirmed.

Full gate passed in the orchestrator's run: pnpm build, test (cms 7483 incl. 2 new), test:11ty, typecheck, lint, format:check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split web/conversation.ts (1429 lines) into conversation-context, conversation-lookup, activity-folding, conversation-gather, conversation-threads and conversation-feed modules; conversation.ts keeps createConversation and the reader operations (411 lines). An event's RSVPs fold in their own pass (fromAnswers, answersApart) instead of behind isEvent flags on fromActivities and fromStored. newestFirst copies before sorting, with a test proving the input is untouched. Verified by the full gate with no assertion changes.
<!-- SECTION:FINAL_SUMMARY:END -->
