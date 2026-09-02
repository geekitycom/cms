---
id: decision-8
title: 'Quality gates: eslint, tsc typecheck, and node:test in CI and on commit'
date: '2026-09-02 13:37'
status: accepted
---
## Context

The CMS is a published library that other sites depend on, so regressions ship to every site on upgrade. Quality checks must be automatic and cheap enough to run on every change.

## Decision

Three checks, run the same way everywhere:

- `pnpm lint`: eslint with `typescript-eslint` recommended type-checked rules, plus `eslint-config-prettier` and prettier for formatting.
- `pnpm typecheck`: `tsc --noEmit` on every workspace package with `strict` on.
- `pnpm test`: `node:test` through `tsx`, with coverage reported via `--experimental-test-coverage`.

Where they run:

- Locally on commit via husky and lint-staged (lint and format on staged files only; typecheck and tests on `pre-push`).
- In GitHub Actions on every push and pull request, as required status checks before merge.
- The Eleventy compatibility test and the federation smoke test are separate jobs so the fast suite stays fast.

## Consequences

- Type-checked lint rules need a tsconfig per package that eslint can find; the workspace uses `tsconfig.base.json` extended by each package.
- Tests live beside the code as `*.test.ts` and are excluded from the published build.
- Pre-push hooks are skippable with `--no-verify` for emergencies, but CI is not.
