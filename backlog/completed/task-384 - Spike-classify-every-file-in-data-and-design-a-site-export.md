---
id: TASK-384
title: 'Spike: classify every file in data/ and design a site export'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 12:10'
updated_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies:
  - TASK-383
references:
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: spike
ordinal: 343800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 makes a site its directory and promises an export a solo site owner can take to another host or a fresh install. data/ mixes files that must be kept (actor keys under keys/, users.json, followers, comment emails, the notification secret, the forms address salt), credentials (mail.json, akismet.json, plugin secrets), and files that can be rebuilt (geekity.db, images/, avatars/). Nothing declares which is which. This spike lists every file and folder the CMS and the published plugins write under data/ and content/, gives each a class, and designs the export. It builds nothing for production.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision record lists every file and folder written under data/ and content/ by core and by the published plugins, with the code that writes it and its class: kept or rebuildable, and whether it holds secrets. The class model leaves room for a later class of secrets a farm supplies, without building it
- [x] #2 The record says how a class is declared in code so a new data file cannot be added without one, and how that is enforced
- [x] #3 The record designs the export: what it contains, that credentials go in only when the person exporting asks for them, how pending work such as a queued delivery (TASK-379) is handled, and whether it is a CLI command, an admin action or both
- [x] #4 The record says how a site restored from an export comes up: what it rebuilds, what users must do again (such as signing in), and that its fediverse identity is kept
- [x] #5 Follow-up tasks are filed; nothing is built for production in this task
- [x] #6 The user has read the decision record and accepted it, or asked for changes that are made; follow-up build tasks are not started before then
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read decision-52/53/54 and the task.
2. Find every data/ and content/ write site in packages/cms/src and packages/plugin-*/src: path constants, dataDir joins, write calls, plugin host.data files.
3. Confirm the list with a recorded test run (throwaway fs write hook in the session scratchpad, run under NODE_OPTIONS for the cms and plugin test suites).
4. Give each file a class and say what is lost; check how a rebuilt database behaves (scheduler first run, relays.sync).
5. Design the class model, the declaration table and its enforcement, the export, the import and the interaction with geekity rebuild.
6. Write the findings, the design, the proposed tasks and the open questions into decision-55 (status proposed).
7. Leave TASK-384 In Progress until the user accepts decision-55; the user files the proposed tasks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Findings and design are in backlog/decisions/decision-55 (status proposed).

Evidence: a throwaway --require hook wrapped node:fs writes and logged paths under any dir holding geekity.db or _data/site.json. Ran pnpm test in packages/cms (6010 pass) and the four plugins (207 pass): 19,831 writes, which collapse to exactly the files in decision-55's table plus test fixtures. A one-line regex scan found 26 dataDir join sites in src and missed the multi-line join in settings/registry.ts, so the boundary test must use the TypeScript AST. Scripts lived in the session scratchpad; nothing was added to packages/.

Key findings: DataClass.secret conflates 'mode 0600' with 'exported only when asked' (actor keys, notification-secret, comment-salt, users.json are secrets that must be exported), so the record proposes a tagged union kept | credential | rebuildable | pending | scratch. plugin-wordpress actors.json is identity (WP-compat actor numbers). dev-mode.json should be kept, which changes decision-53. The scheduler's first-run rule means an imported site does not re-announce its archive; relays.sync re-follows relays at boot.

Proposed: tar.gz export (departs from decision-52's zip) with a manifest, credentials only on request, Fedify queue never exported (drain first), jobs.json exported and recovered; geekity import CLI-only with the site stopped, ending in the rebuild path; Tools > Export as a decision-54 job. Eight follow-up tasks are listed in the record for the user to file. Waiting for the user to accept decision-55 (AC #5 and #6).

User answered decision-55's open questions on 2026-10-14: tar.gz; dev-mode.json kept so a restore keeps its dev mode (changes decision-53's table); strict plugin data declarations riding the pending major; data/queue.sqlite (decision-57, PR #188, mode 0600 because waiting outbox messages carry the signing key) is pending and never exported; import CLI-only; no plugin code in the archive but the manifest lists installed plugins, versions, source and enabled state and geekity import installs folder plugins from npm through installPlugin and restores their enabled state (a plugin that cannot be installed is named, data is still restored, exit 1); indieauth-activity.json rebuildable. Folded into decision-55 sections 4, 5 and 7 and a Resolved questions list; status accepted. The proposal's queue task 8 was folded into tasks 1, 3, 4 and 6 because #188 is on main. Filed TASK-403..409 under m-38 with dependencies 403 <- 404 <- 405 <- 406 <- 407, 408; 409 after 407 and 408.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Classified every file the CMS and the published plugins write under data/ and content/, from the write sites in code and a recorded run of the full cms and plugin test suites (6010 + 207 tests, 19,831 writes), and designed the site export and import. The result is decision-55, accepted by the user with their answers folded in: a kept | credential | rebuildable | pending | scratch class model, one declaration table with an AST boundary test and a census test, a tar.gz export with a manifest (credentials only on request, queue never exported), and a CLI-only import that verifies, restores, installs plugins from npm and runs the rebuild path. Follow-up tasks filed: TASK-403, TASK-404, TASK-405, TASK-406, TASK-407, TASK-408, TASK-409. Nothing built for production.
<!-- SECTION:FINAL_SUMMARY:END -->
