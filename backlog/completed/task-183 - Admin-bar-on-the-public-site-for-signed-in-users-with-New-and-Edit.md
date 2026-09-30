---
id: TASK-183
title: 'Admin bar on the public site for signed-in users, with + New and Edit'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 12:01'
updated_date: '2026-09-29 12:21'
labels:
  - admin
  - theme
dependencies: []
priority: medium
type: feature
ordinal: 207800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today the admin bar (packages/cms/admin/layouts/shell.njk: site title linking to the dashboard, "View site", and the Hoopla! account menu from TASK-126) only appears inside /admin. Like WordPress, a signed-in user browsing the public site should see the same bar across the top of every page, with shortcuts to act on what they are looking at. On the public site the site title leads to the dashboard and "View site" is dropped, because the user is already viewing the site; inside the admin "View site" stays. Both places gain "+ New", which opens the new-post editor. On a post or page the user can edit, the bar also shows "Edit Post" or "Edit Page" linking to its editor (editorPath in src/admin/documents.ts); a static front page counts as that page. There is one admin role (src/admin/accounts.ts), so any signed-in user may edit any document. Today only single documents detect a signed-in viewer (signedInCommenter in src/web/routes.ts), and such responses are sent private, no-store with no validators; every public HTML page that shows the bar must do the same, while anonymous readers keep exactly today's cacheable pages. The bar must work with every theme, not just the default, so it cannot depend on a theme partial, and theme CSS must neither break it nor be broken by it. The account menu is a native popover and needs no script, and Log out stays a POST with the CSRF token and the Fetch Metadata check (TASK-132).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A signed-in user sees the admin bar at the top of every public HTML page (home, posts, pages, archives, search, 404), with the site title linking to the dashboard, + New, and the Hoopla! account menu, and no View site link
- [x] #2 On a post the bar shows Edit Post, and on a page (including a static front page) Edit Page, each linking to that document's editor; listings and archives show neither
- [x] #3 Inside the admin the bar keeps View site and gains + New; on the editor of a published document it also shows View Post or View Page
- [x] #4 + New opens the new-post editor
- [x] #5 Anonymous readers get byte-identical pages and the same caching headers as before, and pages drawn for a signed-in user are private, no-store with no validator, proven by tests
- [x] #6 The bar renders the same with the default theme and with a minimal custom theme that has no knowledge of it, and does not overlap or restyle the page's own header
- [x] #7 Log out from the public bar signs the user out with the same POST, CSRF token and cross-site refusal as in the admin
- [x] #8 The bar is keyboard reachable, has a label for assistive technology, and works at phone width
- [x] #9 JSON, Markdown, feeds and ActivityPub responses never carry the bar
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: the bar is one partial, admin/components/admin-bar.njk, over { site.title, adminUrl, barLinks: [{label, url}], me: {name, url}, logoutUrl, csrfToken }. The admin shell builds barLinks as View site, + New (newEditorPath(POST_KIND)) and, on an editor whose viewUrl is set, View Post/View Page. The public site builds + New and, on a post or page, Edit Post/Edit Page (editorPath). Its styles move out of admin.css into admin/static/admin-bar.css, self-contained (own colours on :root/:host, own font), which the admin links and the public bar inlines.
2. Public injection: a middleware at the top of mountPublicSite resolves the signed-in account once (signedInAccount in comments/viewer.ts, which signedInCommenter now builds on) and sets it on the context. Anonymous requests pass straight through untouched. For a signed-in viewer, after the handler, any text/html response (documents, listings, archives, search, 404, the 500) gets the bar inserted right after the opening <body> tag, cache-control private, no-store, and no ETag or Last-Modified. negotiateDocument records the post or page it drew so the bar can link its editor; listing and search pass private for a signed-in HTML viewer so no 304 is answered from an anonymous copy. JSON, Markdown, feeds and ActivityPub are not text/html and are never touched. The 503 is never drawn for a signed-in user (maintenance bypass), so it needs nothing.
3. Theme isolation: the bar is a <geekity-admin-bar> host with a declarative shadow root (<template shadowrootmode=open>), so no theme selector reaches its markup and none of its CSS reaches the page; the host carries an inline all:initial;display:block;grid-column:1/-1 so body > * rules cannot resize or re-flow it. It sits in normal flow above the theme's first element, so a sticky header sticks under nothing once scrolled. No opt-out API: a theme that must hide it can target the host with display:none !important. The popover and its invoker share the shadow tree, so the TASK-126 no-script menu works unchanged. The public site has no content CSP, so the inline <style> is allowed.
4. Tests first (src/web/admin-bar.test.ts): bar on home, post, page, static front page, tag archive, search and 404 for a signed-in user with no View site; Edit Post/Edit Page links and none on listings; + New href; private no-store with no validators and no 304 on listings; anonymous bodies and headers equal to a golden captured from main under a minimal theme fixture; JSON, Markdown, feeds and ActivityPub without the bar; logout from the public bar's form signs out and a cross-site POST is refused; the bar identical under the default theme and the minimal theme. Admin: + New and View Post/Page on a published document's editor (dashboard/posts tests).
5. Real browser via CDP headless Chrome: keyboard reach, popover open/close, AX label, phone width, default theme header not overlapped or restyled, and a sticky-header theme; screenshots checked by eye. Then pnpm build, test, typecheck, lint, format:check.

