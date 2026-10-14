---
id: TASK-407
title: geekity import restores an export and installs its plugins from npm
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:25'
updated_date: '2026-10-14 18:31'
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
- [x] #1 An export imported into empty directories boots with the same actor ids and key ids, and a test signs an activity before and after to show it. The users, followers, comment emails and opt-outs are the same. An IndieAuth token issued before the export is still accepted. A moderation link minted before the export still verifies.
- [x] #2 Each `folder` plugin in the manifest is installed at its recorded version from the registry, and its enabled state matches the manifest, including for an export made `--without-content`. A test uses a local registry.
- [x] #3 When the registry cannot be reached or a recorded version is gone, the data is still restored and the database rebuilt, every other plugin is installed, each failed plugin is named with its reason and the command to retry, its enabled state is kept, no other version is installed, and the exit code is 1. With everything restored, the exit code is 0.
- [x] #4 `config` plugins are named and not installed.
- [x] #5 Import refuses while the site runs, refuses a newer `format`, refuses entries with `..`, absolute paths or links, and refuses a file whose sha256 does not match.
- [x] #6 Without `--replace`, import refuses non-empty directories. With it, the old directories are renamed and nothing is deleted.
- [x] #7 A different base URL in effect is refused unless `--new-base-url` is given.
- [x] #8 A restored site is in the dev mode it was exported in. `--dev-mode` turns dev mode on.
- [x] #9 A second run after an import killed mid-unpack finishes with the same result.
- [x] #10 The command prints the overrides to set, the credentials to type in again, the `config` plugins to check, and that everyone signs in again.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. files/tar.ts: add readTarStream(gzipped bytes as AsyncIterable) that yields entries with a streamed body; check it reads the export's two gzip members. Keep readTar for plugin tarballs.
2. export/site-import.ts: parseManifest (refuse a newer format, check shape); stageSiteImport streams the archive into <dir>.importing beside content/ and data/, refusing manifest-not-first, non-file entries, absolute paths, '..', names outside content/ and data/, unlisted or repeated entries, and any size or sha256 mismatch; restores mode and mtime; writes a scratch marker (.geekity-import, the manifest's hash) into each staging dir.
3. Declarations at unpack time: core + settings registry + each archived plugins/<name>/ folder read as a folder whose plugin is not loaded (kept, secrets credential), because a plugin's own declarations exist only once it is installed, which is after the data is in place; the export already classed those files with the same plugin version. A data entry whose class here is not kept or credential, or that nothing declares, is skipped and named.
4. Targets: refuse content/ or data/ holding a non-scratch file unless --replace (rename to <dir>.before-import-<stamp>); a target holding this archive's marker is an unfinished import and is replaced. Base URL in effect (env/config, else the staged site.json) compared with manifest.baseUrl before anything is replaced; refuse unless --new-base-url.
5. cli.ts: geekity import <file> [--replace] [--dev-mode] [--new-base-url] [--config]. Refuse while databaseInUse or isServing. Place staging, set dev_mode.on with --dev-mode, install folder plugins at their recorded versions with addPlugin (what geekity plugin add runs), restore enabled state (setPluginEnabled when the export had no content), name config plugins. rebuildDatabase(config) pulled out of rebuildCommand and shared. Remove markers last. Print overrides, credentials, config plugins, sign-in note, failed plugins with reason and retry command; exit 1 when any plugin failed.
6. Tests first for each AC (module tests + CLI tests with the fake npm registry); docs/cli.md import section; full round trip by hand with a local stub registry.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- files/tar.ts readTarStream: gunzip stream to tar entries with streamed bodies; reads the export's two concatenated gzip members (tested with 777-byte chunks). readTar stays for plugin tarballs.
- export/site-import.ts: parseManifest (refuses a newer format), readSiteManifest (first entry only), checkImportTargets, stageSiteImport (into <dir>.importing, verifying every entry: regular file, under content/ or data/, no absolute path or '..', listed once in the manifest, size and sha256 match; mode and mtime restored; folders under data/ made 0700 since the archive carries no folder entries and data/keys wants 0700), placeSiteImport, finishSiteImport, installArchivedPlugins (addPlugin, the code geekity plugin add runs, at name@version only), restoreEnabledPlugins, importNotes.
- Declaration order: at unpack time the plugins are not installed, so each archived data/plugins/<name>/ folder is classed as the folder of a plugin that is not loaded (unloadedPluginFolder: secrets.json credential, the rest kept). The export already classed those files with the same plugin version's declarations, and the plugins are installed after the data is in place.
- Unfinished imports: each staging folder holds data/.geekity-import or content/.geekity-import (declared scratch, IMPORT_MARKER) with the manifest's sha256 until the import ends. A target holding this archive's marker is an unfinished import and is replaced without --replace; leftover staging folders are removed at the start.
- cli.ts: geekity import <file> [--replace] [--dev-mode] [--new-base-url]; rebuildDatabase(config) pulled out of rebuildCommand and shared. Base URL in effect = env/config, else the staged site.json url (settleConfig over the staging content folder), checked before anything is replaced.
- 'import' is now a core command, and @geekity/plugin-wordpress adds 'import wordpress' and 'import wordpress-actor'. COMMANDS.import is marked sharedWithPlugins: when a plugin command's words match, the plugin command runs. A site without the plugin now refuses 'geekity import wordpress-actor ada' with 'no plugin on this site adds ...' (plugin-wordpress command.test.ts assertion updated).
- A plugin whose core peer range excludes this core is installed by addPlugin but reported as a failure (exit 1) with the reason.

Verification: pnpm build, pnpm test (cms 6083 pass, plugins and demo pass), typecheck, lint, format:check all pass. Manual round trip: demo content + user ada + a comment posted through the form + @acme/plugin-hello 1.0.0 enabled from a stub registry on loopback; export while serving, stop, import into an empty dir (exit 0, plugin installed, enabled kept), serve on the same base URL: /moving-day/ 200, actor id, publicKey id, publicKeyPem and multikeys identical; users.json and data/comments identical. Servers and registry stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity import restores a site from a geekity export archive: it refuses while the site runs, refuses a newer format and any link, folder, device, absolute, '..', unlisted or hash-mismatched entry, stages into <dir>.importing beside content/ and data/, refuses occupied folders unless --replace (renamed to <dir>.before-import-<stamp>), refuses a different base URL unless --new-base-url, places the folders, sets dev mode with --dev-mode, installs each folder plugin at its recorded version through addPlugin and restores enabled states, names config plugins, runs the rebuild geekity rebuild runs (rebuildDatabase, now shared), and prints overrides, credentials, config plugins and the sign-in note. Plugin failures are named with the reason and a retry command and give exit 1 with everything else restored. A streaming tar reader was added. Verified by src/cli-import.test.ts (round trip signing with the same key, token and moderation link, fake registry), src/export/site-import.test.ts (refusals, replace, killed-run states), src/files/tar.test.ts, the full suite, and a manual export/import/serve round trip.
<!-- SECTION:FINAL_SUMMARY:END -->
