---
id: TASK-210
title: 'Actors publish attributionDomains so Mastodon credits fediverse:creator'
status: To Do
assignee: []
created_date: '2026-10-01 21:47'
labels:
  - federation
  - activitypub
milestone: m-27
dependencies:
  - TASK-202
references:
  - packages/cms/src/federation/actor.ts
  - 'https://blog.joinmastodon.org/2024/07/highlighting-journalism-on-mastodon/'
priority: medium
type: feature
ordinal: 226800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-202 prints <meta name="fediverse:creator" content="@username@host"> naming the user's own actor on this site. Mastodon shows the author credit in a link preview only when the named account's actor lists the link's domain in attributionDomains (read in ActivityPub::ProcessAccountService#set_immediate_attributes!). Geekity's actors do not publish that property, and Fedify's Person has no typed field for it, so the tag currently has no visible effect. Publish attributionDomains: [the site's host] on every user's actor, extending the actor JSON-LD (with the toot: context term) so Mastodon parses it. Then TASK-202's AC #4 can be checked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every user's actor JSON carries attributionDomains containing the site's host, with a @context that maps the term the way Mastodon reads it
- [ ] #2 A remote Mastodon instance that fetches the actor stores the domain as an attribution domain (or the notes record what was checked)
- [ ] #3 Sharing a post link on Mastodon shows the author credit card, and TASK-202 AC #4 is checked
<!-- AC:END -->
