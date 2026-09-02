---
id: TASK-23
title: 'Quality tooling: eslint, prettier, typecheck, husky, lint-staged, commitlint'
status: To Do
assignee: []
created_date: '2026-09-02 13:38'
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
- [ ] #1 pnpm lint, pnpm typecheck, and pnpm test each pass on a clean checkout and fail on an introduced error of their kind
- [ ] #2 A commit with the message "update stuff" is rejected by the commit-msg hook; "feat(cms): add thing" is accepted
- [ ] #3 Committing a file with a lint error is blocked by pre-commit until fixed
- [ ] #4 pnpm install on a fresh clone installs the husky hooks via the prepare script
- [ ] #5 CLAUDE.md documents the Conventional Commits requirement and the allowed scopes
<!-- AC:END -->
