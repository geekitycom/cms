---
id: TASK-348
title: Links in emails keep the site base path
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-32
dependencies:
  - TASK-347
references:
  - packages/cms/src/web/negotiate.ts
type: bug
ordinal: 307800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/negotiate.ts absoluteUrl keeps a base path, so /x on https://h/blog/ becomes https://h/blog/x. Seven private absolute() copies (comments/submission.ts, comments/records.ts, comments/moderate.ts, contact/delivery.ts, contact/submission.ts, notifications/comments.ts, notifications/digest.ts) use new URL(path, base) and drop /blog. Comment, contact and digest emails on a site served under a path link to the wrong place. Other ad hoc trailing-slash joins (web/templates.ts, notifications/links.ts, admin/recovery.ts) may have the same drift.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One absolute-URL builder exists and every former copy imports it
- [ ] #2 Comment, moderation, contact and digest emails built for a site with base URL https://example.com/blog/ link to URLs under /blog/
- [ ] #3 Trailing-slash joins across cms and plugins use one pair of helpers, and a base URL with a doubled trailing slash behaves the same in cms and plugins
<!-- AC:END -->
