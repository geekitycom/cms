---
id: TASK-405
title: A census test fails on any file a site writes that has no declaration
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:25'
updated_date: '2026-10-14 17:45'
labels: []
milestone: m-38
dependencies:
  - TASK-403
  - TASK-404
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 361800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Boot one site with the four published plugins, drive every writer in the Context table, and walk `data/` and `content/`.

From decision-55 (accepted), proposed task 3. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The test fails on an undeclared file and names it. This is shown by a writer added on purpose and then removed.
- [x] #2 The fixture reaches every row of the table, `queue.sqlite` included.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core: add Cms.dataFiles(), which returns siteDataFiles({dataDir, settings, plugins}) for the booted site, and export dataFileFor, DataClass and DataFileDeclaration from @geekity/cms. Unit test in plugins/data.test.ts.
2. Census test in packages/plugin-wordpress/test/data-census.test.ts. Core tests may not name the platform or import the plugins (plugin-boundary.test.ts, no devDependency), and the WordPress content import is not a package export, so the test lives in the plugin package that has the most data files and takes the other three plugins as devDependencies. The LLM and tags.pub fakes come from the sibling test folders, as plugin-tag-suggest already does.
3. Boot one site with all four plugins enabled. Drive each writer in decision-55's table through routes or public calls: the actor GET (key minting), the setup form (users.json), a comment with notify, then moderation approval and a reply approval (notification-secret, comment-salt through trustProxy, comments/, the unsubscribe confirm for comment-optouts.json), the contact form, the IndieAuth consent and token exchange (indieauth-tokens.json, indieauth-activity.json), Micropub with a location and an unknown property, a Micropub media upload, an image variant request (images/), the avatar route with a stubbed fetch (avatars/), the strip-metadata form (jobs.json), removing a folder plugin (plugin-changes.json), the notification mode set to hourly and a digest run (notification-digests.json), settings writes for mail, akismet, maintenance, dev mode and plugin settings and secrets, suggest-tags (LLM last-call.json, tag-suggest followers.json), the WordPress actor import, a request to its old actor path (actors.json, requests.json), and the WordPress content import (import.json). queue.sqlite opens with the default queue.
4. Walk data/ while the site is open. Fail on any file with no declaration, and name the file and the fix. Also fail on any declaration no file matched (the opposite drift). Exempt scratch, which is transient and which data-files.test.ts pins to its code, and a plugin's secrets.json when the plugin has no secret setting.
5. Prove AC#1: add a writer for an undeclared file on purpose, show the failure, then remove it. Time the test.
6. Verify with pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- Cms.dataFiles() returns siteDataFiles() for the booted site. dataFileFor, DataClass and DataFileDeclaration are exported from @geekity/cms and listed in docs/public-api.md under Data files. Unit test: plugins/data.test.ts 'Cms.dataFiles'.
- packages/plugin-wordpress/test/data-census.test.ts boots one site with llm, post-summary, tag-suggest and wordpress enabled and drives every writer in decision-55's table through routes or public calls. Then it walks data/ while the site is open and makes two checks. Every file has a declaration; a failure names data/<file> and the fix. Every declaration is reached by some file; a failure names the pattern and says to drive its writer or remove the declaration. Scratch is exempt from the second check because it is transient, and data-files.test.ts pins those patterns. A plugin's secrets.json is exempt when the plugin has no secret setting (tag-suggest).
- The census lives in plugin-wordpress because core tests may not name the platform (plugin-boundary.test.ts), and the content import is not a package export. plugin-wordpress gains devDependencies on the other three plugins. The LLM and tags.pub fakes are imported from the sibling test folders, as plugin-tag-suggest already does.
- content/ is not walked for failures. decision-55 classes everything there as kept apart from scratch, so it cannot hold an undeclared file.
- queue.sqlite: a follower is added and a Micropub post queues its Create. The site does not serve, so nothing sends it. The test reads federation_messages read-only and asserts that a row waits, and queue.sqlite-wal is covered.

Proof for AC#1: site/users.ts write() was changed on purpose to also write users.json.bak through updateFileAtomically with a ready-made path. The census failed with 'data/users.json.bak has no declaration. Declare it in packages/cms/src/files/data-files.ts with its class and build its path with dataPath, or, for a plugin's file, add it to the plugin's `data` field.' data-files-boundary.test.ts still passed (2/2) on the same change, so this is a miss only the census catches. The change was reverted.
Opposite drift: a 'never.json' declaration was added to CORE_DATA_FILES on purpose. The census failed with 'never.json (kept) is declared, and no writer this census drives made a file it covers.' The declaration was reverted.

No undeclared file was found on the real site. The census test takes about 0.5-1.0 s; the whole plugin-wordpress suite takes 10.5 s.
The rebuild pin (every file discardDatabase removes is rebuildable) was already in data-files.test.ts from TASK-403.

Validation: pnpm build, pnpm test (cms 6039 pass, demo 32, llm 49, post-summary 23, tag-suggest 32, wordpress 108, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Cms.dataFiles() and exported dataFileFor, DataClass and DataFileDeclaration. Added a census test in packages/plugin-wordpress/test/data-census.test.ts. It boots one site with the four published plugins and drives every writer in decision-55's table, queue.sqlite with a waiting delivery included. Then it fails on any file under data/ with no declaration, and on any declaration no writer reached. Both failures name the file or pattern and the fix. A deliberate users.json.bak writer and a deliberate unwritten declaration each made it fail, and both were reverted. The test runs in about 1 s. Verified with pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
