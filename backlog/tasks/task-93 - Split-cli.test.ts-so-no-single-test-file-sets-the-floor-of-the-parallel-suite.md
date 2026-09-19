---
id: TASK-93
title: Split cli.test.ts so no single test file sets the floor of the parallel suite
status: To Do
assignee: []
created_date: '2026-09-19 17:23'
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
- [ ] #1 Every test that was in `cli.test.ts` still exists and passes, and the total test count of `pnpm test` is unchanged
- [ ] #2 No resulting test file accounts for more than about 12s of test time in a local run, measured the same way as the 27s baseline
- [ ] #3 Helpers shared between the new files live in one module rather than being copied into each
- [ ] #4 The new files match the `src/**/*.test.ts` glob, so `pnpm test` and `pnpm test:coverage` pick them up with no script change
- [ ] #5 The task notes record the before and after wall time of `pnpm test` at `--test-concurrency=3`
<!-- AC:END -->
