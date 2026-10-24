---
id: TASK-506
title: >-
  Split createRenderer into theme environment, Markdown environment and page
  builders
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
labels:
  - refactor
milestone: m-49
dependencies: []
priority: high
type: chore
ordinal: 417800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/web/render.ts:602 createRenderer is one 817-line closure holding theme wiring, Nunjucks filter registration, the ~100-line inner render(), citedBy, feed and listing context, status pages and Markdown rendering. Split it so each concern lives in its own module and the returned renderer only composes them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Theme/Nunjucks environment setup, Markdown environment setup and the page context builders live in separate modules under web/
- [ ] #2 No function in the renderer modules is longer than 100 lines; the inner render() delegates head, chrome and share-image context to named helpers
- [ ] #3 Rendered HTML, Markdown and gemtext output is unchanged: all existing web tests pass without changes to their assertions
<!-- AC:END -->
