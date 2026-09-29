---
id: TASK-180
title: 'Solo author setting: the homepage speaks for the site author'
status: To Do
assignee: []
created_date: '2026-09-29 02:16'
labels:
  - indieweb
  - settings
  - theme
milestone: m-24
dependencies: []
references:
  - 'https://indieweb.org/rel-me'
  - 'https://indieweb.org/representative_h-card'
priority: high
type: feature
ordinal: 204800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Settings > General names a site author, and a static front page already prints that person's bio card (themes/default/layouts/front-page.njk with partials/bio.njk: an h-card linked to /author/{username}/ with rel="author me", plus their rel="me" profile links). A homepage that lists posts (home.njk) shows no bio, and nothing says whether the homepage represents one person or a multi-author publication. Add a "Solo author blog" switch to Settings > General. When it is on, the homepage, whichever layout it uses, carries the site author's bio card, their rel="me" links (so a Mastodon profile link to the homepage verifies) and a rel="me" link to their author archive, and the author archive links back to the homepage with rel="me", so the two URLs are provably the same person. That is also what lets the homepage be an IndieAuth identity (TASK-157): someone on a solo blog can type the bare domain to sign in. When it is off, the homepage speaks for no one: no bio card on a listing homepage, no identity claims, and the root is not an IndieAuth identity. The bio still links to /author/{username}/, which stays the canonical author page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Settings > General has a Solo author blog switch, stored with the other general settings, off by default for new sites and documented in README
- [ ] #2 With it on, the homepage shows the site author's bio card on both a post-listing homepage and a static front page
- [ ] #3 With it on, the homepage carries the site author's rel="me" profile links and a rel="me" link to their author archive, and the author archive carries rel="me" back to the homepage; a Mastodon profile link to the homepage verifies
- [ ] #4 With it off, a post-listing homepage shows no bio card and neither page makes the rel="me" claims between homepage and author archive
- [ ] #5 The homepage's JSON-LD names the site author as the person the site is about only when the switch is on
- [ ] #6 Switching it on for an existing site whose static front page already shows a bio changes nothing a reader sees there, proven by a test
<!-- AC:END -->
