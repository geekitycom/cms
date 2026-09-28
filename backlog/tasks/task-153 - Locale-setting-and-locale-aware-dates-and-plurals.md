---
id: TASK-153
title: Locale setting and locale-aware dates and plurals
status: To Do
assignee: []
created_date: '2026-09-28 23:37'
labels:
  - i18n
milestone: m-23
dependencies: []
references:
  - 'https://specification.website/spec/i18n/locale-content/'
  - 'https://specification.website/spec/i18n/plural-rules/'
priority: medium
type: feature
ordinal: 177800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site language is configurable and sets html lang, but month names are hard-coded in English (src/web/templates.ts, src/admin/formatting.ts) and strings such as the comment count use English plural rules. A site written in another language shows English dates to every reader.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dates on the public site are formatted with Intl.DateTimeFormat in the site's locale (the site language by default, overridable)
- [ ] #2 Plural-sensitive strings use Intl.PluralRules
- [ ] #3 Theme templates get a date filter that takes a style (for example, long or short) rather than a hard-coded format
- [ ] #4 The time element's datetime attribute stays ISO 8601
- [ ] #5 Output for an en site is unchanged
<!-- AC:END -->
