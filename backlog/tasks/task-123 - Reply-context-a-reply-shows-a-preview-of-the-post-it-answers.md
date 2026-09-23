---
id: TASK-123
title: 'Reply context: a reply shows a preview of the post it answers'
status: To Do
assignee: []
created_date: '2026-09-23 19:10'
labels: []
milestone: m-17
dependencies:
  - TASK-121
references:
  - 'https://indieweb.org/reply-context'
  - 'https://indieweb.org/h-cite'
  - packages/cms/src/content/post-type.ts
  - packages/cms/src/webmention/service.ts
type: feature
ordinal: 147800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-121 gives a reply a bare "In reply to" link. IndieWeb reply context (an embedded `h-cite` of the target) lets a reader see what is being answered without leaving the page, and lets parsers read the target's name, author and text. The target is on another site, so the preview needs data fetched from it. That fetch must never happen during a page request, and where the fetched context lives has to respect decision-1 (the files are the source of truth, the database is an index).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The post page of a reply renders the target as an embedded `u-in-reply-to h-cite` that always carries the target URL, in both the default theme and the demo theme
- [ ] #2 When the target page publishes an `h-entry`, the preview shows its name or a short text excerpt, its author name, and its published date where present; when it has no `h-entry`, the preview falls back to the page title and description metadata
- [ ] #3 Serving a reply page never makes a network request: the context is fetched outside the request (for example when the post is saved or synced) and stored, and where it is stored is recorded in a decision consistent with decision-1
- [ ] #4 An unreachable, slow, oversized or unparseable target degrades to a link-only preview and never blocks or fails saving the post
- [ ] #5 The fetch accepts only http and https, has a timeout and a response size limit, and refuses hosts that resolve to loopback, private or link-local addresses, reusing the webmention sender's guard if one exists
- [ ] #6 Changing `in-reply-to` to a different URL refreshes the context, and clearing it removes the preview
- [ ] #7 Text taken from the target is escaped when rendered, so markup on the target cannot inject HTML into the page
- [ ] #8 Tests cover an h-entry target, a metadata-only target, an unreachable target, a refused private address, and the escaping
<!-- AC:END -->
