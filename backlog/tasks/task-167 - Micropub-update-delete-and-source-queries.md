---
id: TASK-167
title: 'Micropub update, delete and source queries'
status: To Do
assignee: []
created_date: '2026-09-29 01:55'
labels:
  - micropub
  - content
milestone: m-25
dependencies:
  - TASK-164
references:
  - 'https://www.w3.org/TR/micropub/#update'
  - 'https://www.w3.org/TR/micropub/#delete'
priority: medium
type: feature
ordinal: 191800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Clients that edit posts ask for a post's current properties with q=source, then send action=update with replace, add and delete, or action=delete and action=undelete. Updates write through the same save path as the editor, so the updated timestamp, federation Update and webmentions follow. The editor already detects a file changed under it; a Micropub update to a post open in the editor must trip that check rather than be overwritten by the next editor save. Delete follows whatever the admin editor does with a deleted post, and undelete restores it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET ?q=source&url= returns the post's properties as JSON in the create mapping, and properties[]= limits them
- [ ] #2 action=update with replace, add and delete changes only the named properties, and the post federates an Update, proven by tests
- [ ] #3 action=delete removes the post from the site, feeds and search and federates a Delete; action=undelete brings it back
- [ ] #4 A URL that is not a post on this site gets 400, and a post authored by another user gets 403
- [ ] #5 Update needs the update scope and delete and undelete need the delete scope
- [ ] #6 An editor with a post open reports the conflict when that post was updated over Micropub, proven by a test
<!-- AC:END -->
