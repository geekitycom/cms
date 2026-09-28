---
id: TASK-154
title: Per-post language
status: To Do
assignee: []
created_date: '2026-09-28 23:37'
labels:
  - i18n
  - federation
milestone: m-23
dependencies:
  - TASK-153
references:
  - 'https://specification.website/spec/accessibility/document-language/'
  - 'https://specification.website/spec/i18n/lang-attribute/'
priority: low
type: feature
ordinal: 178800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A site has one language, but some writers post in more than one. A post in another language should declare it, so screen readers pronounce it correctly, browsers offer to translate it, and fediverse clients filter it by language.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post or page can set lang in front matter and the editor offers it
- [ ] #2 The default theme puts lang on the article element when it differs from the site's
- [ ] #3 Feeds carry the post's language where the format allows
- [ ] #4 Federated objects carry contentMap and summaryMap keyed by the post's language
<!-- AC:END -->
