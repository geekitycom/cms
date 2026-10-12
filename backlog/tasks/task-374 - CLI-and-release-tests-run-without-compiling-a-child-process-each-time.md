---
id: TASK-374
title: CLI and release tests run without compiling a child process each time
status: To Do
assignee: []
created_date: '2026-10-12 17:49'
labels: []
milestone: m-37
dependencies:
  - TASK-371
priority: high
type: chore
ordinal: 333800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The slowest suites in pnpm test are the ones that spawn the geekity CLI or scripts/release.ts as a child process through tsx, which compiles TypeScript on every spawn. In a full run on 2026-10-12: geekity serve, supervised 123 s; geekity plugin upgrade 75 s; geekity plugin add 52 s; geekity serve 40 s; release.ts failures after the preflight 34 s; geekity user add 30 s; a command used wrongly 28 s; geekity maintenance 25 s; geekity rebuild 20 s; a plugin command 19 s; geekity dev-mode 18 s; release.ts refusals 17 s; release.ts real run 17 s; geekity init 16 s. Make these tests fast: call the CLI in process where the behaviour under test does not need a separate process (argument handling, output, exit codes, files written), and where a real process is the point (serve, supervision, signals, reload), spawn the already-built JavaScript with plain node instead of tsx, or share one process across the cases that can share it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each suite listed in the description runs at least 50% faster alone than before, or the implementation notes say why one cannot, with its measured time
- [ ] #2 The packages/cms full test run is measured three times before and three times after on the same machine, and the median wall time is lower; both medians are reported
- [ ] #3 Tests that move in process still assert the same exit codes, stdout and stderr, and files written; tests that still spawn still exercise a real process where that is the point
- [ ] #4 pnpm test still passes when dist is stale or missing only if it builds first: the test script makes sure the spawned JavaScript is current
<!-- AC:END -->
