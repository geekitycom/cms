---
id: TASK-541
title: Count a relay's duplicate-delivery answer as delivered
status: Done
assignee:
  - '@claude'
created_date: '2026-10-31T15:28:00Z'
updated_date: '2026-10-31T16:13:00Z'
labels:
  - federation
dependencies: []
priority: medium
type: bug
ordinal: 442800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tags.pub answers a Create it already holds with 400 and a problem-details body of type https://w3id.org/fep/c180#duplicate-delivery. The outbox treats that as a failure and Fedify retries it until it gives up; the delivery log shows the relay as retrying (andrewshell.org, missing-printed-magazines #create, 2026-10-31). The inbox already has the activity, so the delivery should settle as sent and stop retrying.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A 400 whose body is a problem-details object of type https://w3id.org/fep/c180#duplicate-delivery settles as sent
- [x] #2 That delivery is not retried
- [x] #3 Any other 400 settles as it does now
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
outbox-observer marks a 400 FEP-c180 duplicate-delivery as sent and drops Fedify's retry enqueue for it; the synchronous fanOut path treats it as sent too. Verified with unit tests and a through-Fedify test.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A 400 FEP-c180 duplicate-delivery answer settles as sent and is not retried, in the queue worker and the synchronous path. Released in 0.49.0, deployed to andrewshell.org 2026-10-31.
<!-- SECTION:FINAL_SUMMARY:END -->
