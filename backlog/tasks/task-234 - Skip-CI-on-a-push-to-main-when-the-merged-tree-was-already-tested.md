---
id: TASK-234
title: Skip CI on a push to main when the merged tree was already tested
status: In Progress
assignee: []
created_date: '2026-10-03 15:01'
updated_date: '2026-10-03 15:03'
labels:
  - ci
dependencies: []
priority: low
type: chore
ordinal: 249800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every PR runs CI, then the same jobs run again on the push to main when it merges. A PR run tests GitHub's merge of the PR into main as main stood then, so when main has not moved since, the merge commit's tree is byte-for-byte the tree already tested. Record the tree a passing PR run tested as an artifact named tested-tree-<tree>, and on a push to main skip the jobs when such an artifact exists from a run in this repository. A missing artifact, a failed lookup or a different tree runs everything as today. [skip ci] is not an option: it skips release-please too.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A pull_request run whose jobs all pass uploads an artifact named for the tree it tested
- [ ] #2 A push to main whose tree has such an artifact, from a run whose head repository is this one, skips every CI job; release-please is unaffected
- [ ] #3 A push whose tree has no such artifact, or whose lookup fails, runs every job
- [ ] #4 The workflow comments explain the rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. already-tested job (push only): look up artifact tested-tree-<tree of the pushed commit> from a run of this repository; output skip=true when found; continue-on-error so a failed lookup runs everything.
2. Gate the ten CI jobs on !cancelled() && skip != 'true'.
3. record-tested-tree job (pull_request only): after all ten pass, upload tested-tree-<tree of the checked-out merge ref>.
4. Verify: actionlint; jq filter against real artifacts; merge-tree of each recent merge commit's parents equals its tree; after the PR run, the artifact exists under the merge ref's tree; after merge, the push run skips.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Premise checked: for the last six merge commits on main, git merge-tree --write-tree of the two parents gives exactly the merge commit's tree, so a push whose main had not moved since the PR run carries the tree that run tested. The artifacts API returns workflow_run.head_repository_id and repository_id (checked against coverage-summary artifacts), and the commits API's tree sha matches git rev-parse. actionlint and prettier pass.
<!-- SECTION:NOTES:END -->
