---
id: TASK-538
title: Supervisor can exit when a killed worker's replacement is slow to boot
status: To Do
assignee: []
created_date: '2026-10-29T23:44:00Z'
labels:
  - bug
  - supervisor
dependencies: []
ordinal: 440800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On 2026-10-29, cli-reload.test.ts 'respawns a worker that dies, without the supervisor restarting' failed once in 9 full-suite runs on a heavily loaded Mac (several suites looping at once): after the test killed the worker, geekity serve's supervisor exited 1 with 'The new server exited before it was ready' instead of respawning. Cause not traced. If a slow or failed respawn can end the supervisor, a production site on a busy host would go down when a worker crashes, which is what supervision exists to prevent. Reproduce under load (e.g. stress the CPU while looping the test), find why the replacement exited and why the supervisor treated it as fatal, and fix the root cause.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The failure is reproduced or its cause is shown from the supervisor's code and logs
- [ ] #2 A worker that dies is respawned without the supervisor exiting, under CPU load as well as idle
- [ ] #3 The respawn test passes 30 runs in a row with the CPU saturated
<!-- AC:END -->
