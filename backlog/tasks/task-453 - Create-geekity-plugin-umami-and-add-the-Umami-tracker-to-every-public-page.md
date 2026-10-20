---
id: TASK-453
title: Create @geekity/plugin-umami and add the Umami tracker to every public page
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
labels:
  - plugins
  - umami
milestone: m-42
dependencies:
  - TASK-443
references:
  - docs/plugins.md
priority: medium
ordinal: 390800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new published package, @geekity/plugin-umami, alongside the other plugin-* packages. Its settings: the Umami URL, the website ID, and tracker options (data-domains, data-do-not-track, exclude search and hash). It adds the Umami script tag through the page-tags hook, which replaces the theme-override snippet sites use today (decision-37 hook partials).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The package builds, tests and publishes with the others: workspace, release-please config, commitlint scope plugin-umami, and the Docker plugin add path
- [ ] #2 With the URL and website ID set, every public page carries one Umami script tag with the configured data attributes; with either unset, none
- [ ] #3 The tag is not drawn in the editor preview
- [ ] #4 The README and docs explain installing the plugin and removing an existing head-end snippet so the tracker is not counted twice
<!-- AC:END -->
