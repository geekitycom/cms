---
id: TASK-361
title: Render and conversation code have seams
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 01:39'
labels: []
milestone: m-35
dependencies:
  - TASK-360
type: chore
ordinal: 320800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/render.ts createRenderer is a 600-line closure with three copies of the 404/410/500 renderer. web/conversation.ts gather() is 160 lines with a nested-ternary group chooser and mutable dedupe state across loops. index.ts passes createRenderer 15 inline callbacks, some holding real logic (backlinks front-page check).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Status pages render through one function
- [x] #2 gather is split into per-source steps merged at the end, and the group choice is a table keyed by interaction kind
- [x] #3 Logic in the renderer callbacks moves into web modules
- [x] #4 Conversation and render tests pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Check gather's coverage before touching it: withdrawn reaction (conversation.test 'takes a like back'), withheld reply (comment-page.test placeholders), one actor's like across stored and delivered (backfill.test TASK-336 AC #10), reply posts (conversation.test TASK-300). Add the missing case: a note under a reply post its author deleted (under.withdrawn merge), mutation-checked.
2. conversation.ts: split gather into per-source steps (quotes, activity log, stored comments, reply posts), each returning a Part (grouped entries, held, withdrawn) that one merge folds together in source order; the group choice becomes a GROUP_OF table keyed by InteractionKind, with the event RSVP override.
3. render.ts: renderNotFound/renderGone/renderServerError/renderMaintenance go through one statusPage function over a STATUS_PAGES table; documentPage reads the site data once.
4. New web/page-sources.ts: the renderer callbacks with logic (syndication, location, backlinks home check, comment and contact forms, menu pages, users, neighbours, newest/archive posts) built from store, redirects, site data and config; services.ts spreads it into createRenderer. Site settings read once per callback instead of repeated inline.
5. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check; deslop and no-comments pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Coverage before refactoring gather: withdrawn reaction (conversation.test 'takes a like back when the actor undoes it'), withheld reply (comment-page.test placeholder cases), one actor's like across stored and delivered (federation/backfill.test TASK-336 AC #10), reply posts (conversation.test TASK-300). Added 'drops a note under a reply post once its author deletes it'; it passed on the old code and fails when the reply-post step stops merging under.withdrawn.
gather: fromQuotes, fromActivities, fromStored, fromReplyPosts each return a Part (grouped entries, held, withdrawn); merged() folds them in source order (quotes, log, stored, reply posts), so stable sorts keep the old tie order. GROUP_OF maps InteractionKind to group; the event RSVP override stays in fromStored. The reaction dedupe set is local to fromActivities, seeded from stored reactions via reactionKey.
render.ts: renderNotFound/Gone/ServerError/Maintenance all go through statusPage over STATUS_PAGES; documentPage reads site data once instead of three times.
web/page-sources.ts: pageSources() builds syndication, location, pages, users, comment/contact forms, neighbours, backlinks (isHomepage), newest/archive posts; services.ts spreads it into createRenderer and owns the syndication/location readers no more. Not exported from the package.
Validation: pnpm build, typecheck, lint, format:check pass; pnpm test 5616/5616 in cms plus all plugins and demo.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split web/conversation.ts gather into per-source steps (quotes, activity log, stored comments, reply posts) merged by one function, with the group chosen from a GROUP_OF table keyed by interaction kind. The four status pages in createRenderer render through one statusPage function. The renderer callbacks with logic in cms/services.ts moved to the new web/page-sources.ts. No behaviour or public API change. Added a regression test for a deleted note under a reply post. Verified with pnpm build, test (all pass), typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
