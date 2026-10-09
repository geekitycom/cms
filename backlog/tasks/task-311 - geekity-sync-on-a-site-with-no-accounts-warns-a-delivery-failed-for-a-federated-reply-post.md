---
id: TASK-311
title: >-
  geekity sync on a site with no accounts warns a delivery failed for a
  federated reply post
status: To Do
assignee: []
created_date: '2026-10-09 18:27'
labels:
  - bug
milestone: m-31
dependencies: []
priority: low
ordinal: 269800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen during TASK-291.3: the first geekity sync over the andrewshell.org import, into a site with no accounts yet, prints 'A delivery failed: The post "blurt-marketing-gone-wrong" cannot be federated: the site has no accounts...' for the two imported posts that carry both in-reply-to and activitypub.published. It exits 0 and nothing is sent: with an account and GEEKITY_DEV_MODE on, the same sync holds nothing in data/dev-mode.jsonl. The source is the delivery's citedPageStored in packages/cms/src/federation/delivery.ts: when sync stores a cited page for the first time, it fingerprints postObject for every federated post citing it, and attribution() throws on a site with no accounts before any comparison. The warning tells an operator mid-migration that a delivery failed when none was due.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity sync over a site with no accounts and a federated post with in-reply-to prints no delivery failure
- [ ] #2 With an account, a cited page arriving for a migrated post still sends nothing (the dev-mode record holds nothing)
- [ ] #3 A native federated post whose cited page changes is still revised as before
<!-- AC:END -->
