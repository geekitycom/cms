---
id: TASK-234
title: Skip CI on a push to main when the merged tree was already tested
status: Done
assignee: []
created_date: '2026-10-03 15:01'
updated_date: '2026-10-03 15:31'
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
- [x] #1 A pull_request run whose jobs all pass uploads an artifact named for the tree it tested
- [x] #2 A push to main whose tree has such an artifact, from a run whose head repository is this one, skips every CI job; release-please is unaffected
- [x] #3 A push whose tree has no such artifact, or whose lookup fails, runs every job
- [x] #4 The workflow comments explain the rule
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

PR #106 merged before the fix reached it: on its runs record-tested-tree stayed skipped (already-tested, skipped on every pull_request run, sat in its dependency chain). PR #107: already-tested runs on every event with only its lookup step limited to push. Its run passed every job including record-tested-tree, which uploaded tested-tree-e216ce52a1ee8aae7382920fbcc434fe24c0f899, the exact tree of refs/pull/107/merge. The push-side lookup query by hand finds 1 same-repo artifact for that tree and 0 for an unknown tree. AC #2 and #3 wait on the push run after #107 merges.

Verified on main after #107 merged as ce43a31 (tree ffaee787…, the tree #107's last run recorded): ci run 37133484671 ran only already-tested and skipped all ten gated jobs; release-please ran and succeeded on the same push. The earlier push of #106's merge 9d971b7, whose tree had no artifact, ran every job.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
CI no longer runs twice for a merged PR. A passing pull_request run uploads tested-tree-<tree of the merge ref>; a push to main looks that name up (same-repository runs only) and skips the ten gated jobs when found, and runs them all when not, or when the lookup fails. already-tested runs on every event so no job has a skipped ancestor, which had kept the record job from running in #106. Verified on main: ce43a31 skipped the jobs, 9d971b7 (no artifact) ran them, release-please ran on both.
<!-- SECTION:FINAL_SUMMARY:END -->
