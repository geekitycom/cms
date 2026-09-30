---
id: TASK-140
title: Speculation rules and cross-document view transitions in the default theme
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-30 00:25'
labels:
  - performance
  - theme
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/speculation-rules/'
  - 'https://specification.website/spec/performance/view-transitions/'
priority: low
type: enhancement
ordinal: 164800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public site is server-rendered with almost no JavaScript, which makes it a good fit for speculation rules (prefetch same-origin links a reader is likely to follow) and cross-document view transitions. Both are progressive enhancement: browsers that do not support them ignore them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The default theme emits speculation rules that prefetch same-origin public links with moderate eagerness, and exclude /admin/, feeds, logout and query-string URLs
- [x] #2 No speculation rules are emitted for a signed-in reader
- [x] #3 The default theme opts into cross-document view transitions, and disables them under prefers-reduced-motion
- [x] #4 Themes can turn both off
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: one speculation rule set, a single document-source prefetch rule at moderate eagerness whose where clause is href_matches the site's own paths (/* under the base path) and not /admin, /admin/*, /feed/*, /*/feed/*, anything with logout in the path, /uploads/* (files, not pages) and any URL with a non-empty query (/*\\?(.+), since /*\\?* also matches an empty query). Built in base.njk as a Nunjucks object and printed with | dump | safe, each pattern through | url so a subdirectory site gets its prefix.
2. base.njk gets two new blocks in <head>: speculationRules (the <script type=speculationrules>) and viewTransitions (an inline <style> with @view-transition { navigation: auto } inside @media (prefers-reduced-motion: no-preference)). A theme turns either off by overriding its block empty.
3. Signed-in readers: the publicAdminBar middleware, which already rewrites every HTML page drawn for a signed-in reader, strips any <script type=speculationrules> from it, so no theme's rules reach a signed-in reader and anonymous rendering stays untouched.
4. Tests first: page-shell.test.ts evaluates the emitted rules with URLPattern against public, admin, feed, logout, upload, query and cross-origin URLs, including under a base path; checks the view-transition style sits under reduced-motion no-preference; a site theme that empties both blocks emits neither. admin-bar.test.ts: signed-in pages under the packaged theme and a bare theme carrying rules have none; anonymous keep them. Adjust the no-JavaScript test to ignore the speculationrules script.
5. README (theme head section, blocks list) documents both and the off switches.
6. Real headless Chrome over CDP: Preload domain shows the rule set parsed with no error and the candidate URLs; hovering a post link prefetches it and hovering a feed/admin link does not; pagereveal carries a viewTransition on same-origin navigation and none with prefers-reduced-motion: reduce. Then pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. base.njk has two new head blocks, speculationRules and viewTransitions. The rules are a Nunjucks object printed with | dump | safe, and each href_matches pattern goes through | url so a subdirectory site keeps to its own paths. Query exclusion is /*\\?(.+) because URLPattern's /*\\?* also matches an empty query (checked in Node: it matched every URL). /uploads/* is excluded as well: those are files, not pages, and a hover should not pull a large PDF. Signed-in: publicAdminBar strips every <script type=speculationrules> (any quoting or case) from the HTML it already rewrites, so anonymous bytes are unchanged and a site theme's own rules never reach a signed-in reader either. Three existing 'no script that runs' assertions (page-shell, contact/site, apps/demo site) now ignore the speculationrules script alongside JSON-LD, since it is data a browser does not execute.
Tests: page-shell.test.ts evaluates the emitted rules with Node's URLPattern against public pages, /admin, /admin/*, /admin/logout, /logout/, every feed shape, an upload, query URLs and a cross-origin URL, also under baseUrl https://example.com/blog/; checks the view-transition rule sits inside prefers-reduced-motion: no-preference; a site theme that empties both blocks prints neither. admin-bar.test.ts: every HTML page kind under the packaged theme has rules anonymous and none signed in; a bare theme with two differently spelled speculationrules tags has both removed for a signed-in reader. Mutation: dropping the query exclusion from base.njk failed the AC #1 tests.
Browser (headless Chrome 154 over CDP, scratchpad b140/check.mjs, scratch site on port 3140, ALL PASS): Preload.ruleSetUpdated reports one rule set with no error; the matched candidates are exactly /, both posts, /about/ and /tag/notes/, not /feed/, /admin/, /search/?q=one, /tag/notes/feed/, /uploads/x.pdf or example.org; hovering each excluded link prefetches nothing, hovering /2026/09/two/ prefetches it (Running then Ready, Sec-Purpose: prefetch); a click to the second post fires pagereveal with a viewTransition, and the same click back under emulated prefers-reduced-motion: reduce fires pagereveal with none.
HTTP (curl on port 3140): /, a post, /about/, /tag/notes/, /search/?q=one and a 404 each carry one speculationrules script anonymously and none after signing in as a user (bar present, private, no-store).
Gate: pnpm build, pnpm test (2528 + 31 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme now prefetches the site's own pages when a reader hovers or presses a link (speculation rules, moderate eagerness), and cross-fades between pages with cross-document view transitions, off under prefers-reduced-motion. The rules exclude /admin, logout, feeds, uploads and any URL with a query, and follow the site's base path. The CMS strips speculation rules from every page drawn for a signed-in reader, so no theme's rules reach one and anonymous pages are unchanged byte for byte apart from the new tags. A site theme turns either feature off by emptying the speculationRules or viewTransitions block in layouts/base.njk; the theme README documents both. Verified by new tests in page-shell.test.ts and admin-bar.test.ts, headless Chrome 154 over CDP (rule set parsed, matched candidates, hover prefetch on a post and none on excluded links, pagereveal viewTransition present normally and absent with reduced motion), curl of anonymous and signed-in pages, and the full build, test, typecheck, lint and format gate.
<!-- SECTION:FINAL_SUMMARY:END -->
