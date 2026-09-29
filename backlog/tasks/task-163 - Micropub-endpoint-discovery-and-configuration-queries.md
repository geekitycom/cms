---
id: TASK-163
title: 'Micropub endpoint: discovery and configuration queries'
status: To Do
assignee: []
created_date: '2026-09-29 01:54'
labels:
  - micropub
  - indieweb
milestone: m-25
dependencies:
  - TASK-161
references:
  - 'https://www.w3.org/TR/micropub/'
  - 'https://indieweb.org/Micropub-extensions'
priority: medium
type: feature
ordinal: 187800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Micropub client finds the endpoint from the same page it signed in with, then asks it what it supports. Add the endpoint behind the bearer-token middleware from TASK-161, advertise it from the site root and every author archive (Link header and <link rel="micropub">) and in the IndieAuth metadata, and answer the read-only queries. This task accepts no posts; creating them is the next task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The site root and every author archive advertise the endpoint with a Link: rel="micropub" header and a <link rel="micropub"> in the head, from every theme
- [ ] #2 GET ?q=config returns media-endpoint, syndicate-to (empty until syndication targets exist) and the post types the site accepts
- [ ] #3 GET ?q=category returns the site's existing tags and categories, and supports a filter parameter
- [ ] #4 A request with no token gets 401, and an unknown q gets 400 invalid_request, proven by tests
<!-- AC:END -->
