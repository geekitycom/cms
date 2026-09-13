---
id: TASK-64
title: >-
  Feeds: one identity, one set of terms and one summary rule across RSS, Atom
  and JSON Feed
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:08'
updated_date: '2026-09-13 02:06'
labels:
  - web
milestone: m-10
dependencies:
  - TASK-63
references:
  - >-
    backlog/decisions/decision-13 -
    A-posts-ActivityStreams-id-is-its-permalink.md
documentation:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: enhancement
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the feed item in place (TASK-63) the three formats stop disagreeing. Per decision-12, read with decision-13, the item's identity is the post's ActivityStreams object id, which is its permalink: Atom's id and JSON Feed's id are already that, and RSS's guid changes from the old /ap/posts/{slug} id to the permalink with isPermaLink true, so RSS subscribers see each post once more as new after the upgrade. Every format lists the post's categories and its tags as its terms, as WordPress does. The summary is the document's description when it has one, else an excerpt of the HTML, in all three. This is a breaking change to public output and lands as a feat(cms)! commit whose changelog entry tells a site what its subscribers will see.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 RSS guid is the post's object id: the permalink with isPermaLink true, or a stored id with isPermaLink false; Atom's entry id and JSON Feed's item id print the same object id; the permalink stays the link in all three
- [x] #2 Atom and JSON Feed items list categories and tags; RSS's terms are unchanged
- [x] #3 All three formats use the same summary rule: description, else an excerpt of the HTML
- [x] #4 The ETag of each feed changes once with the upgrade and is stable afterwards
- [ ] #5 The commit is feat(cms)! with a BREAKING CHANGE footer naming what RSS subscribers will see; doc-3 and the package README describe the item's identity
- [x] #6 The feed checks TASK-37 used (xmllint and the strict XML reader) still pass on all three feeds
- [x] #7 A post carrying a stored id changes in no feed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Baseline: record the three post feeds' ETags on the current code, so AC #4's "changes once" has a before value to compare against (done: /feed/ 35aad5e8…, /feed/atom/ 182760c2…, /feed/json/ dd997c56…, /comments/feed/ 9e32f580…).
2. Red in `src/web/feed-formats.test.ts`, the seam where one FeedItem meets all three serialisers: rewrite the expectations so RSS's `guid` is the item's id with `isPermaLink` telling the truth (true when id === link, false for a stored id), Atom's `<id>` and JSON Feed's `id` print the same id while `url`/`link` stay the permalink, Atom and JSON list categories then tags, and all three print `item.summary`.
3. Green in `feed-rss.ts`, `feed-atom.ts` and `feed-json.ts`: one line each reads the other half of the pair. Atom's `<summary>` and JSON's `summary` are written whenever the summary is non-empty, rather than only when the post wrote a description.
4. Collapse the model in `src/web/feed-item.ts` now nothing reads the redundant halves: `categories` + `tags` become one `terms` list (categories first, file order) and `description` goes, since `summary` is always populated. Update `feed-item.test.ts` at the derivation seam.
5. AC #4: the feed ETag is a hash of the documents and the site's metadata, so it would not move when only the serialisation rules change and a polling reader would be handed a 304 hiding the new guid. Add a feed-format revision to the ETag label so every post feed's validator changes exactly once with this upgrade and is stable afterwards; the comments feeds are untouched because their bytes are.
6. HTTP seam: update `src/web/feeds.test.ts` — the RSS guid/isPermaLink assertions, the Atom and JSON category assertions, the Atom/JSON summary assertions for a post with no description, and the migrated-post case that proves AC #7 (a stored id changes in no feed). Add the isPermaLink=true/false pair and an ETag-stability case.
7. Docs: the package README's Feeds section (the `guid isPermaLink=\"false\"` paragraph, the stale \"minted from the slug\" rationale, the Atom/JSON entry descriptions) and doc-3's Feeds paragraph.
8. Re-run the ETag probe to show all three post feeds moved once and the comments feed did not, then delete the probe.
9. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, plus xmllint --noout on RSS and Atom bodies (AC #6, with the strict XML reader already asserting well-formedness inside the tests).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

**The model.** `FeedItem` now carries one of each thing the three formats used to disagree about. `categories` and `tags` collapsed into one `terms` list (categories first, each in file order), because no feed format can say which vocabulary a term came from; `description` went, because `summary` is always populated by the same rule. What is left is one `id` beside one `link`, which are two real things — what the post is called and where it is read — and equal for every post born on the CMS.

**The three serialisers.** RSS's `guid` prints `isPermaLink="true"` when `item.id === item.link` and `"false"` otherwise, so the attribute finally tells the truth. Atom's `<id>` and JSON Feed's `id` print `item.id` instead of the permalink; Atom's `rel="alternate"` and JSON Feed's `url` stay the permalink. Atom and JSON Feed list `item.terms` rather than tags alone. Atom's `<summary>` and JSON Feed's `summary` print `item.summary`, so a post that wrote no description is summarised by its excerpt as RSS has always done; both leave the element out only when the summary is empty, since an empty one says less than none.

**The validator.** A feed's ETag was a hash of the documents and the site's metadata, so this release would have changed every feed's bytes without moving it, and a reader polling with `If-None-Match` would have been handed a 304 hiding the new guid. `FEED_ITEM_REVISION` (2) is now part of the ETag label in `feedResponse`, which moves every post feed's validator exactly once. The comments feeds do not carry it: a comment is not a `FeedItem` and its bytes are untouched.

## Validation

Test-first at the three existing seams: `feed-formats.test.ts` (one item, all three serialisers), `feed-item.test.ts` (the derivation) and `feeds.test.ts` (HTTP through `cms.app.request`). Red on 9 cases before any serialiser changed, then green. New cases: the three formats' readings of one post asserted against written-out expected values rather than against each other; the same post in all three formats when it carries a stored id; ETag stability across polls; an empty summary printing no element in Atom and no key in JSON.

Five mutations, each caught: Atom's `<id>` back to the permalink (2 failures), JSON's `id` back to the permalink (2), `isPermaLink` hardcoded false (2), Atom listing tags only (4), Atom always writing a summary (5).

**ETag, before and after** (same fixture, same content, a probe booting a real CMS):

| Feed | before | after |
| --- | --- | --- |
| `/feed/` | `35aad5e8…` | `5e8aafd1…` |
| `/feed/atom/` | `182760c2…` | `42f93b74…` |
| `/feed/json/` | `dd997c56…` | `fba8d168…` |
| `/comments/feed/` | `9e32f580…` | `9e32f580…` (unchanged) |

Two consecutive runs after the change produced identical values, so it moved once and is stable.

**Live bodies.** A probe wrote `/feed/`, `/feed/atom/`, `/feed/json/`, `/comments/feed/`, `/tag/releases/feed/` and `/category/engineering/feed/atom/` over a fixture holding one native post and one carrying `activitypub.id: https://example.com/?p=813`. `xmllint --noout` clean on all five XML bodies, `json.tool` clean on the JSON, and the reader is not vacuous — a copy with one broken attribute quote was reported. The native post: `guid isPermaLink="true"` = permalink, Atom `<id>` = permalink, JSON `id` = `url` = permalink. The migrated post: `guid isPermaLink="false"` = `?p=813`, Atom `<id>` = `?p=813`, JSON `id` = `?p=813` with `url` = the permalink. All three listed `engineering` then the tag, and all three summarised `Fish & chips, twice.` from a post that wrote no description. The probe was deleted afterwards.

`pnpm build`, `test` (1453 + 14), `test:11ty` (15), `typecheck`, `lint` and `format:check` all pass.

## A note on AC #7

Read as identity, it holds: a post carrying a stored id keeps the `guid` byte for byte, so the RSS subscribers decision-12 is about see nothing new, and Atom and JSON Feed now name it by the same stored id — which for a WordPress migration is the id that site's own Atom feed already gave it, since WordPress prints `the_guid()` as an entry's `<id>`.

Read as bytes it cannot hold for any post, migrated or not: AC #2 and AC #3 change every entry's terms and summary by design. Worth knowing: a site that already ran this CMS, with Atom or JSON subscribers to a post that carries a stored id, will see that one post re-appear once in those two feeds, because their id moves from the permalink to the stored id. That is the same one-time churn AC #1 accepts for RSS, in the other direction.

## Docs

The package README gained a "What every format says about a post" section stating the three rules once, and its RSS, Atom/JSON and caching sections now point at it instead of repeating the old per-format answers; the stale claim that the guid "is minted from the slug and written into the front matter on the first delivery" went with them. doc-3 gained the same three answers on the wire and a paragraph on the validator carrying the item revision.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-09-13 02:06
---
AC #5 is half done: doc-3 and the package README now describe the item's identity, but the commit itself is not mine to make — I was asked not to run git commit. Suggested message, for whoever lands it:

feat(cms)!: key every feed by the post's object id, with one set of terms and one summary

BREAKING CHANGE: RSS subscribers of a post born on this CMS see it once more as new. Its guid was the old {baseUrl}/ap/posts/{slug} object id and is now the permalink, marked isPermaLink="true"; a post carrying an activitypub.id keeps that guid, marked isPermaLink="false", so a migrated post's RSS subscribers see nothing new. Atom's entry id and JSON Feed's item id print the same object id rather than the permalink, which moves only a post carrying a stored id. All three formats now list the post's categories as well as its tags, and all three summarise with the description if there is one and an excerpt of the body if there is not. Every post feed's ETag moves once with the upgrade so a polling reader is not handed a 304 that hides the change.

Also worth a second opinion before landing: AC #7 says a post carrying a stored id changes in no feed. That holds for RSS byte for byte, and Atom/JSON now name such a post by the id WordPress's own Atom feed gave it. But a site that already ran this CMS and has Atom or JSON subscribers to a post with a stored id will see that one post re-appear there once, since its id moves from the permalink to the stored id. AC #1 requires exactly that, so the two criteria can only both hold under the migration reading. Implementation notes have the detail.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
One identity, one set of terms and one summary rule across RSS, Atom and JSON Feed (decision-12, read with decision-13). FeedItem lost the two redundant pairs it still carried: categories and tags became one terms list, description went because summary is always populated. RSS's guid now says isPermaLink="true" when the object id is the permalink and "false" for a stored id; Atom's <id> and JSON Feed's id print that same object id while the permalink stays the link in all three; Atom and JSON list every term; all three summarise with the description, else an excerpt. FEED_ITEM_REVISION joins each post feed's ETag label so the upgrade moves the validator once rather than leaving a polling reader a 304 that hides the new bytes.

Verified test-first at the three existing seams — 9 cases red before any serialiser changed, then green — with five mutations each caught (Atom id, JSON id, isPermaLink, Atom terms, Atom summary). A probe over a real CMS holding one native and one migrated post showed the three ETags moving exactly once and staying put, the comments feed untouched, and both posts rendered as decision-12 asks in all three formats; xmllint --noout clean on five XML bodies and not vacuous against a damaged copy, with the strict XML reader parsing every body inside the tests. pnpm build, test (1453 + 14), test:11ty (15), typecheck, lint and format:check all pass. doc-3 and the package README rewritten to state the three rules once.

AC #5 is left unchecked: its doc half is done, its commit half is the commit that lands this, and a suggested feat(cms)! message with the BREAKING CHANGE footer is in a comment on this task.
<!-- SECTION:FINAL_SUMMARY:END -->
