---
id: TASK-189
title: Dates and plurals inside an article follow the post's language
status: To Do
assignee: []
created_date: '2026-10-01 14:00'
labels:
  - i18n
dependencies:
  - TASK-154
references:
  - packages/cms/src/web/templates.ts
  - packages/cms/src/web/locale.ts
priority: low
type: enhancement
ordinal: 205800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-154 marks an article with lang="fr-CA" when a post names its own language, but the date and plural filters still use the site locale (TASK-153), so the published date inside a French article on an English site is written in English. Add an optional locale argument to the date filter (plural already takes one) and have the default theme pass lang / post.lang inside the article only, so the navigation, sidebar and footer stay in the site's locale. Keep docs/eleventy.config.example.js in step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A date rendered inside an article whose post names lang: fr is written in French on an en site
- [ ] #2 Dates outside the article (nav, sidebar, footer, archive headings) stay in the site locale
- [ ] #3 The date filter accepts an optional locale argument, documented in the default theme README, and the Eleventy example matches
<!-- AC:END -->
