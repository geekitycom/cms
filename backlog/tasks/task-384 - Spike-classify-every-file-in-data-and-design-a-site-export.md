---
id: TASK-384
title: 'Spike: classify every file in data/ and design a site export'
status: To Do
assignee: []
created_date: '2026-10-13 12:10'
updated_date: '2026-10-13 15:29'
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
