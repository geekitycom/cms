---
id: TASK-376
title: 'Discussion settings: choose which document types take comments by default'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 02:21'
updated_date: '2026-10-15 02:02'
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
- [x] #1 Settings > Discussion shows a checkbox per document type (posts, pages) for whether that type takes comments by default, and saving persists both to content/_data/site.json
- [x] #2 A site that has never saved the new settings keeps today's behaviour: posts open, pages closed
- [x] #3 A site.json with `comments: false` still means comments are off everywhere after upgrading, and the Discussion page shows that state correctly
- [x] #4 With pages checked, a page whose editor setting is "Follow the site settings" shows the comment form and its comment endpoint accepts submissions; with pages unchecked it does neither
- [x] #5 A document set to off in the editor takes no comments regardless of the type default, and one set to on takes them when its type is unchecked (unless comments are off site-wide)
- [x] #6 The close-after-days window applies to every type that is open by default, or the Discussion page states which types it applies to; the choice is recorded in the implementation notes
- [x] #7 The page form, the comment endpoint and `answerable` all read the same policy, so they never disagree about whether a page is open
- [x] #8 The editor's "Follow the site settings" option tells the author what the site setting currently is for this document's type (for example "Follow the site settings (closed for pages)")
- [x] #9 Tests cover the policy for each combination of type default and per-document override, the settings form round-trip, and the editor label; docs that describe comment defaults are updated
- [x] #10 Closing comments never hides what was already said: a page, like a post, shows its existing conversation (comments, webmentions, reply posts) and stays in the site-wide conversation feed whether it is open or closed, including when comments are turned off site-wide or on that page; only the comment form (and endpoint) follow the open/closed rule. This replaces the current page-only rule in `answerable`
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Site namespace: declare comments_on_posts (commentsOnPosts, default true) and comments_on_pages (commentsOnPages, default false) in packages/cms/src/site/namespace.ts; form rows in admin/settings-fields.ts; add both to DISCUSSION_SETTINGS.fields and to discussion.njk as 'Take comments on: Posts / Pages'.
2. Policy: CommentPolicy gains openByDefault per DocumentType; commentPolicyOf reads it from site.json with the defaults above; commentsOpen uses it in place of the 'a page is closed' rule. The close-after-days window applies to every type open by default (AC #6), stated on the Discussion page.
3. AC #10: delete answerable and SiteView.showsConversation; every served document shows its conversation, has a comments feed, a pingback link (while webmentions are on) and a place in the site-wide feed. Only the form and the endpoint ask commentsOpen.
4. Editor: the 'Follow the site settings' option names the site's answer for the document's type, from commentPolicyOf(renderer.site()), so it reads the same policy.
5. Tests first for each: policy matrix, settings round-trip and legacy site.json, page form + endpoint for a page, closed page keeps its conversation/feed, editor label.
6. Docs: docs/comments.md, docs/theme/conversation.md, docs/feeds.md, docs/webmentions.md, docs/theme/feeds.md, docs/theme/comment-form.md.
7. Verify with pnpm build/test/typecheck/lint/format:check and on a running demo copy.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Settings: two site-namespace booleans, comments_on_posts (site.json commentsOnPosts, default true) and comments_on_pages (commentsOnPages, default false), declared in site/namespace.ts beside comments, with form rows in admin/settings-fields.ts and fields on DISCUSSION_SETTINGS. The site namespace is the content/_data/site.json file store, written whole, so both keys land there on any save. Defaults reproduce the old rule, so a site that never saves keeps posts open and pages closed.

Policy: CommentPolicy.openByDefault replaces the hard-coded 'a page is closed' line in commentsOpen. commentPolicyOf(site.json) is the one constructor; the page form, the comment endpoint and the editor label all call it. siteConversation built its own policy from typed settings; that copy is gone.

AC #6 choice: the close-after-days window applies to every type that is open by default, counted from the document's date. An undated document (most pages) never closes. The Discussion hint says so.

AC #10: answerable and SiteView.showsConversation are deleted. Every served document shows its conversation, has {permalink}feed/, its replies feeds and comment pages, appears in /comments/feed/, and advertises pingback while webmentions are on. Exception kept: the page chosen as the posts page gets no {permalink}feed/, since it renders the listing and /news/feed/ must stay a 404 (front-page test). Only the form and the endpoint ask commentsOpen.

Editor: 'Follow the site settings (…)' names the result for the document's type: 'comments are off on this site', 'closed for pages', 'open for posts, closing 14 days after the date', or 'open for pages' when the window is 0. The editor hint no longer claims front matter beats the site switch.

Validation: pnpm build, test (cms 6202 pass), typecheck, lint, format:check all clean. Mutation checks: restoring the old page rule fails 2 new site tests; re-gating page conversations in render.ts fails the AC #10 test. Live check on a copy of apps/demo/content (port 3999, stopped after): never-saved site -> /colophon/ no form, POST 403, label 'closed for pages'; pages ticked -> form, POST 303, site.json commentsOnPages true; approved comment; pages unticked -> no form, POST 403, comment still on page, /colophon/feed/ 200 with it, in /comments/feed/; comments off site-wide -> same, label 'comments are off on this site'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Settings > Discussion gets 'Take comments by default on: Posts / Pages', stored as commentsOnPosts/commentsOnPages in content/_data/site.json through the settings registry (defaults true/false, so unsaved sites behave as before). commentsOpen reads the per-type default instead of 'pages are closed'; the closing window applies to every type open by default. answerable is gone: closing comments, per page, per type or site-wide, removes only the form and the endpoint; the conversation, comment feeds, site-wide feed and pingback link stay on pages as on posts. The editor's 'Follow the site settings' option names what the site gives that type. Docs updated (comments, settings, feeds, webmentions, theme conversation/comment-form/feeds, admin). Verified with new policy matrix, settings round-trip, legacy site.json, page form/endpoint, closed-page conversation and editor-label tests, the full pnpm gate, and a live run on a demo copy.
<!-- SECTION:FINAL_SUMMARY:END -->
