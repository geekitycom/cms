---
id: TASK-94
title: >-
  Share generated key pairs across federation tests instead of generating one
  per test
status: To Do
assignee: []
created_date: '2026-09-19 17:23'
labels:
  - infra
dependencies: []
references:
  - packages/cms/src/federation/keys.ts
  - packages/cms/src/federation/delivery.test.ts
  - packages/cms/src/federation/inbox.test.ts
  - packages/cms/src/federation/relays.test.ts
  - 'https://github.com/geekitycom/cms/pull/39'
priority: low
type: chore
ordinal: 119800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The federation test files are the second largest block of test time after `cli.test.ts`: in a measured local run on 2026-09-19, `federation/delivery.test.ts` 14.0s, `federation/inbox.test.ts` 12.7s, `federation/relays.test.ts` 10.1s, `admin/federation.test.ts` 7.7s, `federation/federation.test.ts` 7.3s, `federation/keys.test.ts` 6.6s and `federation/wordpress.test.ts` 4.2s. The suspected cause, not yet confirmed, is RSA key pair generation repeated per test: `delivery`, `inbox`, `relays`, `wordpress` and `import-wordpress` tests (and `cli.test.ts`) all call a key generation function directly, and others reach it through `src/federation/keys.ts`. First confirm where the time goes (for example with `--cpu-prof` or by timing the generation calls). If key generation is the cost, generate a key pair once per test file, or once per process through a shared test helper, and reuse it wherever a test does not depend on the key being fresh. Tests whose subject is key generation, rotation or storage keep generating their own. If profiling shows another cause, record it in the notes and fix that instead, or close the task with the finding. The suite runs in CI on three jobs, so time saved here is saved three times per push.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The task notes state the measured cause of the time in the federation test files, with numbers
- [ ] #2 Combined test time of the federation test files listed in the description falls by at least half in a local run, or the notes explain why that is not achievable
- [ ] #3 Tests that assert on key generation, rotation or persistence still generate real keys and still pass
- [ ] #4 No production code path changes behaviour: any shared key fixture lives in test code only
- [ ] #5 The total test count of `pnpm test` is unchanged and every test passes on Node 24 and Node 26
<!-- AC:END -->
