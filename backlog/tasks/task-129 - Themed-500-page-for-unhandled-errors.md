---
id: TASK-129
title: Themed 500 page for unhandled errors
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - resilience
milestone: m-18
dependencies: []
references:
  - 'https://specification.website/spec/resilience/error-pages/'
priority: high
type: feature
ordinal: 153800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An unhandled error in a public route returns the framework's plain-text 500. Readers get no way forward, and the response does not use the site's theme. A site should get a themed error page that returns 500, explains the failure plainly, links home, and never shows a stack trace. The error itself should still be logged for the operator.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An exception thrown while rendering a public page returns status 500 with the theme's 500 template
- [ ] #2 Themes can override the 500 template the way they override 404; the default theme ships one
- [ ] #3 If rendering the themed page fails too, a minimal static HTML 500 is returned instead of a crash
- [ ] #4 No stack trace or internal path appears in the response body; the error is logged with the request path
- [ ] #5 Admin routes return a 500 in the admin's own layout
- [ ] #6 JSON and Markdown representations return a 500 in their own format, not HTML
<!-- AC:END -->
