---
id: TASK-384
title: 'Spike: classify every file in data/ and design a site export'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-13 12:10'
updated_date: '2026-10-14 14:34'
labels: []
milestone: m-38
dependencies:
  - TASK-383
references:
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
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
- [ ] #1 A decision record lists every file and folder written under data/ and content/ by core and by the published plugins, with the code that writes it and its class: kept or rebuildable, and whether it holds secrets. The class model leaves room for a later class of secrets a farm supplies, without building it
- [ ] #2 The record says how a class is declared in code so a new data file cannot be added without one, and how that is enforced
- [ ] #3 The record designs the export: what it contains, that credentials go in only when the person exporting asks for them, how pending work such as a queued delivery (TASK-379) is handled, and whether it is a CLI command, an admin action or both
- [ ] #4 The record says how a site restored from an export comes up: what it rebuilds, what users must do again (such as signing in), and that its fediverse identity is kept
- [ ] #5 Follow-up tasks are filed; nothing is built for production in this task
- [ ] #6 The user has read the decision record and accepted it, or asked for changes that are made; follow-up build tasks are not started before then
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
<!-- SECTION:NOTES:END -->