6. Revision after the browser run: the bar's CSS uses px, not rem (a rem is the theme's root size, and the default theme's made the bar 45px); the greeting keeps to the right when the bar wraps so the menu opens inside a 320px screen; and a six-line script inside the shadow root puts focus back on the greeting when the menu closes with focus inside it, because Chrome 154 does not restore focus from a popover in a shadow root (measured: light DOM restores, shadow DOM leaves focus lost).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: a middleware first in mountPublicSite (src/web/admin-bar.ts) resolves the signed-in account once (signedInAccount in comments/viewer.ts; signedInCommenter and negotiateDocument now build on it via commenterOf) and puts it on c.var.signedIn. Anonymous requests and /admin paths pass through untouched. For a signed-in reader any text/html response gets the bar after the first <body> tag, cache-control private, no-store, and no ETag, Last-Modified or Content-Length (c.res is cleared before reassigning, because Hono copies the old headers onto a new response). negotiateDocument records c.var.shownDocument for the Edit link; listing() and search() pass private for a signed-in HTML reader so a 304 is never answered off an anonymous copy's validators. The 503 needs nothing: signed-in users bypass maintenance.
Isolation: <geekity-admin-bar> with a declarative shadow root holding the inlined admin-bar.css and the shared components/admin-bar.njk partial (the admin shell includes the same partial in the light DOM). The host has an inline all: initial; display: block; grid-column: 1 / -1 reset. Opt-out is display: none !important on the host, documented in themes/default/README.md under 'The admin bar'. Bar styles moved out of admin.css into admin/static/admin-bar.css (linked by admin/layouts/base.njk), with --admin-bar, --admin-nav and --admin-nav-text declared on :root, :host there. The bar is now <nav aria-label="Admin bar"> instead of <header>, in both places.
Tests: src/web/admin-bar.test.ts (12 tests) and two new admin tests in dashboard.test.ts. The anonymous golden (src/web/__testing__/anonymous-pages.golden.json) was captured by running the same test on main in a detached worktree with GEEKITY_UPDATE_GOLDEN=1, then copied over; it passes unchanged on this branch. It covers home, post, page, tag archive, author, search and 404 under the bare theme, each plain, with a forged cookie and revalidated with its ETag (304), plus a static front page, a post's JSON and Markdown, and the RSS feed.
Default-theme before/after: main and this branch served in turn on the same port from source over identical content, 40 anonymous responses captured (14 URLs, plain, forged cookie, If-None-Match). All headers identical; all bodies identical except the comment form's per-request 'loaded' timestamp, which differs between any two requests on main too.
Browser (headless Chrome 154 over CDP, scratchpad b183/bar.mjs, 38 checks per theme, ALL PASS for the default theme and for a bare theme with a sticky header, a grid body, body > * rules, * { font-family !important } and .admin-bar { display: none !important }): the bar is body's first element and spans the width; background, font, link colour and the greeting's button style are the admin's under both themes; the theme header's box and computed styles are identical to the anonymous page, only shifted down by the bar's 40px; scrolled, the bar is gone and the sticky header is not covered; AX tree has a navigation landmark 'Admin bar' and the greeting as a collapsed/expanded button; first Tab lands on the site title, then + New, Edit Post, the greeting; Enter opens, Tab reaches Edit profile and Log out, Escape closes and focus returns to the greeting; click opens, click elsewhere closes; at 375px and 320px no horizontal scroll, header below the bar, menu opens inside the viewport; Log out by keyboard lands on /admin/login and the post then has no bar. The TASK-126 admin script (27 checks) still passes against the split stylesheet. Screenshots at desktop, scrolled, menu open, 375 and 320 checked by eye for both themes and the admin.
Gate: pnpm build, pnpm test (2474 + 31 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A signed-in user now sees the admin bar across the top of every public HTML page (home, posts, pages, archives, author pages, search, 404 and the 500): the site title to the dashboard, + New to the new-post editor, Edit Post or Edit Page on a post or page (a static front page included), and the Hoopla! account menu, with no View site. Inside the admin the bar keeps View site, gains + New, and shows View Post or View Page on the editor of a published document. The bar is one partial for both places. On the public site a middleware inserts it after the theme's <body> tag inside a declarative shadow root with its own inlined stylesheet, so no theme styles it and it styles no theme, and it sends those pages private, no-store, with no validator and never a 304. Anonymous readers go through untouched. Verified by src/web/admin-bar.test.ts (including a golden of anonymous responses captured on main and passing unchanged here), two new dashboard tests, a main-vs-branch capture of 40 anonymous default-theme responses (identical but for the comment form's per-request timestamp), headless Chrome checks of keyboard, AX tree, popover, phone widths and header layout under the default theme and a hostile bare theme, and the full build, test, typecheck, lint and format gate.
<!-- SECTION:FINAL_SUMMARY:END -->
