---
id: TASK-369
title: The root package export is a deliberate public API
status: To Do
assignee: []
created_date: '2026-10-12 11:31'
labels: []
milestone: m-36
dependencies: []
references:
  - packages/cms/src/exports.ts
priority: low
type: chore
ordinal: 328800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/exports.ts re-exports about 1,200 symbols from about 20 directories, including internals such as NOTIFY_TIMEOUT_MS, INDEXNOW_ENDPOINT and defaultIndexNowBackoffMs. Every one of them is semver-protected, so internal renames become breaking changes. @geekity/cms/plugin already shows the target shape: a small, versioned surface. Decide what sites, the CLI, plugins and the demo actually need from the root entry and export only that. This is a breaking change and lands as feat! or with a BREAKING CHANGE footer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The root entry exports only symbols used by apps/demo, the published plugins, the CLI, or documented in docs/
- [ ] #2 docs/ lists the root entry public API, or each exported symbol has a doc comment
- [ ] #3 The commit that removes exports is marked breaking so release-please takes a major
- [ ] #4 apps/demo, every packages/plugin-* package and pnpm test pass
<!-- AC:END -->
