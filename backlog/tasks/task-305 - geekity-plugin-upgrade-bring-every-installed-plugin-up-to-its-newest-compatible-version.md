---
id: TASK-305
title: >-
  geekity plugin upgrade: bring every installed plugin up to its newest
  compatible version
status: To Do
assignee: []
created_date: '2026-10-09 01:53'
labels: []
dependencies: []
references:
  - packages/cms/src/plugins/install.ts
  - packages/cms/src/cli.ts
  - README.md
priority: medium
type: feature
ordinal: 265800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On Docker, plugins live in the mounted plugins folder and are updated one at a time with `geekity plugin add <package>`. Andrew asked for one command that goes through every installed plugin and looks for a newer version, like WordPress's plugin updates. It should install only versions this core and the other installed plugins can run, and leave the site to load the change on Reload as plugin add does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `geekity plugin upgrade` checks every plugin in the plugins folder against the registry and installs, for each, the newest version whose manifest this core and the installed plugins satisfy (host API and ranges), using the same verified install as plugin add
- [ ] #2 It reports one line per plugin: upgraded from x to y, already newest, or held back with the reason (for example a newer version needs a newer core), and ends by saying to press Reload when anything changed
- [ ] #3 `geekity plugin upgrade <package>...` limits it to the named plugins; `--check` (or a `geekity plugin outdated` command, pick one and document it) reports what would change and installs nothing
- [ ] #4 A plugin that is not on the registry, or a registry that cannot be reached, is reported and skipped without stopping the others; the exit code is non-zero only when an install that was attempted failed
- [ ] #5 Requirements between plugins are respected: when two plugins must move together (a consumer needs a newer plugin-llm), upgrading both in one run works, and upgrading only one never leaves an installed plugin unsatisfied without saying so
- [ ] #6 Tests run against a local fake registry; the README Docker plugin section and the command table document it
<!-- AC:END -->
