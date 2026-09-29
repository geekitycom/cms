---
id: TASK-156
title: Per-language syndication targets
status: To Do
assignee: []
created_date: '2026-09-29 01:32'
labels:
  - i18n
  - webmention
  - indieweb
milestone: m-23
dependencies:
  - TASK-155
  - TASK-154
references:
  - 'https://news.indieweb.org/how-to-submit-a-post'
priority: low
type: enhancement
ordinal: 180800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Some syndication targets are per language: IndieNews has a feed and a webmention endpoint per language (news.indieweb.org/en, /de, /fr and so on). Once posts carry a language (TASK-154) and syndication targets exist (TASK-155), a target's URL should be able to follow the post's language instead of the site declaring one target per language.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A target URL may contain a {lang} placeholder that is filled from the post's language, falling back to the site language
- [ ] #2 A target can restrict itself to a set of languages, and a post in a language it does not list does not link to or notify it
- [ ] #3 A German post tagged for IndieNews links to and notifies news.indieweb.org/de; an English one, /en
<!-- AC:END -->
