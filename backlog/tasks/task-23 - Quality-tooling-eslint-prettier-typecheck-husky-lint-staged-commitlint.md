---
id: TASK-23
title: 'Quality tooling: eslint, prettier, typecheck, husky, lint-staged, commitlint'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:38'
updated_date: '2026-09-02 21:36'
labels:
  - infra
milestone: m-0
dependencies:
  - TASK-1
references:
  - >-
    backlog/decisions/decision-8 -
    Quality-gates-eslint-tsc-typecheck-and-node-test-in-CI-and-on-commit.md
  - >-
    backlog/decisions/decision-7 -
    release-please-with-Conventional-Commits-enforced-by-husky-and-commitlint.md
type: chore
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up the quality gates from decision-8 and the commit convention from decision-7. eslint flat config with typescript-eslint type-checked rules and eslint-config-prettier, prettier, root scripts lint, format, typecheck, test with coverage. husky hooks: commit-msg runs commitlint with @commitlint/config-conventional, pre-commit runs lint-staged (eslint and prettier on staged files), pre-push runs typecheck and test. Add a short commit-message section to CLAUDE.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pnpm lint, pnpm typecheck, and pnpm test each pass on a clean checkout and fail on an introduced error of their kind
- [x] #2 A commit with the message "update stuff" is rejected by the commit-msg hook; "feat(cms): add thing" is accepted
- [x] #3 Committing a file with a lint error is blocked by pre-commit until fixed
- [x] #4 pnpm install on a fresh clone installs the husky hooks via the prepare script
- [x] #5 CLAUDE.md documents the Conventional Commits requirement and the allowed scopes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add dev tooling at the root: eslint 9 + @eslint/js + typescript-eslint (type-checked, projectService) + eslint-config-prettier, prettier, husky 9, lint-staged, @commitlint/cli + config-conventional.
2. Work around TypeScript 7 dropping the JS compiler API: the root keeps typescript 6 for typescript-eslint only, while each package keeps typescript 7 for build/typecheck. Document the split.
3. Write eslint.config.js (flat): ignores, JS config files untyped, TS type-checked with projectService + tsconfigRootDir, test-file relaxations, eslint-config-prettier last. Cover packages/cms/test/** and docs/eleventy.config.example.js.
4. Write .prettierrc.json and .prettierignore (backlog/, fixtures in canonical writer form, dist, data, lockfile).
5. Root scripts: lint, lint:fix, format, format:check, typecheck, test, test:coverage. Per-package lint/lint:fix scripts.
6. husky 9: root prepare runs husky then build; hooks commit-msg (commitlint), pre-commit (lint-staged), pre-push (typecheck + test).
7. commitlint.config.js: config-conventional plus scope-enum cms, demo, deps, ci, docs, release with empty scope allowed.
8. Run pnpm lint and pnpm format over the tree; fix real findings in code rather than disabling rules.
9. Reduce the sync.test.ts watcher flake with a bounded deadline change inside the test file.
10. Add a Commit messages section to CLAUDE.md outside the Backlog.md block, and refresh the README command table.
11. Verify: red/green for lint, typecheck and test gates in this repo; hooks proven in a throwaway rsync copy with its own git repo (no commits here).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was added

- `eslint.config.js` — one flat config for the workspace: ignores, plain-JS block, TypeScript block on `typescript-eslint`'s `recommendedTypeChecked` with `projectService: true` and `tsconfigRootDir`, a test-file block, and `eslint-config-prettier` last. Covers `packages/cms/test/**` and `packages/cms/docs/eleventy.config.example.js` (44 files linted).
- `.prettierrc.json` (printWidth 100, single quotes — the width that reformatted the existing sources least) and `.prettierignore` (`backlog/`, `packages/cms/test/fixtures/`, `apps/demo/content/`, lockfile, build output).
- `commitlint.config.js` — `@commitlint/config-conventional` plus `scope-enum` of cms, demo, deps, ci, docs, release. An empty scope stays legal.
- `lint-staged.config.js` — eslint --fix and prettier on staged ts/js, prettier on staged json/md/yml/yaml/css.
- `.husky/commit-msg` (commitlint), `.husky/pre-commit` (lint-staged), `.husky/pre-push` (`pnpm typecheck` then `pnpm test`); root `prepare` is now `husky && pnpm build`.
- Root scripts `lint`, `lint:fix`, `format`, `format:check`, `test:coverage`; per-package `lint` and `lint:fix` in `packages/cms` and `apps/demo`.
- `CLAUDE.md` gained a Commit messages section outside the Backlog.md block; `README.md` gained a Quality gates section and a fuller command table.

## Two decisions worth recording

**TypeScript 6 at the root, TypeScript 7 in the packages.** TypeScript 7 is the native compiler and no longer exports the JavaScript compiler API, so typescript-eslint refuses to load against it outright ("typescript-eslint does not support TS 7.0"). The root therefore carries `typescript@^6.0.3` as a lint-only dependency while each package keeps `^7.0.2` for `build` and `typecheck`; pnpm's isolated node_modules keeps them apart. This is the side-by-side arrangement TypeScript 7 documents, and it is commented in `eslint.config.js` and the README.

**`no-unnecessary-type-assertion` is off.** It was the only real finding besides the node:test false positives, and every one of its eight reports was wrong for this codebase: applying `--fix` made `pnpm typecheck` fail (`sync.test.ts` needs its `as ContentStore`), because the linter judges redundancy with TypeScript 6 while the code compiles with TypeScript 7. The rule is off with a comment saying to turn it back on when the two run the same TypeScript.

`no-floating-promises` stays on, with `allowForKnownSafeCalls` for node:test's `describe`/`it`/`before`/`after` — otherwise every one of the 294 test declarations was an error.

## The sync watcher flake

Reproduced it, and a longer deadline was not the fix: with a 20 s deadline "indexes a file created after it started" still timed out. The cause is that the test creates `posts/` after the watcher is live, macOS drops the directory-creation event now and then, and chokidar cannot watch a directory it was never told about — so the helper's repeated re-writes of the file inside it are invisible forever. Fixed inside the test file: the `sync()` helper now creates `pages`, `posts`, `_trash/pages` and `_trash/posts` before starting a watcher, so only the *file* appears under the live watch. The `eventually` deadline went 4 s -> 10 s as cheap insurance under load. 10 sequential runs and 4 concurrent runs of the suite all passed; before the change the flake reproduced within 3 sequential runs.

## Verification

In the repository (no commits made here):

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:11ty`, `pnpm build`, `pnpm format:check`, `pnpm test:coverage` — all exit 0.
- Red/green, one gate at a time, each reverted to a matching checksum: an unused local in `src/env.ts` made `pnpm lint` exit 1 (`no-unused-vars`); `const gateProbe: number = "not a number"` made `pnpm typecheck` exit 2 (`TS2322`); an `assert.equal(1, 2)` appended to `slug.test.ts` made `pnpm test` exit 1. All three back to 0 after reverting.
- `git status` afterwards shows no change to `packages/cms/test/fixtures/` or `backlog/` beyond this task file. `prettier --file-info` reports `"ignored": true` for a Backlog task, a fixture Markdown file, a fixture `pages.json` and a demo `posts.json`.

Hooks, proven in a throwaway `rsync` copy under the scratchpad with its own `git init` (deleted afterwards):

- `pnpm install` there took `core.hooksPath` from unset to `.husky/_` and created the runtime directory — the `prepare` script installs the hooks on a fresh clone.
- `git commit -m "update stuff"` -> rejected, `subject may not be empty [subject-empty]`, `type may not be empty [type-empty]`, `husky - commit-msg script failed (code 1)`, 0 commits.
- `git commit -m "feat(cms): add thing"` -> committed.
- `git commit -m "chore: allow an empty scope"` -> committed, so an empty scope is legal.
- `git commit -m "feat(admin): ..."` -> rejected, `scope must be one of [cms, demo, deps, ci, docs, release]`.
- A new file with an unused local, staged and committed with a valid message -> `pre-commit` blocked it (`husky - pre-commit script failed`); the same file with the local removed committed cleanly.
- `git push` to a local bare remote ran `pnpm typecheck` and `pnpm test` and succeeded; after committing a deliberately failing test the next push was blocked by `pre-push` and the remote head did not move.
- The initial commit staged 78 json/md/yaml/css files, including every Backlog task and every content fixture, and `diff -r` against this repository afterwards reported the `backlog/`, `packages/cms/test/fixtures/` and `apps/demo/content/` trees byte-identical.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the quality gates of decision-8 and the commit convention of decision-7: an eslint 9 flat config using typescript-eslint's type-checked rules through the project service with eslint-config-prettier last, prettier with a `.prettierignore` that keeps Backlog files and the content fixtures untouched, root `lint`/`lint:fix`/`format`/`format:check`/`typecheck`/`test`/`test:coverage` scripts over per-package `lint` scripts, and husky 9 hooks installed by the root `prepare` — commitlint on `commit-msg`, lint-staged on `pre-commit`, typecheck and tests on `pre-push`. CLAUDE.md now documents Conventional Commits and the allowed scopes (cms, demo, deps, ci, docs, release, plus an empty scope).

Two things had to bend. typescript-eslint refuses to load against TypeScript 7, which no longer ships the JavaScript compiler API, so the root carries TypeScript 6 as a lint-only dependency while the packages build and type check with 7. And `no-unnecessary-type-assertion` is off with a comment, because applying its fixes broke `pnpm typecheck` — it judges the code with a different TypeScript than the one that compiles it.

The watcher flake in `sync.test.ts` was fixed rather than waited out: the test created `posts/` under a live watch, macOS drops that event, and chokidar then never watches the directory, so no deadline would have helped. The test helper now creates the content directories before the watcher starts.

Verified with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:11ty`, `pnpm build`, `pnpm format:check` and `pnpm test:coverage` all green; with an introduced lint error, type error and failing test each proving its gate red and then reverted; with 10 sequential and 4 concurrent runs of the suite; and with every hook exercised in a throwaway clone under the scratchpad, which was deleted afterwards. No commits were made in this repository.
<!-- SECTION:FINAL_SUMMARY:END -->
