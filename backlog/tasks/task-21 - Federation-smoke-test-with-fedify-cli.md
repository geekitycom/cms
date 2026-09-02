---
id: TASK-21
title: Federation smoke test with @fedify/cli
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-19
references:
  - 'https://fedify.dev/cli'
type: chore
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Script npm run fed:smoke that starts the server on a temporary port with a fixture content dir and settings, runs fedify lookup on the actor and on a post object, and uses fedify inbox to receive a Create delivery after publishing a fixture post. Document how to test against a real Mastodon instance using a tunnel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm run fed:smoke passes locally and in CI
- [ ] #2 README section describes testing federation with fedify tunnel and a Mastodon account
<!-- AC:END -->
