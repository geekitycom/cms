---
id: TASK-441
title: Dashboard home drops the Recent posts card and keeps the stat tiles
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-20 21:43'
labels:
  - admin
  - dashboard
milestone: m-41
dependencies: []
references:
  - packages/cms/src/admin/routes.ts
  - packages/cms/admin/pages/dashboard/home.njk
priority: medium
ordinal: 378800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dashboard › Home shows a stat tile row (published posts, drafts, pages, followers, comments waiting, messages unread) and a Recent posts card. The Recent posts card repeats what the Posts list shows. Remove it, so the space below the tiles is free for the charts in this milestone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /admin draws no Recent posts card, and the store is not asked for recent posts
- [x] #2 The six stat tiles draw as before, with the same labels, values and links
- [x] #3 The dashboard tests that assert on Recent posts are removed or replaced, and docs/admin.md no longer mentions it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Replace the dashboard tests that assert on Recent posts (five newest, empty state, card shape) with tests that GET /admin draws no Recent posts card and never calls store.listAll for posts; keep the six-tile test as the proof for AC #2 and add a check that the tiles still carry their links.
2. Run the tests and watch the new ones fail.
3. Remove the Recent posts card (and the now-unused card/table/badge imports) from admin/pages/dashboard/home.njk, leaving the stat tile section as the last block in content so later widgets go below it.
4. Drop the recent: view data, DASHBOARD_RECENT_POSTS and its re-export from admin/index.ts, and the postLabel import if unused, in admin/routes.ts.
5. Update docs/admin.md's /admin row.
6. Run pnpm build, test, test:11ty, typecheck, lint, format:check; curl a running demo /admin signed in to confirm.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed the Recent posts card from admin/pages/dashboard/home.njk with its card, table and badge imports; the At a glance section is now the last block in content, so later widgets go after it. routes.ts no longer calls store.listAll for the dashboard and drops DASHBOARD_RECENT_POSTS (internal, re-exported only from admin/index.ts, not a package export) and the postLabel import.
Tests: dashboard.test.ts replaces the three Recent posts tests with one that finds no Recent posts and no table on the dashboard with posts, with drafts only, and empty, and one that wraps cms.store.listAll and finds no call during GET /admin. The six-tile test is unchanged and passes. The flash test that found the stranger's draft through Recent posts now reads /admin/posts. list-screens.test.ts lowers its scanner floor for tables inside cards from 5 to 4, because the dashboard table was one of them.
Validation: pnpm build, pnpm test (cms 6333 pass, all packages 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Demo server on port 3987 with a scratch data dir, signed in with curl: GET /admin 200, no 'Recent posts', six tiles Published posts 5, Drafts 1, Pages 7, Followers -> /admin/federation, Comments waiting -> /admin/comments?status=pending, Messages unread -> /admin/messages; </section> is followed directly by </main>. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dashboard › Home no longer draws the Recent posts card or asks the store for recent posts; the six stat tiles are unchanged. Removed the card from home.njk, the listAll call and DASHBOARD_RECENT_POSTS from routes.ts, and the /admin row's mention in docs/admin.md. Replaced the Recent posts tests with tests that find no card and no store.listAll call. Verified with the full build, test, test:11ty, typecheck, lint and format:check run and a signed-in curl of /admin on the demo.
<!-- SECTION:FINAL_SUMMARY:END -->
