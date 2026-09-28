---
id: TASK-136
title: Starter privacy policy page from geekity init
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - privacy
  - docs
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/privacy/privacy-policy/'
priority: low
type: feature
ordinal: 160800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new site starts with no privacy policy, and the site owner has to work out what the CMS itself collects. geekity init could scaffold a plain-language starter page that lists exactly what the CMS stores: comment and contact data, the IP hash, the admin session cookie, federation data, and optional Akismet. The owner then edits it for anything they add. It must be clearly marked as a starting point, not legal advice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity init writes a privacy page to templates/site with every CMS-collected item listed, and optional features (Akismet, contact form) marked as such
- [ ] #2 The default theme's footer links to the privacy page when it exists
- [ ] #3 The demo site includes the page
<!-- AC:END -->
