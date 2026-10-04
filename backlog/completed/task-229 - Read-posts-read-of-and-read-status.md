---
id: TASK-229
title: 'Read posts: read-of and read-status'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 01:32'
updated_date: '2026-10-03 13:02'
labels:
  - micropub
  - indieweb
  - interop
dependencies: []
priority: low
type: feature
ordinal: 244800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
indiebookclub (TASK-219) posts IndieWeb read posts as JSON: summary, read-status (to-read, reading, finished), read-of as an embedded h-cite {name, author?, uid?} where uid is isbn:... or doi:..., plus visibility and post-status. The site refuses read-of and read-status. TASK-219's indiebookclub notes give the proposed shape: front matter read-of and read-status, set from Micropub and the admin editor; Post Type Discovery gains read; the theme prints <data class="p-read-status"> and a p-read-of h-cite; federation is a Note with the sentence the page prints; q=config lists read.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Micropub create with read-of (h-cite) and read-status publishes a read post, and q=source and update round-trip both
- [x] #2 The admin editor sets read-of and read-status
- [x] #3 The default theme prints p-read-status and a p-read-of h-cite with p-name, p-author and p-uid
- [x] #4 The post federates as a Note whose content says what was read
- [x] #5 indiebookclub's documented request (its templates/pages/documentation.twig example) answers 201 in a test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape (packages/cms/src/content/read.ts): ReadStatus = 'to-read' | 'reading' | 'finished'; ReadOf = { name, author?, uid?, url? }; Read = { status, of }, both required together. Front matter keys read-of (a map) and read-status, kept in Document.extra like the citations. readOf(extra) is the one reading; readSentence(read) is the line the page and the Note both say ("Want to read: Title by Author, ISBN: 123").

1. content/read.ts with the types, the reader, the status labels and the sentence; unit tests.
2. Post Type Discovery gains read (read-of and read-status present), after photo and before bookmark, so it claims only what would have been a note or an article. POST_TYPE_NAMES (q=config), OBJECT_TYPE_OF (Note), theme screen-reader label.
3. Editor: EditorForm gains readStatus and readOf {name, author, uid, url} (admin/read-field.ts, like location-field.ts); blankForm/formFor/saveFromForm; writeDocument refuses a half-filled read, an unknown status or a url that is no web address; resolveExtra writes or removes both keys. editor.njk fields; preview carries the read.
4. Micropub: PROPERTIES gains read-of (an h-cite object with name, author, uid, url, each one text value) and read-status; UPDATABLE maps each to its own field; sourceProperties returns read-of as an h-cite and read-status. Test replays indiebookclub's documented JSON request and expects 201.
5. Theme: partials/read.njk prints <data class="p-read-status"> and a p-read-of h-cite with p-name, p-author, p-uid (data value keeps the isbn:/doi: uid), inside the entry's e-content on the page and beside the citations in lists. Context gains read with its labels. README documents it.
6. Federation: a read is a Note whose content opens with the read sentence (decision-28's citing line pattern; no Like or Announce, a read has no fediverse object).
7. Decision-27 gets an amendment row for read-of and read-status; doc-2 lists the keys.
8. Verify: pnpm build/test/typecheck/lint/format:check; run the demo, replay indiebookclub's request with curl, parse the page's mf2, fetch the AS object.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: content/read.ts. ReadStatus 'to-read' | 'reading' | 'finished'; ReadOf { name, author?, uid?, url? }; Read { status, of }, both required: readOf(extra) returns a Read only when the file names a work with a name and a known status, so a half-filled read is no read anywhere. Front matter: read-of as a map without empty keys (a bare string reads as its name), read-status as text.

Decisions:
- Post Type Discovery puts read after photo and ahead of bookmark, the same extension slot as bookmark, so it only claims what would have been a note or an article.
- Editor: EditorForm gains readStatus and readOf (admin/read-field.ts, modelled on location-field.ts), as two fields so a Micropub update of one property never blanks the other. resolveRead is the one rule for a half-filled read; writeDocument refuses with its message, so Micropub gets the editor's message too. A hand-written read-status the site does not know is offered back in the select as '(not recognized)' and refused on save until one is picked.
- Micropub: read-of must be an h-cite with only name, author, uid, url, each one text value; anything else is refused by name. read-status is checked in createForm so the refusal names read-status. q=source returns read-of as the h-cite a create sends.
- A new post with no title and no body takes its slug from the read's title, so indiebookclub's posts land at /yyyy/mm/the-left-hand-of-darkness/ rather than /untitled/.
- Theme: partials/read.njk, at the top of the post's e-content (so a parser that reads only content gets the sentence) and beside the citations in listings. Context gains read { status, statusLabel, of { ..., uidLabel } }.
- Federation: OBJECT_TYPE_OF read -> Note; content opens with <p>Want to read: <cite>Title</cite> by Author, ISBN: …</p>, linked when read-of has a url. No Like or Announce (decision-28 does not apply).
- Docs: decision-27 amendment, doc-2 rows, README Micropub table and q=config list, theme README partial and context row.

Not done, worth filing if wanted: a read-of url is not sent a webmention (the citations are); feeds print a read's description, not the read line; an update that changes read-status leaves the stored summary (indiebookclub's sentence) as it was.

Validation: pnpm build, pnpm test (3642 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Live: a scratch server on :4329 with a minted token; curl replay of indiebookclub's documented JSON answered 201 at /2026/10/the-left-hand-of-darkness/; microformats-parser on the page gave read-status [to-read] and read-of h-cite {name, author, uid isbn:9780441478125}; q=source returned both; an update replacing read-status answered 204; the AS object was a Note with content '<p>Finished reading: <cite>The Left Hand of Darkness</cite> by Ursula K. Le Guin, ISBN: 9780441478125</p>'; q=config listed {type: read}. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Read posts: read-of (an h-cite of name, author, uid, url) and read-status (to-read, reading, finished) are stored in front matter, set by the admin editor's new Read fields and by Micropub create and update, and returned by q=source. Post Type Discovery gains read (after photo, ahead of bookmark), q=config lists it, the default theme prints a p-read-status and p-read-of h-cite (partials/read.njk), and the post federates as a Note opening with the same sentence. indiebookclub's documented request answers 201 in micropub/indiebookclub.test.ts and over HTTP against a running site. Verified with the full test suite, typecheck, lint, format check, and curl plus mf2 parsing of the live page and AS object.
<!-- SECTION:FINAL_SUMMARY:END -->
