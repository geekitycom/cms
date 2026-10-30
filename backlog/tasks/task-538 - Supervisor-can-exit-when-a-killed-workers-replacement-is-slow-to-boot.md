---
id: TASK-538
title: Supervisor can exit when a killed worker's replacement is slow to boot
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T23:44:00Z'
updated_date: '2026-10-29T23:59:00Z'
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
- [x] #1 The failure is reproduced or its cause is shown from the supervisor's code and logs
- [x] #2 A worker that dies is respawned without the supervisor exiting, under CPU load as well as idle
- [x] #3 The respawn test passes 30 runs in a row with the CPU saturated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce under load by looping the respawn test with the CPU saturated; if the window is too narrow, widen it with a temporary delay between the port line and 'ready' to confirm the mechanism.
2. Read the supervisor state machine to see which branch logs 'The new server exited before it was ready.' and exits 1.
3. Fix where the system first goes wrong: the worker announces it is serving before the supervisor has accepted it. Carry the announcement in 'ready' and have the supervisor print it when it accepts the worker.
4. Verify: the respawn test 30 runs in a row under saturated CPU, the full cms suite, pnpm typecheck, pnpm lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduction: 160 loops of the respawn test (60 serial under 20 yes loops, 4x25 in parallel under 12 yes loops) on a 10-core Mac all passed; the window is too narrow to hit on demand. With a temporary 1.5 s delay inserted between the 'serving ... on port' line and worker.serving() in src/cli/serve.ts, the test fails on the first run with exactly the reported output: 'Geekity CMS is serving http://localhost:0 on port 63887' then 'The new server exited before it was ready.' and exit 1.

Cause: the killed worker was the first one, not a replacement. The worker prints its port line, then sends 'ready'. The test kills the worker as soon as it sees the port line; under load the supervisor has not yet handled 'ready', so it is still in 'booting' with everServed false. That branch treats the exit as a failed first start and exits 1 (the message has no 'The server did not start:' prefix and no 'starting another', which a respawn failure would log). The supervisor's rule is right: a first worker that never reported ready is a failed start. What is wrong is the announcement: the worker says it is serving before the supervisor has taken it on.

Fix: the worker passes its startup lines (dev mode, 'serving ... on port', Gemini) in the 'ready' message, and the supervisor prints them to stdout when it takes the worker on, in 'booting' or 'replacing'. A 'ready' the supervisor ignores (a worker it gave up on) prints nothing. The supervisor's state machine is unchanged: a first worker that exits before the supervisor has its 'ready' is still a failed start and exits 1.

Verification: with the same temporary 1.5 s delay before worker.serving(), the respawn test now passes (the port line waits for acceptance). Respawn test 30/30 under 20 yes loops on 10 cores. Full cms suite 7920/7920. pnpm typecheck and pnpm lint pass. New primary test: 'announces a worker only once it has taken the worker on'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The failure was not a slow respawn. The test killed the first worker as soon as it printed its port, and under load the supervisor had not yet handled that worker's 'ready', so it counted the exit as a failed first start and exited 1, as designed. The port line was premature: it said the site was up before supervision had it. The worker now sends its startup lines in 'ready' and the supervisor prints them when it accepts the worker, so 'serving on port' always means the supervisor will respawn the worker if it dies. Repro by widening the window with a temporary delay failed before and passes after; the respawn test passed 30/30 with the CPU saturated, plus the full cms suite, typecheck and lint.
<!-- SECTION:FINAL_SUMMARY:END -->
