---
id: decision-12
title: Every feed keys a post by its ActivityStreams object id
date: '2026-09-05 13:08'
status: accepted
---
## Context

The 2026-09-05 architecture review found that the three post feeds derive their items independently and disagree about identity: RSS 2.0 printed the post's ActivityStreams object id as `guid` (then `{baseUrl}/ap/posts/{slug}`), while Atom's `<id>` and JSON Feed's `id` printed the permalink. A feed reader keys items by that value, so the two rules meant two notions of "the same post". TASK-63 introduces one feed item derived per post, which forces one answer.

decision-13, taken the same day, makes the post's ActivityStreams object id its permalink. That removes the disagreement at its source: there is one identity for a post, and it is the URL a reader visits.

## Decision

Every feed keys a post by its ActivityStreams object id, which per decision-13 is its permalink, absolute on the site's base URL, or the stored id a migrated post carries. The permalink is always the item's link. Atom `<id>` and JSON Feed `id` print the object id; RSS `guid` prints it with `isPermaLink="true"` when it is the permalink and `isPermaLink="false"` when it is a stored id. A post migrated from WordPress therefore keeps the `?p=813` guid WordPress's own RSS gave it, so its subscribers see nothing new.

Alongside it, the other two disagreements the review found are settled the same way: every format lists the post's categories and its tags as its terms, and every format's summary is the document's description when it has one, else an excerpt of the HTML.

## Consequences

- RSS subscribers of a post born on the CMS see it once more as new after the upgrade, because the `guid` they keyed it by has changed; Atom and JSON Feed subscribers see nothing, and migrated posts change in no feed. This lands as `feat(cms)!` with a `BREAKING CHANGE:` footer saying so (TASK-64), in the same release as decision-13's change (TASK-65).
- The feed item, the ActivityStreams object and the page share one identity, so a reader that follows the site both ways can tell they are the same thing.
- The identity of a comment in the comments feeds is untouched: it is the comment's own id, as TASK-39 and doc-6 already have it.
