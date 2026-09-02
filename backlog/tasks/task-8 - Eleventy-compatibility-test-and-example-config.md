---
id: TASK-8
title: Eleventy compatibility test and example config
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - content
milestone: m-0
dependencies:
  - TASK-2
references:
  - backlog/decisions/decision-3 - Content-files-follow-Eleventy-conventions.md
type: chore
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prove the compatibility promise in decision-3. Add a fixtures content directory and a test that runs Eleventy 3 against it (dev dependency) and checks that every fixture document is emitted at the URL the CMS computes from its permalink. Ship docs/eleventy.config.example.js with the draft preprocessor and passthrough copy for uploads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm run test:11ty builds the fixtures directory with Eleventy without errors
- [ ] #2 For every fixture document, the Eleventy output path equals the CMS permalink plus index.html
- [ ] #3 Fixture documents with draft: true are absent from the Eleventy output
- [ ] #4 The example Eleventy config is documented in the README
<!-- AC:END -->
