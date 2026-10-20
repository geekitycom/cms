---
id: TASK-450
title: The dashboard warns when jobs or deliveries are failing
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - dashboard
  - federation
  - jobs
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 387800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Problems are now only visible on separate pages. A health widget appears only when something needs attention: failed or stuck jobs, failed federation deliveries, and failed outgoing webmentions, each with a count and a link.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With nothing failing, the widget draws nothing at all
- [ ] #2 Failed jobs, jobs running longer than expected, failed federation deliveries and failed outgoing webmentions in the last 7 days each show with a count and a link to where they are handled
- [ ] #3 Retried and later successful deliveries do not count as failures
<!-- AC:END -->
