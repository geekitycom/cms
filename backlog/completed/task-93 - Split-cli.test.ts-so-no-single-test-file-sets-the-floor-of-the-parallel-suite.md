---
id: TASK-93
title: Split cli.test.ts so no single test file sets the floor of the parallel suite
status: Done
assignee:
  - '@claude'
created_date: '2026-09-19 17:23'
updated_date: '2026-09-19 17:40'
labels:
  - infra
dependencies: []
references:
  - packages/cms/src/cli.test.ts
  - .github/workflows/ci.yml
  - 'https://github.com/geekitycom/cms/pull/39'
priority: low
type: chore
ordinal: 118800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `test`, `test-node-26` and `coverage` CI jobs run `node --test`, which gives each test file its own process and runs cores minus one of them at once (three on the 4 vCPU runners since PR #39). Wall time is therefore bounded below by the longest single file. `packages/cms/src/cli.test.ts` is that file: 1154 lines, 10 top-level describe blocks, 71 tests and about 27s of test time in a measured local run on 2026-09-19, roughly twice the next file. Split it into several files along its existing describe blocks (by CLI command) so the runner can spread them across processes. This is a test-only reorganisation: no test is dropped, renamed in meaning or weakened, and no production code changes. Measure before and after with the junit reporter (`tsx --test --test-reporter=junit`), summing testcase time per file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every test that was in `cli.test.ts` still exists and passes, and the total test count of `pnpm test` is unchanged
- [x] #2 No resulting test file accounts for more than about 12s of test time in a local run, measured the same way as the 27s baseline
- [x] #3 Helpers shared between the new files live in one module rather than being copied into each
- [x] #4 The new files match the `src/**/*.test.ts` glob, so `pnpm test` and `pnpm test:coverage` pick them up with no script change
- [x] #5 The task notes record the before and after wall time of `pnpm test` at `--test-concurrency=3`
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure the baseline: run the cms suite with the junit reporter and sum testcase time per file (cli.test.ts is the longest), and time the suite at --test-concurrency=3. Record the total test count (1907) and a sorted list of every test name.
2. Add a shared helper module at src/__testing__/cli.ts holding what more than one of the new files needs: PACKAGE_ROOT, the CliRun shape, runCli (spawns the bin from source through tsx), temporaryDir/cleanupTemporaryDirs, readJson, exists and siteWithContent (the site() helper that geekity sync and geekity rebuild each had a private copy of). It lives under __testing__ so tsconfig.build.json keeps it out of dist.
3. Split cli.test.ts along its ten top-level describe blocks, by CLI command, moving the test bodies verbatim:
   - src/cli.test.ts keeps parseArgs, readPassword, loadConfig, findSiteTsx and the geekity bin (the parts that do not spawn a command).
   - src/cli-init.test.ts: geekity init.
   - src/cli-sync.test.ts: geekity sync.
   - src/cli-user.test.ts: geekity user add.
   - src/cli-rebuild.test.ts: geekity rebuild.
   - src/cli-import.test.ts: geekity import wordpress-actor.
   All match src/**/*.test.ts, so no package script changes.
4. Prove nothing changed: rerun the junit measurement, diff the sorted test-name list against the baseline, and confirm the total count is still 1907 and every new file is well under 12s.
5. Re-time the suite at --test-concurrency=3 and record before/after wall time on the task.
6. Run pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`packages/cms/src/cli.test.ts` (1154 lines, 10 top-level describe blocks, 71 tests) is now six files, split along the describe blocks by CLI command. The test bodies moved verbatim; nothing was renamed, dropped or weakened, and no production code changed.

- `src/cli.test.ts` keeps the parts that do not spawn a command: `parseArgs`, `readPassword`, `loadConfig`, `findSiteTsx` and `the geekity bin`.
- `src/cli-init.test.ts` — `geekity init`
- `src/cli-sync.test.ts` — `geekity sync`
- `src/cli-user.test.ts` — `geekity user add`
- `src/cli-rebuild.test.ts` — `geekity rebuild`
- `src/cli-import.test.ts` — `geekity import wordpress-actor`

New helper module `src/__testing__/cli.ts` (AC #3) holds everything more than one of them needs: `PACKAGE_ROOT`, the `CliRun` shape, `runCli`, `temporaryDir`/`cleanupTemporaryDirs`, `readJson`, `exists` and `siteWithContent` — the latter being the private `site()` helper that `geekity sync` and `geekity rebuild` each had an identical copy of. It sits under `__testing__/` because `tsconfig.build.json` already excludes that directory, so it never reaches `dist/` (confirmed: no `dist/__testing__` after `pnpm build`). The file-scoped `after` hook that removed the temporary directories became `after(cleanupTemporaryDirs)`, one line in each of the six files.

## Measurements (2026-09-19, Node 24.18.0, 10-core Mac, quiet machine)

Per-file test time, the same way as the baseline: from `packages/cms`, `npx tsx --test --test-reporter=junit --test-reporter-destination=<file> "src/**/*.test.ts"`, summing the `time` attribute of every `<testcase>` per `file`.

Before — 109 files, longest `src/cli.test.ts` at 25.92s; next `federation/inbox.test.ts` 13.34s. Junit run wall time 33.68s.

After — 114 files. The six CLI files: cli-import 10.18s, cli-user 9.25s, cli-rebuild 6.55s, cli-init 5.95s, cli-sync 4.61s, cli.test.ts 0.99s. The longest file in the whole suite is now `federation/delivery.test.ts` at 14.69s. Junit run wall time 27.49s.

No new file is above 12s (AC #2). Run on its own, the six files together take 7.5s wall where the single file took 19.3s.

## Wall time of the suite at --test-concurrency=3 (AC #5)

`/usr/bin/time -p npx tsx --test --test-concurrency=3 "src/**/*.test.ts"` from `packages/cms`, two runs each:

- Before: 43.18s, 43.40s
- After: 43.43s, 42.99s

Unchanged, and worth recording why. At a concurrency of three this suite is throughput-bound, not bounded by its longest file: the per-file times sum to about 140-160s, so three workers need roughly 45s whatever the shape of the files. The 25.92s file was under that ceiling, so splitting it cannot move the number. What the split does move is the floor — the point below which no amount of parallelism can take the suite drops from 25.9s to 10.2s — and the wall time at the machine's own default concurrency, which fell from 33.68s to 27.49s (-18%). It also buys headroom: the suite grows, and the next time a runner gets more cores or the total shrinks, the longest file is what would have bitten.

## Verification

- `pnpm test`: cms tests 1907, suites 455, pass 1907, fail 0; demo tests 30, pass 30. Identical to the baseline run taken before any edit (1907/455/1907).
- Test identity: the sorted list of every `<testcase>` name from the junit run before and after is byte-identical (1905 lines each — junit emits 1905 testcases where node counts 1907 tests, the same on both sides). `diff` reports no difference.
- Structure identity: the sorted list of `describe(` and `it(` lines from `git show HEAD:packages/cms/src/cli.test.ts` and from the six new files concatenated is identical (81 lines each).
- `pnpm --filter @geekity/cms test:coverage`: 1907 pass, and the run includes `reads the key pair out of the JSON wp option get prints`, a test that now only exists in `src/cli-import.test.ts` — so the `src/**/*.test.ts` glob picks the new files up with no script change (AC #4).
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: all clean.
- `packages/cms/dist/` has no `__testing__` directory, so the shared helper is not published.

No criterion here needed anything outside this checkout, so all five are checked.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split `packages/cms/src/cli.test.ts` into six files along its ten top-level describe blocks, one per CLI command (`cli-init`, `cli-sync`, `cli-user`, `cli-rebuild`, `cli-import`, with `cli.test.ts` keeping the parser, password reader, config lookup and bin shim), and moved the helpers they share into `src/__testing__/cli.ts` so `runCli`, the temporary-directory bookkeeping and the `site()` builder exist once rather than per file. Test bodies moved verbatim; no production code changed, and the helper lives under `__testing__/` so it stays out of `dist/`.

Verified by measuring with the junit reporter before and after on the same machine: the longest single test file drops from 25.92s (`cli.test.ts`) to 10.18s (`cli-import.test.ts`), and the suite's junit wall time at the machine's default concurrency falls 33.68s to 27.49s. Nothing was lost: the sorted junit test-name list is byte-identical before and after, the sorted `describe`/`it` list of the old file matches the six new files exactly, and `pnpm test` still reports 1907 tests in 455 suites, all passing, as does `pnpm test:coverage`. `pnpm build`, `typecheck`, `lint` and `format:check` are clean. Wall time at `--test-concurrency=3` is unchanged at about 43s, because at that width the suite is throughput-bound rather than bounded by its longest file; the split removes the floor that would bind as soon as it is not.
<!-- SECTION:FINAL_SUMMARY:END -->
