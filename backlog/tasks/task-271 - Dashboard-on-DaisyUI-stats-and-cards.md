---
id: TASK-271
title: Dashboard on DaisyUI stats and cards
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 02:25'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-270
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 230800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the dashboard's At a glance counts become DaisyUI stat components and its panels (Recent posts, followers) become cards, through the macros. The counts are no longer a dl of dt/dd pairs laid out by hand; the styles.test.ts rules that read grid-row declarations for them go, and a test over the rendered page takes their place: six counts, each number labelled, drawn at one height whatever the label's length.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 At a glance is a row of DaisyUI stats, one per count, each number with its label, wrapping on a narrow screen rather than squeezing; the comments-waiting and messages-unread counts still link to their screens
- [x] #2 Recent posts and the follower panel are cards composed through the card macro; dashboard.test.ts passes updated
- [x] #3 The At a glance declaration tests in styles.test.ts are replaced by a test over the rendered dashboard that each count has a label and a number
- [x] #4 The dashboard carries no legacy admin-* class
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: the six At a glance counts are one table in daisyui/pages/dashboard/home.njk, each {label, value, href?}: Published posts (counts.posts), Drafts (counts.drafts), Pages (counts.pages), Followers (followers, href federationUrl), Comments waiting (pendingComments, href commentsUrl?status=pending), Messages unread (unreadMessages, href messagesUrl). One loop draws each as a one-stat DaisyUI stats tile; the route context is unchanged. There is no separate follower panel in the old dashboard (TASK-20 added followers as a count), so Followers stays one of the six stats and Recent posts is the one card; DaisyUI also forbids stats inside a card.

1. stat macro gains href: a linked stat is an <a class="stat"> whose value is in text-primary, so the link's name is its label and number; stats gains bg-base-100 like card. Tests first in components.test.ts.
2. Tiles sit in a container-query grid (2 columns, 3 from @2xl, 6 from @5xl) so they wrap on a narrow column instead of scrolling or squeezing; stat titles are nowrap, so every number sits at one height.
3. Recent posts: card macro around the table macro, titles as link link-hover, status as a badge (Draft / Published), empty state as text.
4. dashboard.test.ts: the dashboard tests run over both admins, the old in process and the DaisyUI one through a child-process probe (__testing__/dashboard-probe.ts) with GEEKITY_ADMIN=daisyui; each reads the six counts as label, number and link; the DaisyUI page carries no admin-* class outside the bar.
5. styles.test.ts: the At a glance declaration block and its helpers go.
6. Verify: pnpm build, test, typecheck, lint, format:check; headless Chrome over CDP at 1280 and 390, light and dark, stats wrap, linked counts navigate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built daisyui/pages/dashboard/home.njk. The six counts are one table in the template ({label, value, href?}) drawn by one loop, each a one-stat stats box in a container-query grid: two to a row, three from @2xl, six from @5xl of the column's own width, so a count moves to the next row instead of the row scrolling. stat-title is nowrap in DaisyUI, so every number in a row sits at one height. Followers, Comments waiting and Messages unread are linked stats: the stat macro gained href, which makes the whole stat an <a class="stat"> (its name is label and number) with the value in text-primary; stats gained bg-base-100 to sit on the shell's base-200 like a card. Recent posts is the card macro around the table macro, titles as link link-hover, the date nowrap, status as a badge (Draft solid warning, Published plain). The route context is unchanged.

On 'the follower panel': the old dashboard never had one. TASK-20 added Followers as a count, and it stays one of the six counts AC #1 and #3 name. DaisyUI's stat syntax also forbids stats inside a card. So Recent posts is the dashboard's only card; if a separate follower card is wanted, that is a follow-up.

Tests. dashboard.test.ts runs its dashboard tests over both admins: the old one in process, the DaisyUI one through __testing__/dashboard-probe.ts in a child with GEEKITY_ADMIN=daisyui over the same seeded content directories. Each reads the six counts as label, number and link with a reader for its own markup (dl or stat), the recent rows as text (date and Draft/Published), and the empty state; the DaisyUI admin additionally has Recent posts as a card around its table and no admin-* class outside the bar. The fixtures are built inside an async describe: built with top-level await, the root after hook cleaned the sandbox before the fixtures were read, and whichever admin read second saw empty directories. styles.test.ts loses the At a glance (TASK-115) block and its stylesheet-rule helpers; the rendered-count test in dashboard.test.ts replaces it. daisyui.test.ts used the dashboard as its unconverted screen; it now uses the Followers screen (/admin/federation), which TASK-274 converts.

Verified: pnpm build, pnpm test (4388 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Headless Chrome over CDP against a sandbox site with GEEKITY_ADMIN=daisyui: at 1280 and 390, light and dark (prefers-color-scheme emulated; body and stat backgrounds change with the scheme), page scrollWidth equals the viewport, no stats box scrolls, the stats sit 3+3 at 1280, 2+2+2 at 390, 3+3 at 800 and 6 in one row at 1600, each row's numbers at one y and every stat 98px tall; clicking Comments waiting reaches /admin/comments?status=pending (h1 Comments), Messages unread /admin/messages (h1 Messages), Followers /admin/federation. DaisyUI quality inspector (workflow m30-admin-dashboard) passed with no findings.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The dashboard in daisyui/ draws its six At a glance counts as DaisyUI stats, one box a count in a container-query grid that wraps two, three or six to a row, with Followers, Comments waiting and Messages unread as whole-stat links, and Recent posts as a card around the table macro with status badges. The stat macro gained href and stats gained bg-base-100. dashboard.test.ts now runs its dashboard tests over both admins (the DaisyUI one through a child-process probe) and checks six labelled numbers with their links, the recent rows, the card and the absence of admin-* classes; the At a glance declaration tests in styles.test.ts are gone. There is no separate follower panel: Followers was always a count and stays one of the six. Verified by pnpm build, test, typecheck, lint and format:check, and headless Chrome at 1280 and 390 in light and dark plus 800 and 1600, where the stats wrap without scrolling and the linked counts reach their screens.
<!-- SECTION:FINAL_SUMMARY:END -->
