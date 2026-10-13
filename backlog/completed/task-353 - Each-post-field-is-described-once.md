---
id: TASK-353
title: Each post field is described once
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 23:01'
labels: []
milestone: m-33
dependencies:
  - TASK-352
type: chore
ordinal: 312800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adding a post field means editing formFor and resolveExtra (admin documents), createForm (micropub/create.ts), sourceProperties and UPDATABLE_BY_TYPE (micropub/update.ts). documents.ts branches on kind.type === post 25 times although DocumentKind already carries capability flags.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Extra-backed post fields are declared in one table that drives form-from-document, document-from-form and the Micropub property mapping in both directions
- [x] #2 Post-only behaviour is a capability of the document kind; no kind.type === post checks remain in the write path or form conversion
- [x] #3 A test adds a field to the table alone and sees it round-trip through the editor form and Micropub
- [x] #4 Micropub create, update and q=source output is unchanged for every existing field
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Descriptor sketch (content/post-fields.ts):

  interface PostField {
    read(document, timezone): Partial<EditorForm>          // form-from-document
    submitted(body, declared targets): Partial<EditorForm> // editor HTML body -> form
    write(extra, form, { document, now, media, declared, timezone }): void // document-from-form
    micropub?: {
      properties: Record<mf2 name, (keyof EditorForm)[]>  // what an update may change, and the keys it owns
      publishable: mf2 names enough to publish on their own
      toForm(request: { type, has, values, text, refuse, upload, baseUrl, targets }): Partial<EditorForm>
      toProperties(document, { baseUrl, targets }): Record<mf2 name, unknown[]>  // q=source
    }
  }

A row owns one or more EditorForm keys (read owns readStatus + readOf). Rows do not carry a blank: a kind's form starts from BLANK_POST_FORM and every row the kind carries overwrites its keys, so a row a kind does not carry is blank by construction.

Rows, in front-matter write order (keeps files byte-identical): enclosure (write from resolved media, no mf2), photos (write from resolved media; mf2 photo with uploads and {value, alt}), repost-of / like-of / bookmark-of (one factory), rsvp, event (mf2 start/end; reads location for an h-event, which update.ts maps to event for h-event as today), preview, cited-alt, read (read-of h-cite + read-status), syndicate-to (declared targets), pinned (keeps its moment).

Outside the table, with reasons: location (sidecar data/locations.json, not extra; h-entry vs h-event checkin merge), in-reply-to (Document field, not extra), lang/visibility/comments/exclude/contact (not post-only).

DocumentKind gains: fields (the rows it carries: POST_FIELDS for posts, none for pages), replies (in-reply-to + post type slug), located (location form + locations sidecar). Kept-properties sidecar moves and sets unguarded: both are no-ops for a document with no entry.

Steps:
1. Golden test micropub/fields-golden.test.ts + fields-golden.json pinning file text, q=source and single-field refusals for every mapped field across create and updates, generated on the old code.
2. AC #3 test content/post-fields.test.ts: a kind = POST_KIND plus one extra row round-trips through formFor -> writeDocument -> formFor and createForm -> writeDocument -> sourceProperties / updateForm.
3. Add post-fields.ts; move the row HTML readers and field names (READ/EVENT/PHOTO/ENCLOSURE) next to their form types in content; move the Micropub parsers (photo row, read-of h-cite, event place, syndicate-to) into the rows.
4. Drive blankForm/formFor/extraFromForm/submittedForm/createForm/sourceProperties/updateForm from kind.fields; replace kind.type === 'post' in write.ts and document-form.ts with kind capabilities. Keep checkForm's refusal order.
5. Verify build/test/typecheck/lint/format; grep counts in notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned, plus one capability: DocumentKind.federated replaces the promised.type === 'post' checks in keptIdentity/keptGuid, so the write path has no type check left.

Layout: content/post-fields.ts holds PostField, MicropubRequest/MicropubMapping/MicropubSite/MicropubType, the twelve rows and POST_FIELDS. The HTML readers and field names of the row-backed forms moved next to their form types (READ_FIELDS/submittedReadOfForm -> read-form.ts, EVENT_FIELDS/submittedEventForm -> event-form.ts, PHOTO_FIELDS/readPhotoForm -> photo-form.ts, ENCLOSURE_FIELDS/readEnclosureForm -> enclosure-form.ts), and the Micropub parsers moved there too (readOfFromMicropub, readCite, eventPlaceFromMicropub, photoRowFromMicropub, photoToMicropub). trimmedField/rowIndexes moved to util/forms.ts. syndicateToField moved to post-fields.ts. citationFields was left unused and is deleted.

document-form.ts: blankForm/formFor/submittedForm fill post keys through postFieldsForm(kind, read|submitted) over BLANK_POST_FIELDS; extraFromForm runs kind.fields[].write in table order (the old write order, so files stay byte-identical). formFor now takes the kind first.
write.ts: checkForm keeps its refusal order. The post-only guards on rsvp, citations, read, enclosure/photos, location, cited image and event are gone: a kind without those rows has them blank, and blank resolves to nothing. in-reply-to and the type slug use kind.replies; the locations sidecar uses kind.located; the kept-properties move/set run for any kind (no-ops without an entry).
micropub: createForm/updateForm/sourceProperties/keptPrivately take an optional kind (POST_KIND by default), and their row properties, publishable set, update ownership and q=source come from kind.fields. update.ts keeps the h-event location -> event override and still re-sends every event property on an h-event update.

grep -c "type === 'post'" after: content/write.ts 0, content/document-form.ts 0, content/post-fields.ts 0, content/{read,event,photo,enclosure}-form.ts 0, micropub/create.ts 0, micropub/update.ts 0, admin/documents.ts 1 (was 14; the one left picks renderEditor's template options, not form conversion).

Behaviour changes: q=source answers the same properties in a different key order (the golden test compares them sorted); a Micropub create with several errors may list them in a different order (single-field refusals are pinned unchanged); a page's editor form has pinned false even if its file has pinned (the checkbox is post-only in the template, so nothing shows).

Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all pass (cms 5543/5543, plugins 207/207). The golden test fails when POST_FIELDS is reordered or a row's toProperties is emptied (checked by mutation, then restored).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Post fields kept in front matter are now rows in one table (content/post-fields.ts, POST_FIELDS). Each row says how it reads into the editor form, reads off a submitted editor, writes back to the file, and maps to and from Micropub (create, update ownership, q=source). DocumentKind carries the rows (fields) and three capabilities (replies, located, federated), so the write path and form conversion no longer check kind.type === 'post'. Verified by micropub/fields-golden.test.ts (file text, q=source and refusals for every mapped field, recorded on the old code and unchanged after), content/post-fields.test.ts (a row added only to a kind's table round-trips through submittedForm/formFor/writeDocument and Micropub create, q=source and update), and the full build, test, typecheck, lint and format run.
<!-- SECTION:FINAL_SUMMARY:END -->
