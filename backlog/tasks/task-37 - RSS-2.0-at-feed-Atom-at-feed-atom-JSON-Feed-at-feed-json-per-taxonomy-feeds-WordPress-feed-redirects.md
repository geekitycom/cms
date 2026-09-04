---
id: TASK-37
title: >-
  RSS 2.0 at /feed/, Atom at /feed/atom/, JSON Feed at /feed/json/, per-taxonomy
  feeds, WordPress ?feed= redirects
status: To Do
assignee: []
created_date: '2026-09-04 00:31'
updated_date: '2026-09-04 00:31'
labels:
  - web
milestone: m-5
dependencies:
  - TASK-7
  - TASK-35
  - TASK-36
references:
  - backlog/docs/doc-3 - Content-Negotiation.md
  - 'https://andrewshell.org/feed/'
  - 'https://www.rssboard.org/rss-specification'
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the `/feed.xml` and `/feed.json` routes with the WordPress layout that https://andrewshell.org/ serves, so subscribers of a migrated site keep working. `/feed/` is RSS 2.0, the format nearly every existing subscriber holds: channel `title`, `link`, `description` (tagline), `language`, `lastBuildDate`, `generator`, `atom:link rel="self"`, and an `image` from the avatar setting when one is set; each item carries `title`, `link`, `guid isPermaLink="false"` (the post's ActivityStreams object id, which is stable across renames), RFC 822 `pubDate`, `dc:creator` from the author setting, one `category` per category and per tag, `description` holding an excerpt (the `description` front matter, else the first paragraph of the rendered text, plain, truncated) and `content:encoded` holding the full HTML. `/feed/atom/` and `/feed/json/` serve what the two old routes serve now. Per-taxonomy feeds follow: `/{tagBase}/{tag}/feed/`, `/feed/atom/`, `/feed/json/` and the same under `/{categoryBase}/{slug}/`. The trailing-slash canonical redirect covers `/feed` and friends. WordPress's query forms redirect permanently the way the reference site does: `/?feed=rss2` and `/?feed=rss` to `/feed/`, `/?feed=atom` to `/feed/atom/`, and `/feed/rss/` to `/feed/`. A `language` setting (default `en`) feeds the channel and the Atom `xml:lang`; the feeds keep honouring `feedSize`. The base layout advertises all three with `rel="alternate"`, RSS first. There are no production deployments, so the old `/feed.xml` and `/feed.json` are dropped without redirects. Update doc-3's feeds section, the theme README and the package README.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /feed/ validates as RSS 2.0 with the channel and item elements listed in the description, full HTML in content:encoded and an excerpt in description; a validator such as the W3C feed validator or a strict parser accepts it
- [ ] #2 /feed/atom/ and /feed/json/ serve exactly what /feed.xml and /feed.json served, and those two old paths are gone
- [ ] #3 Per-tag and per-category feeds exist in all three formats under the configured bases, 404 for an unknown term
- [ ] #4 /feed, /feed/atom and /feed/json redirect 301 to their slashed forms, and /?feed=rss2, /?feed=rss, /?feed=atom and /feed/rss/ redirect 301 to the matching new feed
- [ ] #5 The HTML layout advertises RSS, Atom and JSON Feed with link rel=alternate, RSS first, and a post page keeps its ActivityStreams alternate
- [ ] #6 Drafts and trashed posts never appear in any feed and feedSize still caps every feed
<!-- AC:END -->
