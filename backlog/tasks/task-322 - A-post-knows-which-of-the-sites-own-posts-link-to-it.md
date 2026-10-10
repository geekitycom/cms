---
id: TASK-322
title: A post knows which of the site's own posts link to it
status: To Do
assignee: []
created_date: '2026-10-10 12:41'
labels:
  - indieweb
  - themes
dependencies: []
references:
  - packages/cms/src/webmention/links.ts
priority: low
type: feature
ordinal: 281800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A link from one post to another post or page on the same site sends nothing: the webmention sender drops own-site targets (`externalTarget`, packages/cms/src/webmention/links.ts), and nothing else records the link, so the linked post never learns it was cited.

Do not send self-webmentions. They would put the site's own posts through moderation and the comment count, and cost an HTTP round trip to itself (WordPress self-pingbacks are mostly turned off for that reason). Instead, core already indexes every post's rendered body, so it records which published posts and pages link to which, and a theme reads that as backlinks on the linked document's context, apart from comments.

The default theme does not print them, in line with TASK-317 leaving presentation opinions to site themes. It ships a partial a site theme can include to print a "Linked from" list.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post or page's theme context lists the published posts and pages on the site whose body links to it, newest first, each with title (or its wordless label), URL and date
- [ ] #2 A link counts whether absolute or relative, with or without a trailing slash, a fragment or a query, and through a redirect_from or former permalink of the target; a post linking to itself does not count
- [ ] #3 Drafts, future-dated, unlisted, private and trashed posts never appear as backlinks, and a backlink disappears when the linking post is edited to drop the link, unpublished or deleted
- [ ] #4 No webmention, comment record or moderation item is created for an own-site link, and comment counts are unchanged
- [ ] #5 The default theme prints nothing; a partial a site theme can include prints a "Linked from" list, documented with an example in the default theme README
- [ ] #6 The CMS README says own-site links are recorded as backlinks rather than sent as webmentions
<!-- AC:END -->
