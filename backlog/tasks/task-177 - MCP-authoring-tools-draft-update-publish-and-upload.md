---
id: TASK-177
title: 'MCP authoring tools: draft, update, publish and upload'
status: Done
assignee:
  - '@claude'
created_date: 2026-09-29 02:13
updated_date: '2026-10-25T16:55:00Z'
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
- [x] #1 create_draft writes a draft with the same file an editor draft would produce, for any kind the Micropub mapping covers, and never publishes, federates or sends webmentions
- [x] #2 update_post changes only the named properties, and the editor conflict check (conflictWith) trips if the post changed since it was read, as for Micropub
- [x] #3 update_post on a published post needs the publish scope as well as update, proven by tests
- [x] #4 publish_post publishes a draft only with its own scope, and is annotated readOnlyHint false and destructiveHint true
- [x] #5 upload_media stores a file in the media library with alt text and returns its URL
- [x] #6 get_post_source returns a post properties in the Micropub mapping
- [x] #7 MCP writes add nothing to any user writing ledger (decision-63)
- [x] #8 Every call is recorded in the audit log (TASK-178)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: tools take Micropub's own JSON shapes (create: type + properties map of value lists; update: replace/add objects, delete names, deleteValues object) and hand them to fromJson/parseChanges/createForm/updateForm, then writeDocument via documentSiteFrom, exactly as micropub/endpoint.ts does, minus creditWriting.
1. Registry: a core tool may answer a ScopeShortfall (needs a scope beyond its own); the registry turns it into the same insufficient-scope outcome (403 + challenge, audited). Add siteRecords/announce/learnHandles to ToolSite.
2. mcp/authoring/: create_draft (create), get_post_source (update), update_post (update; publish too when the post is public or the update makes it public; takes the hash get_post_source returned so conflictWith trips), publish_post (publish; formFor + draft:false through writeDocument, destructiveHint true), upload_media (media; base64 data capped at the site's largest upload limit, storeUpload then writeAltText).
3. Posts by another user are refused, as Micropub's postAt does.
4. Tests first in mcp/authoring/authoring.test.ts: file parity with a Micropub draft per kind, no federation/webmentions from a draft, conflict, publish scope on public update, publish annotations, upload with alt, source mapping, no writing ledger, audit entries.
5. docs/mcp.md: scopes table text and the authoring tools.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Registry: a core tool may answer { needsScope } (ScopeShortfall in mcp/tools.ts); the registry treats it as insufficient-scope, so update_post on a public post without publish gets the same 403 + insufficient_scope challenge (scopes held plus publish) and audit entry as any scope refusal. ToolSite gained siteRecords, announce and learnHandles for documentSiteFrom.
- The Micropub mapping moved from micropub/create.ts and micropub/update.ts to content/micropub-create.ts and content/micropub-update.ts (pure, content-only imports): layer-boundary.test.ts forbids mcp/ importing micropub/, both being endpoint layers. Callers updated; no behavior change.
- Tools in mcp/authoring/: create_draft (create), get_post_source (update), update_post (update, plus publish when the post is public or the update makes it public), publish_post (publish; formFor + draft:false through writeDocument, destructiveHint true, idempotent: an already-published post is left alone), upload_media (media; base64 capped at the site's largest upload limit before decoding, then storeUpload and writeAltText). Posts by another user are refused as Micropub refuses them.
- update_post takes the hash get_post_source returned and writes it into the form, so conflictWith trips when the post changed in between (proven by a stale-read test that fails if the hash is dropped).
- No creditWriting call anywhere in the tools; test asserts the ledger file is never written.
- Verified: pnpm build, pnpm test (cms 7660 pass), pnpm test:11ty, typecheck, lint, format:check. Mutation checks: dropping the publish check, the hash, or draft:true each fails tests.
- Not done here: a live run against a real site (TASK-179). The MCP endpoint itself has no body-size cap before JSON parsing; upload_media refuses oversize data after parsing. Out of scope; noted for review.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added five MCP authoring tools that write through the same paths as Micropub and the editor: create_draft (always a draft, never federated or mentioned), get_post_source (Micropub q=source plus a hash), update_post (named properties only, conflict check by hash, publish scope needed for public posts), publish_post (publish scope, destructiveHint), and upload_media (media library with alt text, size-capped base64). The registry now lets a core tool demand an extra scope at call time, answered as the standard 403 insufficient_scope. Moved the Micropub property mapping into content/ so both endpoints can share it under the layer rules. No writing-ledger credit; every call audited. docs/mcp.md documents the tools. All build, test, typecheck, lint and format checks pass.
<!-- SECTION:FINAL_SUMMARY:END -->
