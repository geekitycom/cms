---
id: TASK-341
title: plugin-wordpress decodes HTML entities in comment author names
status: To Do
assignee: []
created_date: '2026-10-11 02:31'
labels:
  - bug
milestone: m-31
dependencies: []
priority: low
ordinal: 300800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org import with plugin-wordpress 0.3.0. WordPress stores comment_author with HTML entities when it came from a webmention or pingback title, e.g. 'Cry me a river &#8211; Andy Sylvester&#039;s Web' and 'Wait, you can use WordLand &#8211; daveverse' (6 records on that import). WordPress prints the field as HTML, so a reader sees an en dash and an apostrophe. The importer copies it as plain text, and the theme escapes it again, so the page shows '&#8211;' and '&#039;' literally (title attribute and link text both). Proposal: decode HTML entities in comment_author (and any other WXR comment field copied as text, such as the author URL) when importing, so the stored name is the text WordPress displayed. A rerun picks up the decoded name in place, as it does for other fields of an imported comment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An imported comment's author name holds the decoded text (an en dash, an apostrophe), never an HTML entity
- [ ] #2 On the andrewshell.org import, post 501 shows 'Cry me a river – Andy Sylvester's Web' as the author, with no literal &#8211; or &#039; in the page
- [ ] #3 A rerun over a site imported with 0.3.0 rewrites the six names in place
<!-- AC:END -->
