---
id: TASK-94
title: >-
  Share generated key pairs across federation tests instead of generating one
  per test
status: Done
assignee:
  - '@claude'
created_date: '2026-09-19 17:23'
updated_date: '2026-09-19 18:07'
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
- [x] #1 The task notes state the measured cause of the time in the federation test files, with numbers
- [x] #2 Combined test time of the federation test files listed in the description falls by at least half in a local run, or the notes explain why that is not achievable
- [x] #3 Tests that assert on key generation, rotation or persistence still generate real keys and still pass
- [x] #4 No production code path changes behaviour: any shared key fixture lives in test code only
- [x] #5 The total test count of `pnpm test` is unchanged and every test passes on Node 24 and Node 26
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure before changing anything: per-file junit times, whole-suite wall at --test-concurrency=3, a --cpu-prof of delivery.test.ts, and a preload that times every webcrypto call across the whole suite.
2. Record the measured cause and the numbers on the task.
3. Add packages/cms/src/federation/__testing__/keys.ts: three fixed RSA-4096 + Ed25519 private JWKs (generated once with the same fedify calls production uses), a testKeyPair(n) that imports one, and a seedActorKeys(dataDir, username, n) that writes the files loadActorKeyPairs would otherwise mint.
4. Seed the key files in the admin sandbox harness (opt-out per call) so every admin site boots with the first admin's keys already on disk, and in the local site() helper of the federation tests that call createCms directly.
5. Replace the generateCryptoKeyPair calls that mint a *peer's* key (delivery, inbox, relays, wordpress) with fixture pairs, keeping the pairs that must differ from one another distinct.
6. Leave federation/keys.test.ts and federation/import-wordpress.test.ts generating real keys: their subject is generation, rotation and persistence.
7. Re-measure the same way, prove the test-name list and the count of 1907 are unchanged, and run pnpm build/test/typecheck/lint/format:check plus the suite on Node 26.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The measured cause

Measured before anything changed, on Node 24.18 on a 10-core Mac, from `packages/cms`.

A `--cpu-prof` of `federation/delivery.test.ts` run on its own showed 7.9s of its 9.6s as **idle** on the main thread: the work was not in JavaScript at all, it was on the libuv thread pool, where the profiler cannot see it. So the second measurement wrapped every `crypto.subtle` call with a `--import` preload and timed it.

That named the cause exactly. Fedify's `generateCryptoKeyPair('RSASSA-PKCS1-v1_5')` mints a **4096-bit** RSA pair, about 250ms each on this machine, and `loadActorKeyPairs` calls it once per user per fresh data directory — which is once per test, because almost every test boots a site on a new temporary directory.

- Whole suite: **155 RSA-4096 generations, 38.8s** of work. Total user CPU for the suite was 216s, so key generation was about **a quarter of everything the suite did**.
- Per file, standalone wall time, of which RSA generation: delivery 9.9s / 6.9s, inbox 7.3s / 6.4s, relays 6.4s / 4.8s, keys 4.2s / 4.0s, admin/federation 3.5s / 2.7s, federation 3.4s / 2.9s, wordpress 2.3s / 1.9s.
- Only 1 of delivery's 26 generations was the test's own; the other 25 were the production `loadActorKeyPairs` minting the site actor's key once per test site.
- The `generateKeyPairSync('rsa', { modulusLength: 2048 })` calls in `cli-import.test.ts` and `federation/import-wordpress.test.ts` that the description suspected are **not** a cost worth chasing: six of them together take 114ms. `cli-import.test.ts` is slow for another reason (argon2), which is not this task.
- Ed25519 generation is free by comparison: 157 calls, 25ms in total.

## What changed

`packages/cms/src/federation/__testing__/keys.ts` (new) holds three fixed key pairs — RSA-4096 and Ed25519 each — generated once by the same `generateCryptoKeyPair`/`exportJwk` calls production makes, written down as private JWKs. `testKeyPair(n)` imports one in the shape `generateCryptoKeyPair` answers with; `seedActorKeys(dataDir, username, n)` writes the two files `loadActorKeyPairs` would otherwise mint, through the production `writeActorKeyFile`. Three pairs because a file that proves a stranger cannot sign for a follower needs three identities whose keys are three keys.

Wired in at:
- `admin/__testing__/harness.ts`: every sandbox site is born with the first admin's key files. `site()` and `open()` take a `SandboxSiteOptions` whose `actorKeys` names the users to seed, or `[]` to let the site mint its own.
- `federation/delivery.test.ts`, `inbox.test.ts`, `relays.test.ts`, `wordpress.test.ts`, `federation.test.ts`, `notify.test.ts`, `webmention/send.test.ts`: the local `site()` helper seeds the local user, and the peer/relay/stranger key pairs come from the fixture instead of being minted.

