---
id: TASK-452
title: host.fetch can POST a JSON body
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
labels:
  - plugins
milestone: m-42
dependencies: []
references:
  - packages/cms/src/plugins/fetch.ts
priority: medium
ordinal: 389800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
host.fetch is GET only. Self-hosted Umami issues an API token from POST /api/auth/login with a username and password, so the Umami plugin cannot sign in. Let host.fetch send POST with a JSON body, keeping the same redirect limit and private-address block.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 host.fetch accepts method POST and a JSON body, and sends Content-Type application/json
- [ ] #2 The private-address block and redirect limit apply to POST as to GET, and a redirect after POST does not resend the body to another host
- [ ] #3 docs/plugins.md documents the option
<!-- AC:END -->
