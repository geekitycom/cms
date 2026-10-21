---
id: TASK-448
title: The dashboard ranks posts by engagement
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-21 00:08'
labels:
  - dashboard
  - federation
  - comments
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 385800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Show which posts drew the most response over the last 30 days: likes, boosts, replies, webmentions and approved comments added up per post. The per-post totals are also what M43 sets beside Umami views, so make them available to plugins as a service.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The widget lists the top five posts for the last 30 days with their total and a breakdown by kind, each linking to the post editor
- [x] #2 Undone likes and boosts and unapproved comments do not count
- [x] #3 Per-post engagement totals are available to plugins through host.use
- [x] #4 A site with no engagement shows a short empty state
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: AdminStore.countInteractionsSince(since) (per object and kind, over the shared INTERACTIONS SQL so dedupe and Undo/Delete match the other widgets) and countApprovedCommentsSince(since) (per slug and source, approved only, activitypub-source import rows left out).
2. src/admin/engagement.ts: postEngagement(sources, since) maps inbox objects to posts with localPosts (thread-aware, as TASK-447) and adds comment/webmention counts per post slug; returns PostEngagement {slug, title, path, editUrl, likes, boosts, replies, webmentions, comments, total}, most first, ties by title.
3. Core widget 'top-posts' (full width, after recent interactions): top five over the dashboard period; table Post (editor link) | Total | Breakdown; empty-state paragraph.
4. Core services: CoreServices in plugin.ts with '@geekity/cms/engagement' (EngagementService.posts({since})); host.use accepts a core service name without a requires entry; registry.provideCore(...) called from createServices; use before that (CLI) throws a clear error.
5. Tests first per AC, docs/plugins.md + docs/admin.md, full checks, screenshots at 1280 and 390.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Counting: likes/boosts/replies come from ap_inbox through the same INTERACTIONS SQL as TASK-445/447 (one like or boost per actor and object, one reply per note, Undo and Delete aware), grouped per object and kind in SQL, then mapped to posts with localPosts (replies deeper in a post's thread count for that post). Webmentions and comments come from the comments table, approved only; source=webmention counts as webmentions whatever its kind; source=activitypub rows (pre-Geekity imports) are left out so the fediverse is not counted twice, as TASK-445/447 do.
Window: the widget follows the dashboard period (7 default, 30 via ?period=30), counting from the start of the first day in the site time zone. The AC's 'last 30 days' is met by the 30-day view; a fixed 30-day card under a 7-day tab would disagree with the cards above it.
Layout: full width after Followers(half)+Recent interactions(half), so the grid stays balanced. Per-kind columns crushed titles at 390 px, so the table is Post | Total | Breakdown (e.g. '1 like, 1 reply, 1 webmention'), which reads at both widths; page scrollWidth 390 at 390 px.
Service: core services are new. CoreServices interface in plugin.ts; names are not npm package names ('@geekity/cms/engagement') so no plugin name collides; host.use accepts them without a requires entry (UsedService<Name> type); PluginRegistry.provideCore() is called from createServices, so the service exists while the site runs; in a CLI command use throws 'provided while the site runs, not from the command line'. HOST_API_VERSION unchanged (3, unreleased).
Verification: widget-top-posts.test.ts (5 tests: top five + breakdown + editor links, 7 vs 30 day period, undone likes/boosts + pending/spam/imported comments left out, empty state, a plugin widget reading host.use('@geekity/cms/engagement')), services.test.ts core-service test. pnpm build, test (cms 6450 pass), test:11ty, typecheck, lint, format:check all exit 0. Headless Chromium screenshots of a seeded dashboard at 1280 (7 and 30 days) and 390 px checked.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a full-width 'Top posts' dashboard widget listing the five posts with the most fediverse likes, boosts and replies, approved webmentions and approved comments over the dashboard period (7 or 30 days), each with its total and a breakdown, linking to the post editor, with an empty state. The same per-post totals are a new core service, host.use('@geekity/cms/engagement').posts({ since }), available to any plugin without a requires entry, typed in plugin.ts and documented in docs/plugins.md. Verified with widget and service tests, the full build/test/typecheck/lint/format run, and headless Chromium screenshots at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
