---
id: TASK-271
title: Dashboard on DaisyUI stats and cards
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
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
- [ ] #1 At a glance is a row of DaisyUI stats, one per count, each number with its label, wrapping on a narrow screen rather than squeezing; the comments-waiting and messages-unread counts still link to their screens
- [ ] #2 Recent posts and the follower panel are cards composed through the card macro; dashboard.test.ts passes updated
- [ ] #3 The At a glance declaration tests in styles.test.ts are replaced by a test over the rendered dashboard that each count has a label and a number
- [ ] #4 The dashboard carries no legacy admin-* class
<!-- AC:END -->
