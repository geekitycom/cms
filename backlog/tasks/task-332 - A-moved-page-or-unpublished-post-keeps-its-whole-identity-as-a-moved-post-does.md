---
id: TASK-332
title: >-
  A moved page or unpublished post keeps its whole identity, as a moved post
  does
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 18:27'
updated_date: '2026-10-10 19:52'
labels:
  - comments
  - federation
dependencies:
  - TASK-329
references:
  - packages/cms/src/comments/records.ts
priority: low
type: bug
ordinal: 291800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-329 made comments follow a document whose slug changes when it leaves redirect_from. Gaps it inferred from the code but did not reproduce: the editor keeps the old URL as activitypub.id only for posts, so a moved page's /replies/{key}/ and a reply post to its old URL break; the editor writes no redirect_from for a post moved while unpublished, so its comments do not follow; a hand permalink change without redirect_from cannot be linked back to its comments; webmentions_sent rows stay keyed by the old slug; and during a watcher burst (a git pull) that adds a new post at the old URL right after a move, the moved post could take that post's comments, which a full scan does not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each listed gap is reproduced or ruled out, with findings in the notes
- [x] #2 A moved page keeps its /replies/ feed and its reply posts as a moved post does
- [x] #3 A post moved while unpublished keeps its comments once published
- [x] #4 A watcher burst that moves a post and adds another at its old URL gives each post its own comments, as a full scan does
- [x] #5 webmentions_sent follows a moved document, so it is not re-sent or orphaned
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce each gap in web/moved-identity.test.ts against the current code (page move, unpublished move, watcher burst, webmentions_sent) and probe the hand permalink change without redirect_from.
2. Page identity: the editor pins a moved page's feed guid (extra.guid = the old absolute URL), as it pins a post's activitypub.id, so /replies/{key}/ and the comments feeds keep naming it. The conversation reader names a document by every redirect_from URL too (namesIn), so a reply post to any former URL threads, page or post.
3. Unpublished move: promisedDocument also counts a document that holds comments (its URL was shown), so the editor writes redirect_from and the kept identity; the follow runs once it is published (ownerOf only finds served documents).
4. Watcher burst: the per-document follow runs only for admin and schedule changes. Content sync gains onSettled, fired inside its queue after a full scan and after a watcher burst drains; the comment sweep runs there, replacing the scan() wrapper in index.ts. The sweep takes each file pair's lock (async), so it no longer relies on being synchronous.
5. webmentions_sent: admin store moveSentWebmentions(from, to) (newer row wins per target) and listSentWebmentionSlugs; a row whose slug names no document belongs to the document that owns its recorded source by the redirect rule. Run with the comment follow (per change and on settle).
6. Tests pin: follow listener before others (a later listener sees moved comments), sweep after a burst. Full verify + scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduction (web/moved-identity.test.ts against the code before the fix):
- Page moved by the editor's slug field (/about/ -> /team/): the reply post answering https://blog.example/about/ dropped out of the page, and its /replies/{key}/ was keyed by the new permalink, since a page's feed guid is its permalink and nothing pinned it. REPRODUCED.
- Post saved as a draft, then its slug changed, then published: no redirect_from was written (promisedDocument ignored an unserved, unannounced post), so its comments stayed in hello.json and the published post showed none. REPRODUCED.
- Watched burst (rm hello.md, write greetings.md with redirect_from the old URL, 40ms later write a new post at the old URL): the per-document follow ran on greetings before the new post was indexed and took _data/comments/hello.json into greetings.json. A full scan leaves it with the post at the URL. REPRODUCED.
- webmentions_sent: a row recorded under slug hello stayed there after the editor's slug change, and greetings had none, so the admin showed nothing sent for the moved post and a post taking the old slug would inherit the rows. REPRODUCED (orphaned). Re-sending is ruled out as a defect: nothing reads the ledger to decide a send, and a move sends from the new source on purpose (webmention/service.ts sendFor: the receivers need the new source and answer with copies under the new permalink).
- Hand permalink change with no redirect_from: the new URL shows no comments, and the old URL and /comment/{id}/ answer 404. REPRODUCED, left as designed: without redirect_from nothing says the document lived at the old URL (the site 404s it), so there is no owner to give the comments to. Adding the redirect_from later fixes it through the post-scan sweep (TASK-329's hand-redirect test).

Fix:
- admin/documents.ts: promisedDocument also counts a document whose comment file exists (its URL was read), so the editor writes redirect_from and the kept identity for it; the follow then runs when it is published, because getByFormerPermalink only finds served documents. keptGuid writes the URL a promised page leaves as its `guid` (feedGuid already honours it), as keptIdentity pins a post's activitypub.id.
- web/conversation.ts namesIn names the root by every redirect_from URL too, so a reply post answering any former URL threads, page or post.
- content/sync.ts: ContentSync.onSettled(listener), run on the sync queue after every full scan and after a watcher burst drains (no debounce pending and nothing else queued). index.ts runs the comment sweep and the ledger follow there, replacing the scan() wrapper; the per-document follow now runs only for admin and schedule changes.
- comments/records.ts: followAllMovedComments is async and takes each file pair's lock through the same follow() the per-document path uses, so the sweep no longer depends on being synchronous. ownerOf is exported as permalinkOwner.
- admin/store.ts listSentWebmentionSources and moveSentWebmentions (one transaction; the later attempt wins per target). webmention/service.ts followMovedWebmentions: a row whose slug names no document moves to permalinkOwner of its source.
- README Moved URLs describes what a moved document keeps.

Ordering pins (from the TASK-329 review): the follow-before-other-listeners order is pinned by 'has moved the comments before the site's own change hook hears of the move'; the sweep after a burst by 'takes the comments along when a watched move settles'; the unlocked sweep is now locked by structure. followFile's write order is untouched and stays unpinned.

Verified: mutation runs, each reverting one change, fail the matching test (namesIn, guid pin, comments-as-promised, watch per-document follow, ledger follow, per-change follow, burst settle). pnpm build, test (cms 5375 pass), typecheck, lint and format:check are clean. Scratch site under geekity serve (dist/cli.js, watch on): the editor moved /about/ to /team/ and wrote guid: http://localhost:3332/about/; /team/, /team/feed/ and /replies/4eb9cacbc1bf0c9c/ (the old guid's key) answered 200 with Cy and the reply post, and /about/ 301'd. hello-world saved as a draft, its slug changed to first-words, then published: /2026/01/first-words/ showed Ada and the old URL 301'd. A hand burst that moved first-words to farewell and added a new post at /2026/01/first-words/ 40ms later left first-words.json with the new post (Ada there, none on farewell). A hand move of /team/ to /crew/ took the comments along once the watcher settled, and the old /replies/ key still answered.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A moved page now keeps its identity as a moved post does: the editor writes the URL it left as its guid, so its /replies/ feed keeps its key, and a reply post to any redirect_from URL stays in the thread. A post with comments counts as promised, so moving it while unpublished writes redirect_from and its comments follow once it is published. Watched changes follow comments only after the burst settles (ContentSync.onSettled, which also replaces the scan wrapper), so a git pull that moves a post and adds one at its old URL ends as a full scan does; the sweep now takes file locks. webmentions_sent rows of a slug no document has move to the owner of their source. A hand permalink change without redirect_from was reproduced and left as designed. Verified by web/moved-identity.test.ts and a store test (each fails under a mutation of its fix), the full pnpm build/test/typecheck/lint/format:check, and a scratch site under geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
