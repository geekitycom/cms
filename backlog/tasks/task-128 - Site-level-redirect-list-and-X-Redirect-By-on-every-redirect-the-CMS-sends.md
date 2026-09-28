---
id: TASK-128
title: 'Site-level redirect list, and X-Redirect-By on every redirect the CMS sends'
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - seo
  - urls
milestone: m-18
dependencies:
  - TASK-127
references:
  - 'https://specification.website/spec/seo/redirects/'
  - 'https://specification.website/spec/resilience/redirect-by/'
priority: medium
type: feature
ordinal: 152800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sites that move to this CMS, or reorganise, need arbitrary old paths to point somewhere new, for example WordPress ?p=123 links or a retired section. There is no way to declare a redirect today. Every redirect the CMS sends should also name the CMS in X-Redirect-By, so someone debugging a redirect chain behind a proxy can tell which layer issued it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A site declares redirects in a file (source path, target path or URL, permanent or temporary) that is part of the site's content, and they are served with the declared status
- [ ] #2 Declared redirects are checked before the 404 page and never shadow a live document
- [ ] #3 Invalid entries and redirect loops are reported at boot, not served
- [ ] #4 Every redirect the CMS sends carries X-Redirect-By: Geekity CMS
- [ ] #5 packages/cms/README.md documents the file format
<!-- AC:END -->
