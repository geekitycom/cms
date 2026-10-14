---
id: TASK-406
title: geekity export writes a tar.gz of the kept files with a manifest
status: To Do
assignee: []
created_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies:
  - TASK-405
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 362800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A streaming tar.gz writer on `node:zlib`, the manifest of section 4, and the flags `--out`, `--with-credentials`, `--without-content`, `--list` and `--config`.

From decision-55 (accepted), proposed task 4. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The archive holds `manifest.json` first, every `kept` file, and `content/` without scratch. It holds no `rebuildable`, `pending` or `scratch` file; a test shows `queue.sqlite` is never in it, with or without `--with-credentials`.
- [ ] #2 Credential files are present only with `--with-credentials`. `credentialsLeftOut` names the namespaces that were left out.
- [ ] #3 File modes are kept: a 0600 file in `data/` is 0600 in the archive. The archive itself is written at 0600.
- [ ] #4 The command runs while the site serves and changes no file under `data/` or `content/`.
- [ ] #5 `overrides` lists sources without values. `plugins` lists every installed plugin with name, version, source (`folder` or `config`) and enabled.
- [ ] #6 `pending.deliveries` is the number of messages waiting in `queue.sqlite`, and the command prints it before it writes.
- [ ] #7 `--list` prints each declaration, its class and what is lost.
<!-- AC:END -->
