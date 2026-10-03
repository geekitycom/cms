---
id: TASK-248
title: Skip CI on a pull request whose merged tree was already tested
status: In Progress
assignee: []
created_date: '2026-10-03 19:27'
updated_date: '2026-10-03 19:34'
labels:
  - ci
dependencies: []
priority: low
type: chore
ordinal: 263800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-234 skips a push to main when an earlier pull request run tested the same tree, but the lookup in the already-tested job only runs on push. When #110 merged, GitHub's stack feature rebased #111 onto main: new SHAs, a synchronize event, and a full CI run on tree 4466b57, which #111's previous run had already tested and recorded. Run the same lookup on pull_request runs, whose checkout is GitHub's merge into the base, so a rebased stack PR or a title edit skips the expensive jobs. pr-title does not depend on already-tested and still runs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A pull_request run whose merge tree has a tested-tree artifact from this repository skips every job that needs already-tested
- [ ] #2 pr-title still runs on every pull_request event
- [ ] #3 A pull_request run on a new tree runs everything and records its tree as before
- [ ] #4 The coverage job is gone from CI and from record-tested-tree's needs; README and decision-8 say so
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Drop the push-only condition on the already-tested lookup step.
2. Dry-run the lookup against #111's merge commit.
3. Open the PR; after its full run records the tree, edit its title and confirm the edited run skips everything but pr-title.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dry run: #111 merge commit 575470b has tree 4466b57, and the artifact lookup finds 1 tested-tree artifact for it, so the rebased #111 run would have skipped.

Scope added on the owner's call: drop the coverage job. Nothing read its artifact (246 uploads, thresholds at 0), and it was the slowest job (5m vs test's 3m20s on #110). pnpm test:coverage stays for local use.
<!-- SECTION:NOTES:END -->
