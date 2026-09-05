---
id: TASK-64
title: >-
  Feeds: one identity, one set of terms and one summary rule across RSS, Atom
  and JSON Feed
status: To Do
assignee: []
created_date: '2026-09-05 13:08'
updated_date: '2026-09-05 13:49'
labels:
  - web
milestone: m-10
dependencies:
  - TASK-63
references:
  - >-
    backlog/decisions/decision-13 -
    A-posts-ActivityStreams-id-is-its-permalink.md
documentation:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: enhancement
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the feed item in place (TASK-63) the three formats stop disagreeing. Per decision-12, read with decision-13, the item's identity is the post's ActivityStreams object id, which is its permalink: Atom's id and JSON Feed's id are already that, and RSS's guid changes from the old /ap/posts/{slug} id to the permalink with isPermaLink true, so RSS subscribers see each post once more as new after the upgrade. Every format lists the post's categories and its tags as its terms, as WordPress does. The summary is the document's description when it has one, else an excerpt of the HTML, in all three. This is a breaking change to public output and lands as a feat(cms)! commit whose changelog entry tells a site what its subscribers will see.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 RSS guid is the post's object id: the permalink with isPermaLink true, or a stored id with isPermaLink false; Atom's entry id and JSON Feed's item id print the same object id; the permalink stays the link in all three
- [ ] #2 Atom and JSON Feed items list categories and tags; RSS's terms are unchanged
- [ ] #3 All three formats use the same summary rule: description, else an excerpt of the HTML
- [ ] #4 The ETag of each feed changes once with the upgrade and is stable afterwards
- [ ] #5 The commit is feat(cms)! with a BREAKING CHANGE footer naming what RSS subscribers will see; doc-3 and the package README describe the item's identity
- [ ] #6 The feed checks TASK-37 used (xmllint and the strict XML reader) still pass on all three feeds
- [ ] #7 A post carrying a stored id changes in no feed
<!-- AC:END -->
