---
id: TASK-133
title: Serve /.well-known/security.txt and /.well-known/change-password
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - security
  - well-known
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/security/security-txt/'
  - 'https://specification.website/spec/well-known/change-password/'
priority: low
type: feature
ordinal: 157800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Neither well-known file is served. security.txt (RFC 9116) tells researchers how to report a vulnerability in a site. change-password points password managers at the admin's password screen, which makes sense because the CMS has user accounts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /.well-known/security.txt is served as text/plain from site config (Contact at minimum, Expires computed so it never goes stale, optional Policy and Preferred-Languages) and returns 404 when no contact is configured
- [ ] #2 /.well-known/change-password redirects to the admin screen where a signed-in user changes their password
- [ ] #3 packages/cms/README.md documents the config
<!-- AC:END -->
