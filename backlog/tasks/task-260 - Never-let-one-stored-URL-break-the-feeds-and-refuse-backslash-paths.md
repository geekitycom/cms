---
id: TASK-260
title: 'Never let one stored URL break the feeds, and refuse backslash paths'
status: To Do
assignee: []
created_date: '2026-10-04 01:14'
labels:
  - security
  - feeds
dependencies: []
priority: high
type: bug
ordinal: 275800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Red-team round C on TASK-258 (2026-10-03): a relative URL the post cleaner keeps, such as <a href="/\\javascript:alert(1)">, <img src="/\\["> or href="/\\x y", makes absoluteUrl (packages/cms/src/web/negotiate.ts:263) throw TypeError: Invalid URL inside absoluteHtmlUrls -> resolveForFeed, and feedItems maps every document without a catch, so one post takes down RSS, Atom and JSON Feed. Browsers also read /\\host as a protocol-relative URL, so on the page /\\evil.com links off-site. The editor can store the same body, so this is not Micropub-only. Make absolute-URL resolution in feeds total (leave or drop a URL it cannot resolve, never throw) and have the post cleaner (postUrl in web/sanitize.ts) refuse a relative URL that starts with a slash followed by a backslash, or contains a backslash before the path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post with an unresolvable URL in its body leaves every feed serving 200 with the other items intact
- [ ] #2 The Micropub cleaner drops href/src values beginning /\\ or //, and other backslash-before-path forms; tests use the red-team payloads
- [ ] #3 A test proves a single bad document cannot fail feedItems
<!-- AC:END -->
