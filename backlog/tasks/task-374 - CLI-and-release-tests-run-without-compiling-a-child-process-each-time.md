---
id: TASK-374
title: CLI and release tests run without compiling a child process each time
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-12 17:49'
updated_date: '2026-10-18 13:42'
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
- [ ] #1 Each suite listed in the description runs at least 50% faster on CI than its listed CI time, or the implementation notes say why one cannot, with its measured time
- [ ] #2 The packages/cms test duration on CI is taken from three runs of the test job on the change and compared with the median of the three newest baseline runs in the description; the after median is lower, and both medians are reported
- [ ] #3 Tests that move in process still assert the same exit codes, stdout and stderr, and files written; tests that still spawn still exercise a real process where that is the point
- [ ] #4 pnpm test passes on a fresh checkout and with a stale dist: the test script makes sure the spawned JavaScript is current before any test spawns it
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

Stage 1 on CI (PR #200, run 39130926903): packages/cms 398.8 s (attempt 1), 378.0 s (attempt 2). Per suite against the CI baseline: admin jobs under serve 97.9 -> 83.9 s, serve supervised 76.4 -> 51.5, settings 55.1 -> 30.5, plugin upgrade 42.9 -> 26.5, import 33.9 -> 20.8, plugin add 30.7 -> 19.0, serve 26.9 -> 14.1, maintenance 20.9 -> 12.4, user add 19.7 -> 11.1, a command used wrongly 18.3 -> 10.7, rebuild 15.1 -> 8.8, resend 14.7 -> 9.3, strip-metadata 14.1 -> 8.5, a plugin command 12.7 -> 7.5, dev-mode 12.2 -> 7.1, init 11.1 -> 6.4. All 33 to 48% faster except the jobs suite.
Jobs suite: the TASK-400 AC #2 test took 61 s because its fail-boot fixture plugin hung every start while its marker existed, including the old worker's plugin restart on resume, so close() waited behind it until SHUTDOWN_MS (60 s) killed the worker. Found by timing each service's stop and settle: the plugin registry's stop never returned. Fixed in the fixture (it removes the marker when it fails a boot): test 61 s -> 1.1 s, suite 72 s -> 11.5 s locally. Not a product bug: a plugin whose start never ends holding shutdown until SHUTDOWN_MS is the designed backstop.
Stage 2: each spawn of dist/cli.js spends about 0.25 s loading modules (bare node 0.01 s, --help 0.27 s). cms/boot.js costs 0.22 s and every command loads it through config-loader for settleConfig, which needs only resolveConfig and the settings registry. Plan: move settleConfig to a light module and import heavy modules inside the commands that use them.

Stage 1 CI, three runs of the test job on PR #200 head 55745472: 398.8 s, 378.0 s, 385.4 s; median 385.4 s against the baseline median 455.2 s (15% lower). Stage 2 and the fixture fix are measured separately.
<!-- SECTION:NOTES:END -->
