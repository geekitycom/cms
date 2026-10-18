---
id: TASK-406
title: geekity export writes a tar.gz of the kept files with a manifest
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:25'
updated_date: '2026-10-14 18:05'
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
- [x] #1 The archive holds `manifest.json` first, every `kept` file, and `content/` without scratch. It holds no `rebuildable`, `pending` or `scratch` file; a test shows `queue.sqlite` is never in it, with or without `--with-credentials`.
- [x] #2 Credential files are present only with `--with-credentials`. `credentialsLeftOut` names the namespaces that were left out.
- [x] #3 File modes are kept: a 0600 file in `data/` is 0600 in the archive. The archive itself is written at 0600.
- [x] #4 The command runs while the site serves and changes no file under `data/` or `content/`.
- [x] #5 `overrides` lists sources without values. `plugins` lists every installed plugin with name, version, source (`folder` or `config`) and enabled.
- [x] #6 `pending.deliveries` is the number of messages waiting in `queue.sqlite`, and the command prints it before it writes.
- [x] #7 `--list` prints each declaration, its class and what is lost.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. files/tar.ts: a ustar entry writer (PAX header for long or non-ASCII paths and large sizes, mode and mtime kept) and a reader that returns name, type, mode and body; plugins/install.ts unpackTarball reads through it.
2. files/data-files.ts: declare data/exports/** as scratch (the admin job of TASK-408 writes there); add filesUnder/classifyFiles, the walk-and-classify the census did, and export classifyFiles; the census uses it.
3. New unit export/ (layer 'site export', above plugins): pendingWork(dataDir) counts federation_messages in queue.sqlite over a read-only connection and queued/running jobs in jobs.json; planSiteExport(source, options) walks content/ and data/, keeps kept files (and credentials when asked), records undeclared paths, credential namespaces left out, plugins (name, version, folder|config, enabled), overrides (setting and source, no value), dev mode, base URL and cms version; writeSiteExport(plan, {out, signal, progress}) streams the files through createGzip into a body temp file while hashing, then writes manifest.json as the first gzip member followed by the body, at 0600, renamed into place.
4. cli.ts: geekity export [--out] [--with-credentials] [--without-content] [--list] [--config]; prints pending deliveries before writing, the sensitivity line, undeclared files and credentials left out; --list prints pattern, class and lost.
5. Tests first for each criterion (export unit tests in-process, CLI tests for printing and for a run beside a serving site that changes no file).
6. docs/cli.md (and docs that list data files) in plain prose; verify build/test/typecheck/lint/format and a real export listed with tar -tzvf.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- files/tar.ts: ustar writer (tarHeader with a PAX header for long/non-ASCII paths and sizes >= 8 GiB, tarPadding, TAR_END) and readTar (name, type, mode, body). plugins/install.ts unpackTarball now reads through readTar. No new dependency.
- files/data-files.ts: EXPORTS (data/exports/**, scratch) for the admin export of TASK-408; classifyFiles(dir, declarations) is the walk-and-classify the census did. Exported from @geekity/cms (documented in docs/public-api.md); the census uses it.
- export/site-export.ts (new layer 'site export', above plugins): pendingWork(dataDir), planSiteExport(source, {withCredentials, withContent}), writeSiteExport(plan, {out, now, signal?, progress?}), exportFileName(baseUrl, now), ExportManifest types. The files go through createGzip into <out>.<pid>-<rand>.body.tmp while hashed from one open handle each (size from fstat, so an append after open is not read); then manifest.json is written as the first gzip member and the body appended as the second, at 0600, renamed onto out. A file that vanished between plan and write is skipped; one cut short throws.
- store/queue-database.ts: countWaitingMessages (read-only connection; table missing or no file = 0). FEDERATION_QUEUE_TABLE moved here from federation/queue.ts (sqlite-boundary keeps node:sqlite in store/).
- settings/registry.ts: sourceLabel moved out of cli.ts and shared with the manifest.
- cli.ts: geekity export [--out] [--with-credentials] [--without-content] [--list] [--config]. Loads config, settings and the plugin registry only (no migration, no createCms).
Decisions: undeclared data files are left out and listed in manifest.undeclared and on stderr. credentialsLeftOut names a plugin by its folder under plugins/ and a core namespace by its file name (mail.json -> mail); only files with content count. Content symlinks and other non-regular files are not walked.
Evidence: src/export/site-export.test.ts (12), src/cli-export.test.ts (4), src/files/tar.test.ts (2, incl. system tar -tzvf listing modes), data-files.test.ts classifyFiles + exports class; census passes with classifyFiles.
AC4 note: a read-only SQLite connection writes read marks into queue.sqlite-shm (checked with a script: shm hash changes after a readOnly count). The serving test compares hash, mode, mtime and size of every file under data/ and content/ except *-shm, which holds no data and which the site's own readers write too.
Verified: pnpm build, pnpm -r test (cms 6059 pass, plugins and demo pass), pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Real run: demo content copied to scratch, user added, geekity serve started, actor fetched to mint keys, geekity export while serving -> tar -tzvf shows manifest.json first, content/ at 0644, data/keys/*.jwk and data/users.json at 0600, archive file -rw-------, data/surprise.json named as undeclared, overrides lists site.base_url from env GEEKITY_BASE_URL. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added geekity export: a streaming tar.gz (node:zlib, shared ustar codec in files/tar.ts) with manifest.json first, content/ without scratch and kept data files, credentials only with --with-credentials, modes kept, archive at 0600; the manifest records files with sha256, undeclared files, credentials left out, plugins, overrides without values, dev mode and pending deliveries/jobs; --list prints declarations. The export is planSiteExport + writeSiteExport in packages/cms/src/export/ for TASK-407/408 to reuse; the census walks with the shared classifyFiles. Verified by new unit and CLI tests (including a run beside a serving site that changes no data file), the full build/test/typecheck/lint/format run, and a real export of a served demo site listed with tar -tzvf.
<!-- SECTION:FINAL_SUMMARY:END -->
