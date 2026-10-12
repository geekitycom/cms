---
id: TASK-372
title: A @geekity/cms/testing entry for the host internals plugin tests use
status: To Do
assignee: []
created_date: '2026-10-12 16:29'
labels: []
milestone: m-37
dependencies: []
priority: low
type: feature
ordinal: 331800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-369 the root entry of @geekity/cms exports only its documented API, but eight host internals stay in it only because packages/plugin-wordpress tests import them: openAdminStore, intakeComment, addComment, updateComment, deleteComment, pluginSite, pluginDataFolder and documentContent (see docs/public-api.md). Give plugin authors a separate @geekity/cms/testing entry point for building a host in tests, and take those names out of the root entry. The root entry is semver-protected, so removing them is a breaking change; @geekity/cms/testing can be documented as test-only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/cms/package.json exports a ./testing entry, and the eight names are importable from @geekity/cms/testing
- [ ] #2 The eight names are no longer exported from the root entry, and docs/public-api.md and src/public-api.test.ts agree
- [ ] #3 Every packages/plugin-* test imports host helpers from @geekity/cms/testing or @geekity/cms/plugin, never from the root, and a check fails if a plugin test imports a name the root does not document
- [ ] #4 docs/plugins.md describes the testing entry and that it is for tests only
- [ ] #5 The removal from the root entry lands as a breaking commit; plugin, demo and core test suites pass
<!-- AC:END -->
