---
id: TASK-412
title: geekity import works when content/ and data/ are mount points
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 18:35'
updated_date: '2026-10-14 18:49'
labels: []
milestone: m-38
dependencies:
  - TASK-407
references:
  - packages/cms/src/export/site-import.ts
  - Dockerfile
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: high
type: bug
ordinal: 367800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity import (packages/cms/src/export/site-import.ts, TASK-407) stages into <dir>.importing beside each target and places it with rename, and --replace renames the old folder to <dir>.before-import-<stamp>. The Docker image (Dockerfile) mounts /site/content and /site/data as volumes, so on every Docker site the target is a mount point: renaming it fails (EBUSY), and the staging folder beside it may sit on another filesystem (EXDEV). Import must work there: stage inside the target (or on the same filesystem) and swap its contents rather than the folder itself, keeping the guarantees TASK-407 has today: nothing is replaced until the archive is verified, an occupied target needs --replace and keeps the old contents recoverable, and a stopped import can be run again to the same end state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An import into a content/ and data/ that cannot be renamed (mount points) restores the site; a test proves it by making rename of the target fail as a mount point does
- [x] #2 With --replace on a mount point, the old contents are kept recoverable and the docs say where
- [x] #3 Nothing in a target changes until every archive entry is verified, and a killed import re-run ends as a clean import does; tests prove both for the mount-point path
- [x] #4 The Docker image runs geekity import against its mounted volumes: a real docker run proves it
- [x] #5 docs/cli.md describes importing on Docker
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Stage inside each target: unpack into <dir>/.geekity-importing/ (new scratch declaration IMPORT_STAGING), so staging is always on the target's filesystem and nothing beside the target is created, renamed or removed.
2. Place by moving entries, never the folder: with an occupied target (or an aside this archive left half done), move every entry that is not import-owned into <dir>/.geekity-before-import-<stamp>/ (new scratch declaration IMPORT_ASIDE), which holds the archive's marker while it fills; then drop that marker, write <dir>/.geekity-import, delete what an empty or unfinished target held, and rename each staged entry into <dir>. One code path whether or not <dir> is a mount point.
3. Refuse archive entries whose names are import-owned (.geekity-import, .geekity-importing, .geekity-before-import-*), so an archive cannot overwrite the marker or an aside.
4. Declare both folders scratch in CORE_DATA_FILES and CONTENT_SCRATCH_FILES so export, census and target state ignore them; content scan already skips dot folders.
5. Tests first: mount point simulated by making the target's parent read-only (rename/remove of the target and siblings fail); refusal leaves every target file untouched; a kill injected before every move, re-run, ends as a clean import; --replace keeps old contents inside the target. Update cli-import test for the new aside location.
6. docs/cli.md: new layout, recovery, Docker import.
7. Real docker build + run with named volumes: export from one container, import into another (and --replace), serve; remove containers, volumes and image.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: one code path. Staging is <dir>/.geekity-importing/ and old contents go to <dir>/.geekity-before-import-<stamp>/, both declared scratch (IMPORT_STAGING, IMPORT_ASIDE in files/data-files.ts, in CORE_DATA_FILES and CONTENT_SCRATCH_FILES), so every rename stays inside the target and nothing beside it is made, renamed or removed. Placement moves entries, never the folder: an aside folder holds the archive's marker while it fills, so a killed run's re-run finds it and moves the rest into the same folder; its marker is removed before the target's .geekity-import marker is written, so the two never coexist. Archive entries named .geekity-import, .geekity-importing or .geekity-before-import-* are refused. Staging removes a target folder it had to create when the import is refused (discardStagedImport), so a refused import into missing folders leaves nothing.
Tests: site-import.test.ts 'site import into mount points' makes the targets' parent read-only (rename/remove of the target or a sibling fails EACCES); the kill test injects a rename that fails after k moves for every k and checks the re-run ends equal to a clean run with exactly one aside per target (shown to fail when the in-progress aside is not reused). Old layout tests failed first with EACCES mkdir '<dir>.importing'.
Docker: built the image from HEAD and from the change. HEAD image on named volumes: 'EBUSY: resource busy or locked, rmdir /site/content', exit 1. Fixed image: export from container A, import into container B's fresh named volumes exit 0, again without --replace refused, with --replace moved contents into /site/{content,data}/.geekity-before-import-*; B served 200 with the post, users.json byte-identical, B's export excluded the aside folders. Also ran deploy/compose.yaml with bind mounts using the documented 'docker compose run --rm -v ./archive:/tmp/site.tar.gz:ro geekity geekity import ... --replace' flow: exit 0, site healthy. Containers, volumes, images and worktree removed.
Checks: pnpm build, test (cms 6088 pass, plugin-wordpress census 108 pass), typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity import now stages inside content/ and data/ (.geekity-importing/) and moves entries into place instead of renaming the folders, so it works when they are mount points (Docker). --replace keeps the old contents in <dir>/.geekity-before-import-<stamp>/ inside each folder; a killed run's re-run reuses the half-filled aside folder. Both folders are declared scratch, so export and the census skip them. Verified by mount-point tests (read-only parent, kill injected at every rename, refusal leaves targets unchanged), the full suite, and a real docker build/run: old image fails EBUSY, new image imports an export from one container into another's named volumes and into a compose stack with bind mounts. docs/cli.md updated (layout, getting the old site back, importing on Docker).
<!-- SECTION:FINAL_SUMMARY:END -->
