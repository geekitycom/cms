---
id: TASK-130
title: Maintenance mode that answers 503 with Retry-After
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - resilience
milestone: m-18
dependencies: []
references:
  - 'https://specification.website/spec/resilience/maintenance-pages/'
priority: low
type: feature
ordinal: 154800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An operator upgrading a site or restoring content has no way to take the public site down on purpose. Maintenance mode should tell browsers, crawlers and fediverse servers that the outage is temporary, so they retry instead of dropping pages from their indexes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Maintenance mode can be turned on and off from the CLI and by an environment variable, without a restart where possible
- [ ] #2 While it is on, public pages, feeds and sitemaps answer 503 with Retry-After and a themed maintenance page
- [ ] #3 Signed-in admins can still use the admin, and /healthz reports the mode
- [ ] #4 Inbound ActivityPub deliveries receive a 503 so remote servers retry later
<!-- AC:END -->
