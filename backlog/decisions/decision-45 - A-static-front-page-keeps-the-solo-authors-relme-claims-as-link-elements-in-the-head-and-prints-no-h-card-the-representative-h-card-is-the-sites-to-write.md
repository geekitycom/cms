---
id: decision-45
title: >-
  A static front page keeps the solo author's rel=me claims as link elements in
  the head and prints no h-card; the representative h-card is the site's to
  write
date: '2026-10-10 10:52'
status: accepted
---
## Context

On a solo author site (decision-25), TASK-180 and TASK-193 made the static
front page print the site author's bio card. The card carried their rel="me"
profile links, a rel="me" link to their author archive, and `bioHome`, which
made it the homepage's representative h-card. Mastodon verification,
rel="me" sign-in and the root as IndieAuth identity (decision-23) all read the
homepage. Removing the bio from the front page (decision-44) would have
removed these claims too.

## Decision

The claims move to the head. On a solo author site, `layouts/base.njk` prints
`<link rel="me">` at the root path, once for the author archive and once for
each of the author's profile links. They sit outside every block, so the
claims stay whatever front-page.njk a site writes.

A static front page prints no h-card, hidden or visible. A site that wants a
representative h-card writes one in its homepage's words, or includes
`partials/bio.njk` with `bioAuthor = soloAuthor` and
`bioHome = "/" | absoluteUrl` in its override, as the theme README shows. The
JSON-LD WebSite `about` and `publisher` are unchanged. A listing homepage
keeps its bio card.

## Consequences

- A Mastodon profile that links the homepage still verifies, because Mastodon
  reads `link[rel~=me]`. The homepage and the author archive still name each
  other. IndieAuth discovery is unaffected.
- A parser looking for the homepage's representative h-card finds none on a
  default static front page until the site writes one.
- A listing homepage carries the claims twice, in the head and in the bio,
  which does no harm.
- Supplements TASK-180 and TASK-193.
