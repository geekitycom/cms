---
id: TASK-374
title: CLI and release tests run without compiling a child process each time
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 17:49'
updated_date: '2026-10-18 16:06'
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
The slowest suites in packages/cms's pnpm test spawn the geekity CLI as a child process through tsx, which compiles TypeScript on every spawn. CI is where this costs most: the test job runs on ubuntu-24.04-arm with 4 vCPUs and test concurrency 3, so the run's length follows the total work across files, and packages/cms takes about 7.5 minutes there against about 2 on a developer Mac.

Times per suite on CI, run 39127669238 (main at 953aa339, 2026-10-18), with a local run beside each: admin jobs under geekity serve 97.9 s (89.5 s local); geekity serve, supervised 76.4 s (60.0 s); geekity settings 55.1 s (35.5 s); geekity plugin upgrade 42.9 s (33.7 s); geekity import 33.9 s (24.1 s); geekity plugin add 30.7 s (23.9 s); geekity serve 26.9 s (16.6 s); geekity maintenance 20.9 s (15.6 s); geekity user add 19.7 s (12.8 s); a command used wrongly 18.3 s (13.8 s); geekity rebuild 15.1 s (11.4 s); geekity resend 14.7 s (10.5 s); geekity strip-metadata 14.1 s (10.1 s); a plugin command 12.7 s (10.5 s); geekity dev-mode 12.2 s (9.9 s); geekity init 11.1 s (8.4 s). The release.ts suites, listed when this task was filed, now take under 2 s each on CI and are out of scope.

Make these suites fast: call the CLI in process where the behaviour under test does not need a separate process (argument handling, output, exit codes, files written), and where a real process is the point (serve, supervision, signals, reload, a worker killed mid-job), spawn the already-built JavaScript with plain node instead of tsx, or share one process across the cases that can share it.

CI baseline before this task, packages/cms pnpm test duration_ms on main's test job: 447.9 s (run 39128212173), 474.8 s (39127669238), 455.2 s (38842360291), 438.9 s (38749418748), 441.0 s (38730618521); median of the three newest 455.2 s.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each suite listed in the description runs at least 50% faster on CI than its listed CI time, or the implementation notes say why one cannot, with its measured time
- [x] #2 The packages/cms test duration on CI is taken from three runs of the test job on the change and compared with the median of the three newest baseline runs in the description; the after median is lower, and both medians are reported
- [x] #3 Tests that move in process still assert the same exit codes, stdout and stderr, and files written; tests that still spawn still exercise a real process where that is the point
- [x] #4 pnpm test passes on a fresh checkout and with a stale dist: the test script makes sure the spawned JavaScript is current before any test spawns it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Stage 1, one lever: every test that spawns the CLI runs dist/cli.js with plain node (the shared runCli helper, and the serve spawns in cli-serve, cli-reload, cli-federation-queue and cli-jobs). Supervised workers then inherit plain node, not the tsx loader. pretest builds dist first with tsc -p tsconfig.build.json (about 1 s), so a stale dist cannot be tested (AC #4). Small TS helper scripts that tests spawn run on Node's own type stripping where they allow it.
2. Measure stage 1: the slow suites alone locally, then three CI runs of the test job on the branch, against the CI baseline in the description.
3. Stage 2 only for suites still short of 50% on CI: run the command in process where no real process is the point, which needs main() to take its cwd, output streams and stdin instead of reading process globals.
4. Record per-suite CI times and both medians in the notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured 2026-10-18 on the dev Mac before stage 1. One spawn of --help: tsx 0.52 s, dist with plain node 0.28 s. Node's own type stripping cannot run src/cli.ts (init.ts uses a parameter property). Six suites alone, tsx vs dist: settings 18 s vs 11 s, plugin upgrade 16 vs 9, import 11 vs 8, user 6 vs 4, maintenance 8 vs 5, rebuild 6 vs 4 (27 to 44% faster). tsc -p tsconfig.build.json takes about 1 s.

Final CI, three runs of the test job on PR #200 head 8bd4ed79 (stages 1 and 2, the fixture fix and the startup guard): 315.2 s, 315.4 s, 310.7 s. Median 315.2 s against the baseline median 455.2 s, 31% lower (AC #2).
Per suite, baseline -> run 3 (job 117720916422): admin jobs under geekity serve 97.9 -> 19.5 s (-80%), serve supervised 76.4 -> 46.3 (-39%), settings 55.1 -> 4.0 (-93%), plugin upgrade 42.9 -> 6.2 (-85%), import 33.9 -> 13.4 (-60%), plugin add 30.7 -> 4.4 (-86%), serve 26.9 -> 8.7 (-68%), maintenance 20.9 -> 1.5 (-93%), user add 19.7 -> 4.2 (-79%), a command used wrongly 18.3 -> 1.2 (-93%), rebuild 15.1 -> 8.1 (-46%), resend 14.7 -> 9.8 (-34%), strip-metadata 14.1 -> 8.9 (-37%), a plugin command 12.7 -> 3.0 (-76%), dev-mode 12.2 -> 0.9 (-93%), init 11.1 -> 0.8 (-93%).
Short of 50% (AC #1), and why: serve supervised 46.3 s, whose slowest tests wait on the plugin watcher's PLUGIN_SETTLE_MS (5 s, TASK-309) by design, several times per test; rebuild 8.1 s, resend 9.8 s and strip-metadata 8.9 s, whose commands build the whole CMS (createCms, the index scan, the job queue), so the full module graph and the boot are the work under test, not overhead. Running them in process would still build the CMS once per test.
Stage 2 found and filed TASK-423 (a config whose import fails loaded as {}) and TASK-424 (@geekity/cms/config so a real site keeps the faster start); both built in PR #201, stacked on this one.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
CLI tests no longer compile TypeScript per spawn: every spawned geekity runs the built dist/cli.js with plain node, pretest builds dist first, and a test file run on its own refuses a dist older than src. The geekity command itself starts in about 0.04 s instead of 0.28 s for commands that do not build the CMS, because each command loads its heavy modules when it runs and four helpers moved to light modules; a test keeps settings list from loading the core. A fixture that held a jobs test's shutdown for 60 s now fails only the boot it means to. On CI the packages/cms test median fell from 455.2 s to 315.2 s; 12 of 16 slow suites are 50 to 93% faster, and the notes say why the other four cannot be.
<!-- SECTION:FINAL_SUMMARY:END -->
