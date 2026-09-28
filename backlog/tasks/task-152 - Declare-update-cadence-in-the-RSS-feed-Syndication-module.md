---
id: TASK-152
title: Declare update cadence in the RSS feed (Syndication module)
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - feeds
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/foundations/feed-hygiene/'
priority: low
type: enhancement
ordinal: 176800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The RSS feed has atom:link rel=self, stable guids and validators, but no sy:updatePeriod or sy:updateFrequency, so readers poll on their own schedule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 RSS feeds declare the Syndication namespace with updatePeriod and updateFrequency, configurable with a sensible default
- [ ] #2 Every feed still validates with the W3C feed validator
<!-- AC:END -->
