---
id: TASK-177
title: 'MCP authoring tools: draft, update, publish and upload'
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
updated_date: '2026-09-29 02:14'
labels:
  - mcp
  - content
milestone: m-26
dependencies:
  - TASK-172
  - TASK-164
  - TASK-165
  - TASK-167
priority: medium
type: feature
ordinal: 201800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let an agent write for the site through the same save path Micropub uses (TASK-164, TASK-167) and the same media path (TASK-165), with the same scopes, so an MCP post and an editor post are indistinguishable files. An agent that reads untrusted pages can be steered by prompt injection, so creating always makes a draft, and publishing is its own tool, annotated destructive-to-the-public, needing a separate scope the owner grants deliberately. Tools also read a post's source (as Micropub q=source) so an agent can edit rather than overwrite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 create_draft writes a draft with the same file an editor draft would produce, and never publishes, federates or sends webmentions
- [ ] #2 update_post changes only the named properties, and the editor's conflict check trips if the post is open, as for Micropub
- [ ] #3 publish_post publishes a draft only with its own scope, and is annotated readOnlyHint false and destructiveHint true
- [ ] #4 upload_media stores a file in the media library with alt text and returns its URL
- [ ] #5 get_post_source returns a post's properties in the Micropub mapping
- [ ] #6 Every call is recorded in the audit log (TASK-178)
<!-- AC:END -->
