---
id: TASK-177
title: 'MCP authoring tools: draft, update, publish and upload'
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
updated_date: '2026-10-23 16:55'
labels:
  - mcp
  - content
milestone: m-26
dependencies:
  - TASK-172
  - TASK-178
priority: medium
type: feature
ordinal: 201800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let an agent write for the site through the same save path Micropub uses (`writeDocument` in `content/write.ts`, via `micropub/create.ts` and `micropub/update.ts`) and the same media path (`storeUpload`, as `micropub/media.ts` uses), with the same scopes, so an MCP post and an editor post are indistinguishable files. Posts take the Micropub property mapping, so every kind the site supports (notes, articles, photos, replies, citations, reviews and the rest) comes for free rather than being listed here.

An agent that reads untrusted pages can be steered by prompt injection, so creating always makes a draft, and publishing is its own tool, annotated destructive-to-the-public, needing a separate scope the owner grants deliberately. Updating a published post is publishing too: it is stamped updated, federates an Update and sends webmentions. So update_post on a post that is not a draft needs the publish scope as well as update. Tools also read a post's source (as Micropub q=source) so an agent can edit rather than overwrite.

decision-63: writing goals credit only words typed in the editor; MCP writes credit no one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 create_draft writes a draft with the same file an editor draft would produce, for any kind the Micropub mapping covers, and never publishes, federates or sends webmentions
- [ ] #2 update_post changes only the named properties, and the editor conflict check (conflictWith) trips if the post changed since it was read, as for Micropub
- [ ] #3 update_post on a published post needs the publish scope as well as update, proven by tests
- [ ] #4 publish_post publishes a draft only with its own scope, and is annotated readOnlyHint false and destructiveHint true
- [ ] #5 upload_media stores a file in the media library with alt text and returns its URL
- [ ] #6 get_post_source returns a post properties in the Micropub mapping
- [ ] #7 MCP writes add nothing to any user writing ledger (decision-63)
- [ ] #8 Every call is recorded in the audit log (TASK-178)
<!-- AC:END -->
