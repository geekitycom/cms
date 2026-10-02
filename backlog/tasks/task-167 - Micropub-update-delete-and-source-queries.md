---
id: TASK-167
title: 'Micropub update, delete and source queries'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:55'
updated_date: '2026-10-02 16:34'
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
- [x] #1 GET ?q=source&url= returns the post's properties as JSON in the create mapping, and properties[]= limits them
- [x] #2 action=update with replace, add and delete changes only the named properties, and the post federates an Update, proven by tests
- [x] #3 action=delete removes the post from the site, feeds and search and federates a Delete; action=undelete brings it back
- [x] #4 A URL that is not a post on this site gets 400, and a post authored by another user gets 403
- [x] #5 Update needs the update scope and delete and undelete need the delete scope
- [x] #6 An editor with a post open reports the conflict when that post was updated over Micropub, proven by a test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a POST body parses to one MicropubRequest union (create | update | delete | undelete), routed by a Record over the action, before fromJson. Form-encoded bodies carry delete/undelete; update is JSON only (the spec's rule).
2. src/micropub/update.ts: sourceProperties(document, baseUrl) is the inverse of the create mapping (name, content, summary, category, in-reply-to, published, post-status, photo as URL or {value, alt}); parseUpdate reads replace/add/delete; updateForm applies the ops to the touched properties only, runs them through createForm, and overlays the touched editor fields on formFor(document). A table maps each updatable property to the editor fields it owns; anything else is refused by name.
3. A shared post lookup for url=: absolute URL on this site whose path is a post's permalink (trash included), else 400 invalid_request; a post whose author resolves to another user gets 403 forbidden. Used by q=source, update, delete and undelete.
4. q=source joins QUERIES (and q=config's q list); properties[]= limits the answer to {properties} as the spec says.
5. Update goes through writeDocument with the post's own hash, so updated/federation Update/webmentions follow and an editor holding the old hash gets the 409 conflict screen. 204, or 201 + Location when the permalink moved.
6. Delete/undelete: extract the editor's trash/restore move into a plain-values core (moveDocumentFile) in documents.ts and call it from both; idempotent (already deleted / not deleted answers 204).
7. Scopes: update needs update, delete and undelete need delete; requireBearer per action after parsing.
8. Tests first per AC in src/micropub/update.test.ts; README Micropub section and decision-27 consequences follow.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: src/micropub/update.ts (sourceProperties, parseChanges, updateForm with an UPDATABLE property->editor-field table), endpoint.ts POST parsed into a MicropubPost union (create|update|delete|undelete) and dispatched through ACTION_SCOPES and ACTIONS records; GET adds q=source. documents.ts: editor trash/restore move extracted into exported moveDocumentFile(site, document, action), used by the editor and Micropub delete/undelete. bearer.ts exports insufficientScope so the POST checks the scope its action needs after parsing. fromJson's action refusal removed (dead once actions route first).
Decisions: update is JSON only (form-encoded action=update is 400, per spec); mp-slug and unmapped properties are refused by name; only fields the touched properties own are overlaid on formFor(document), and only touched properties are validated through createForm. Delete/undelete are idempotent (204 when already in that state). A post attributed to another user is 403 forbidden for q=source, update, delete and undelete; one attributed to nobody the site knows is allowed. A conflict on update answers 409 conflict. Update answers 204, or 201 + Location when the permalink moved (a re-dated draft).
Docs: README Micropub section and doc-2 Micropub section extended.
Validation: pnpm build, pnpm test (3345 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. src/micropub/update.test.ts covers every AC. Curled a scratch site on :4517: create 201; q=source and properties[]=category answered; update with create-only token 403 insufficient_scope; update 204 and source shows content replaced, category one removed and three added; another user's delete 403 forbidden; unknown URL 400; form delete 204 then page 404, absent from /feed/ and /search/; JSON undelete 204 then page 200 and back in feed and search. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub clients can now read a post back with q=source (properties[] narrows it), edit it with action=update (replace/add/delete) through the editor's own writeDocument path, and delete/undelete it through the editor's trash move, now shared as moveDocumentFile. Update needs the update scope, delete and undelete the delete scope; a URL that is not a post here is 400 and another user's post is 403. An editor holding the old hash gets the 409 conflict screen after a Micropub update. Verified by src/micropub/update.test.ts (federated Update and Delete, feeds and search, scopes, conflict), the full build/test/typecheck/lint/format gate, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
