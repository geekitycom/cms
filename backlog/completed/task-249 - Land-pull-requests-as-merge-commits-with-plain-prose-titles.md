---
id: TASK-249
title: Land pull requests as merge commits with plain prose titles
status: Done
assignee: []
created_date: '2026-10-03 19:47'
updated_date: '2026-10-03 19:47'
labels:
  - ci
  - docs
dependencies: []
priority: low
type: chore
ordinal: 264800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repository allows only merge commits, but the README, CLAUDE.md, ci.yml and dependabot.yml still described squash merges with Conventional Commit pull request titles. GitHub puts the pull request title in the merge commit body in every allowed format, and release-please reads any Conventional Commit line there, so each pull request appeared in the changelog a second time beside its own commits (0.18.0 and the 0.19.0 release PR show it). Make titles plain prose, drop the pr-title job and the edited trigger it needed, and document merge commits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The pr-title job and the edited pull_request trigger are gone
- [x] #2 README, CLAUDE.md, the run-milestones skill and dependabot.yml describe merge commits with plain prose pull request titles
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pull request titles are plain prose and the pr-title job is gone. GitHub's merge commit puts the title in its body in every allowed format, and release-please parsed a conventional title there as a second changelog entry. Docs now describe merge commits; the branch commits carry the bumps.
<!-- SECTION:FINAL_SUMMARY:END -->
