---
id: TASK-357
title: Resolved config never changes after resolution
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-34
dependencies:
  - TASK-356
type: chore
ordinal: 316800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
resolveConfig returns an object that createCms then mutates (resolved.baseUrl = effectiveBaseUrl(...), resolved.commentChecker ??= ...), so what a service sees depends on build order. createCms re-resolves config the CLI already resolved. config.ts repeats the env, config, default pattern about 25 times with near-copy resolvers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The resolved config is frozen; boot-time values come from an explicit step that returns a new config before any service is built
- [ ] #2 createCms accepts an already resolved config without resolving it again
- [ ] #3 Env-backed settings are declared in one table holding env name, kind and default, and one resolver per kind produces values and error messages
- [ ] #4 Every existing env var and error message keeps its behaviour, shown by tests
<!-- AC:END -->
