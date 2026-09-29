---
id: TASK-127
title: Redirect a post or page's old URL when its slug or permalink changes
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 00:16'
labels:
  - seo
  - urls
milestone: m-18
dependencies: []
references:
  - 'https://specification.website/spec/agent-readiness/stable-urls/'
  - 'https://specification.website/spec/seo/redirects/'
priority: high
type: feature
ordinal: 151800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Editing a post or page slug, or anything else its permalink is built from (date, permalink pattern), leaves the old URL returning 404. Backlinks, bookmarks, search results and copies other servers hold go dead. Only taxonomy renames are redirected today (src/web/taxonomy.ts). The specification treats URLs as public contracts. Under decision-9 the record of old URLs must live in the content files, not only in SQLite. Under decision-13 a post's ActivityStreams id is its permalink, so the plan has to settle what the old id serves: a redirect, or the object with its new id followed by an Update.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Changing a published post's or page's slug makes the old URL answer 301 (or 308) with the new URL
- [x] #2 Chains collapse: after two renames, both earlier URLs redirect straight to the current one
- [x] #3 The old URLs are recorded in the document's file, so deleting the SQLite cache keeps them working
- [x] #4 A new document that claims an old URL takes it over, and the redirect stops
- [x] #5 .md and .json representations of the old URL redirect too
- [x] #6 Federation behaviour for a renamed post is decided, recorded as a decision, and tested
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Model the record: a new front matter key redirect_from (Jekyll's name for the same thing), a list of site-relative URLs the document used to live at. Document.redirectFrom, parsed at the boundary (strings starting with /, deduped), written after permalink, carried by documentContent. Index it in a new document_redirects table (migration 6) so the lookup is one indexed query, rebuilt from files like every other row (decision-9).
2. Editor: lift decision-13's refusal to move a published post's slug/permalink. When a document whose URL was promised (public now, or a post already announced) moves, the save appends the old permalink to redirect_from, keeps the earlier entries (chains collapse because every entry names the document itself, not a hop) and drops the new permalink from the list (renaming back). A draft that was never public moves without a record.
3. Federation (AC 6): a promised post that moves and has no stored activitypub.id gets its old absolute permalink pinned as activitypub.id. The existing stored-id path then serves the Article at the old URL to peers, 301s browsers, names that id in the Update (same id, so delivery sends Update rather than Delete+Create), and keeps inbox replies attached. Record as a decision superseding decision-13's 'the editor refuses'.
4. Public site: in resolveRequest, after the live-document and .md/.json lookups and before the trailing-slash canonicaliser and 404, look up a public document whose redirect_from names the path (or the extension-stripped path) and 301 to its permalink (or its .md/.json). Also in canonicalTarget so a slashless old URL reaches the new one in one hop. This is the slot TASK-128's site-level list joins.
5. AC 4: a live document at the URL wins because the lookup only runs when nothing lives there; the stored-id middleware stops redirecting browsers away from a live document at the path.
6. Tests first per AC (admin editor tests + HTTP via app.request), then build/test/typecheck/lint/format and curl the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- Record: new front matter key redirect_from (Jekyll's name), modelled as Document.redirectFrom, parsed at the boundary (site paths only, own permalink and repeats dropped), written right after permalink. Indexed in a new document_redirects table (store migration 6, which empties the index so files already carrying the key are read again). ContentStore.getByFormerPermalink answers only with a public document.
- Editor (admin/documents.ts): decision-13's refusal to move a published post is gone. A promised document (public now, or a post already announced) that the author moves by editing the slug or permalink gets the URL it leaves appended to redirect_from; the URL it arrives at is dropped from the list. A date correction still keeps the URL. A draft never shown moves without a record.
- Public site (web/routes.ts resolveRequest): after every live lookup (document, .md/.json, listings) and before the trailing-slash canonicaliser and the 404, a former permalink 301s to the document's permalink, or to the same representation for .md/.json. canonicalTarget also knows former permalinks, so a slashless old URL reaches the new one in one hop. TASK-128's site-level list plugs in beside movedHref in that same slot, and its X-Redirect-By header belongs on every c.redirect there.
- Federation (federation/mount.ts): the stored-id path no longer redirects a browser away from a URL a live document now holds.

Decision (decision-20, created with the CLI; the CLI has no way to write a decision body, so its content is recorded here):
Context: decision-13 made a post's ActivityStreams id its permalink and had the editor refuse to move a published post. TASK-127 requires published posts and pages to be movable with the old URL redirecting. Mastodon and other servers cannot change the id of an object they hold; a new id reaches them as a second object (Delete plus Create), losing replies, boosts and likes.
Decision: when a promised post moves and its file has no activitypub.id, the editor writes the URL it is leaving (absolute on baseUrl) as activitypub.id. The existing stored-id mechanism does the rest: an ActivityStreams request at the old URL gets the Article (id = old URL, url = new permalink); a browser there gets 301; every Update and Delete names that id, so delivery sends an Update, never Delete+Create; inbox replies addressed to the old id keep attaching; feeds keep keying the item by it (decision-12), so readers see no duplicate. A post that already stores an id keeps it. The new permalink also answers peers with the same Article. The old URLs for browsers live in redirect_from in the file (decision-9). Supersedes decision-13's 'the editor refuses' paragraph; the rest of decision-13 stands.
Consequences: a moved post has two URLs for good: its id (old URL) and its permalink. If a new document later takes the old URL over, browsers and .md/.json get the new document; an ActivityStreams request there gets the new document when it is a federated post, else the moved post's Article. A new federated post at a moved post's id would share that id with it, which the fediverse would treat as one object; accepted as a rare edge (same month and slug), not guarded.

Verified: pnpm build && pnpm test (2293 pass, 30 eleventy pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Live: geekity init scratch site on :3917, signed in, renamed hello-world twice and about once through the editor: old HTML URLs, slashless URL, index.md, index.json and .json all 301 to the current URL; AS request at the old id returns the Article with id=old URL and url=new permalink. Stopped the server, deleted data/geekity.db, added a page with permalink /about/, restarted: old post URLs still 301 (from the file), /about/ and /about/index.md now 200 with the new page. Server stopped.
README: replaced 'a published post's slug and permalink cannot be changed' with how a move federates, and added a Moved URLs section.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Published posts and pages can now be moved in the editor, and their old URLs keep working. The editor writes each URL a document leaves into a new redirect_from front matter list. The index keeps those URLs in a document_redirects table (migration 6). The public site 301s a former URL, and its .md/.json and slashless spellings, to the current permalink, but only when nothing else lives at that URL. A moved post keeps its fediverse identity: the URL it leaves is pinned as activitypub.id (decision-20, whose content is in the notes because the CLI cannot write a decision body), so followers get an Update of the same object and peers still dereference the old id. Verified with new editor, store, parser and delivery tests, the full build/test/typecheck/lint/format chain, and curl against a live scratch site before and after deleting its database.
<!-- SECTION:FINAL_SUMMARY:END -->