Left generating real keys, as AC #3 asks: all of `federation/keys.test.ts` (17 generations — every test in it is about minting, reading back, racing, damaging or migrating a key file), `federation/import-wordpress.test.ts` (its subject is importing a key pair over a site's own), and the `keeps the actor keys across a restart` test in `federation.test.ts`, which cannot use a seeded key because what it proves is that the key the *first* boot minted is the one the second boot publishes.

## Before and after

Same machine, same commands, measured after TASK-93's split. Per-file numbers are the sum of `<testcase time>` per `file` from `npx tsx --test --test-reporter=junit "src/**/*.test.ts"`, so they are wall time under the default parallelism.

RSA-4096 generations across the whole suite: **155 calls / 38.8s → 19 calls / 4.4s**.

The seven files the description lists:

| file | before | after |
| --- | --- | --- |
| federation/delivery.test.ts | 14.46s | 4.73s |
| federation/inbox.test.ts | 11.37s | 2.00s |
| federation/relays.test.ts | 10.94s | 2.63s |
| admin/federation.test.ts | 7.13s | 2.04s |
| federation/federation.test.ts | 6.34s | 0.89s |
| federation/wordpress.test.ts | 6.26s | 0.94s |
| federation/keys.test.ts | 5.87s | 7.98s |
| **combined** | **62.37s** | **21.21s (−66%)** |

A second after-run gave 22.07s combined, so the cut is stable.

`federation/keys.test.ts` reads as slower only because of how the runner now packs the files: run on its own it takes 3.7-3.9s, the same as before the change, and it is untouched. It is now the one file still minting keys in bulk, and that is deliberate.

Whole suite, same commands before and after:

| measure | before | after |
| --- | --- | --- |
| sum of all testcase times | 156.72s | 117.78s |
| user CPU of a default-parallelism run | 216.4s | 163.4s |
| wall at `--test-concurrency=3` | 41.9s / 45.7s | 37.1s / 36.5s |
| user CPU at `--test-concurrency=3` | 144.2s / 156.7s | 118.6s / 117.5s |

The wall clock at concurrency 3 moves less than the CPU does because this machine has ten cores and RSA generation ran on the thread pool in parallel with everything else. TASK-93 found the suite is bound by total work, and total work is down 25%; on CI's 4-vCPU runners, where three jobs share the cores, that is where the time comes back.

## Verification

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: all clean.
- `pnpm test` on Node 24.18: 1907 pass / 0 fail in `@geekity/cms`, 30 pass / 0 fail in the demo. Same counts as before the change.
- `fnm exec --using=26 -- pnpm test` on Node 26.9.0: 1907 pass / 0 fail, 30 pass / 0 fail.
- The sorted list of `file :: test name` pairs from the junit reports before and after is byte-identical (1905 testcases in the junit report; the runner counts 1907, the difference being two the junit reporter does not emit). No test was renamed, added or removed.
- `git diff --stat` touches only `*.test.ts` files and `__testing__/` helpers. No file under `src` that ships in `dist` changed, and `tsconfig.build.json` keeps `__testing__` out of the package, so the fixture cannot reach an installed site.
- `dist/` after a build holds no `__testing__` directory.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Profiling found the cost was not where the description guessed: 4096-bit RSA key generation, 155 pairs and 38.8s across the suite — a quarter of all its work — almost all of it the production loadActorKeyPairs minting a site actor's key once per test, not the tests' own generateKeyPairSync calls (six of those cost 114ms together). Added packages/cms/src/federation/__testing__/keys.ts: three fixed key pairs, a testKeyPair(n) for a test playing a peer and a seedActorKeys(dataDir, username) that writes the files loadActorKeyPairs would mint. Seeded from the admin sandbox harness and from the site() helper of the federation, notify and webmention tests; left federation/keys.test.ts, federation/import-wordpress.test.ts and the actor-key restart test minting real keys, because generation is their subject. RSA generation is down to 19 calls / 4.4s; the seven federation files in the description fall from 62.4s to 21.2s combined (-66%), the suite's total testcase time from 156.7s to 117.8s and its user CPU from 216s to 163s. Verified with pnpm build/test/typecheck/lint/format:check, 1907 tests passing on both Node 24.18 and Node 26.9, and a byte-identical sorted list of test names before and after.
<!-- SECTION:FINAL_SUMMARY:END -->
