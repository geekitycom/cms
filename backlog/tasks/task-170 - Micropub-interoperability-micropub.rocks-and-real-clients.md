---
id: TASK-170
title: 'Micropub interoperability: micropub.rocks and real clients'
status: To Do
assignee: []
created_date: '2026-09-29 01:55'
labels:
  - micropub
  - indieweb
  - docs
milestone: m-25
dependencies:
  - TASK-164
  - TASK-165
  - TASK-166
  - TASK-167
references:
  - 'https://micropub.rocks/'
  - 'https://quill.p3k.io/'
priority: medium
type: chore
ordinal: 194800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tests prove the endpoint against the spec as we read it; real clients prove it against the spec as they read it. Run the micropub.rocks server test suite against a deployed site, fix what fails, and post from Quill and one mobile client. Document Micropub in the README: which clients were tried, what the site accepts, and how a user connects a client and revokes it on the connected apps screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every micropub.rocks server test that applies to the implemented features passes, and the results are noted on the task with any skipped tests explained
- [ ] #2 A note, an article, a reply and a photo post from Quill publish correctly, and a post from one mobile client (Indigenous or similar) publishes
- [ ] #3 README documents Micropub support, the supported properties, and connecting and revoking a client
<!-- AC:END -->
