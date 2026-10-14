---
id: TASK-407
title: geekity import restores an export and installs its plugins from npm
status: To Do
assignee: []
created_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies:
  - TASK-406
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 363800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The steps of section 5, with `rebuildDatabase` pulled out of `rebuildCommand` and shared by both commands, and folder plugins installed through the code `geekity plugin add` runs.

From decision-55 (accepted), proposed task 5. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An export imported into empty directories boots with the same actor ids and key ids, and a test signs an activity before and after to show it. The users, followers, comment emails and opt-outs are the same. An IndieAuth token issued before the export is still accepted. A moderation link minted before the export still verifies.
- [ ] #2 Each `folder` plugin in the manifest is installed at its recorded version from the registry, and its enabled state matches the manifest, including for an export made `--without-content`. A test uses a local registry.
- [ ] #3 When the registry cannot be reached or a recorded version is gone, the data is still restored and the database rebuilt, every other plugin is installed, each failed plugin is named with its reason and the command to retry, its enabled state is kept, no other version is installed, and the exit code is 1. With everything restored, the exit code is 0.
- [ ] #4 `config` plugins are named and not installed.
- [ ] #5 Import refuses while the site runs, refuses a newer `format`, refuses entries with `..`, absolute paths or links, and refuses a file whose sha256 does not match.
- [ ] #6 Without `--replace`, import refuses non-empty directories. With it, the old directories are renamed and nothing is deleted.
- [ ] #7 A different base URL in effect is refused unless `--new-base-url` is given.
- [ ] #8 A restored site is in the dev mode it was exported in. `--dev-mode` turns dev mode on.
- [ ] #9 A second run after an import killed mid-unpack finishes with the same result.
- [ ] #10 The command prints the overrides to set, the credentials to type in again, the `config` plugins to check, and that everyone signs in again.
<!-- AC:END -->
