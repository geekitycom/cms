---
id: TASK-376
title: 'Discussion settings: choose which document types take comments by default'
status: To Do
assignee: []
created_date: '2026-10-13 02:21'
updated_date: '2026-10-15 00:56'
labels:
  - comments
  - admin
  - settings
milestone: m-39
dependencies: []
ordinal: 335800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site-wide comment switch on Settings > Discussion reads as "comments on", but `commentsOpen` in packages/cms/src/comments/policy.ts closes every page unless its front matter says `comments: true`. In the document editor the comments select offers "Follow the site settings", so an author with comments on for the site expects a page left on that option to take comments, and it does not. A page explicitly set to off correctly refuses comments; that part stays.

Replace the hidden "pages are closed" rule with a visible setting: Settings > Discussion gets "Allow comments on: [x] Posts [ ] Pages" (or equivalent wording), so "Follow the site settings" in the editor means what the Discussion page shows. Per-document `comments: true` / `comments: false` still overrides the default in both directions, drafts still take none, and the close-after-days window keeps applying.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Settings > Discussion shows a checkbox per document type (posts, pages) for whether that type takes comments by default, and saving persists both to content/_data/site.json
- [ ] #2 A site that has never saved the new settings keeps today's behaviour: posts open, pages closed
- [ ] #3 A site.json with `comments: false` still means comments are off everywhere after upgrading, and the Discussion page shows that state correctly
- [ ] #4 With pages checked, a page whose editor setting is "Follow the site settings" shows the comment form and its comment endpoint accepts submissions; with pages unchecked it does neither
- [ ] #5 A document set to off in the editor takes no comments regardless of the type default, and one set to on takes them when its type is unchecked (unless comments are off site-wide)
- [ ] #6 The close-after-days window applies to every type that is open by default, or the Discussion page states which types it applies to; the choice is recorded in the implementation notes
- [ ] #7 The page form, the comment endpoint and `answerable` all read the same policy, so they never disagree about whether a page is open
- [ ] #8 The editor's "Follow the site settings" option tells the author what the site setting currently is for this document's type (for example "Follow the site settings (closed for pages)")
- [ ] #9 Tests cover the policy for each combination of type default and per-document override, the settings form round-trip, and the editor label; docs that describe comment defaults are updated
- [ ] #10 Closing comments never hides what was already said: a page, like a post, shows its existing conversation (comments, webmentions, reply posts) and stays in the site-wide conversation feed whether it is open or closed, including when comments are turned off site-wide or on that page; only the comment form (and endpoint) follow the open/closed rule. This replaces the current page-only rule in `answerable`
<!-- AC:END -->
