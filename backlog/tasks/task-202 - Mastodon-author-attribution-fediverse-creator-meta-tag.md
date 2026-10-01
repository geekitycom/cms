---
id: TASK-202
title: 'Mastodon author attribution: fediverse:creator meta tag'
status: To Do
assignee: []
created_date: '2026-10-01 17:13'
updated_date: '2026-10-01 17:20'
labels:
  - federation
  - theme
  - seo
milestone: m-27
dependencies:
  - TASK-192
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/federation/actor.ts
  - 'https://blog.joinmastodon.org/2024/07/highlighting-journalism-on-mastodon/'
priority: medium
type: feature
ordinal: 218800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a post is shared on Mastodon, the link preview can name the author's fediverse account with a follow link, if the page carries <meta name="fediverse:creator" content="@user@host"> and the account lists the site's domain under author attribution in its Mastodon profile. Print that tag in the head of every post and page whose author resolves to a user, naming the user's own actor handle on this site (@username@host, from WebFinger), and on the homepage of a solo-author site. Document in the README that the owner must add the domain under Settings > Public profile > Verification > Author attribution in their Mastodon account (or the account they want credited).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post by a user carries <meta name="fediverse:creator"> with that user's @username@host handle; a page about nobody in particular carries none
- [ ] #2 The handle matches what WebFinger answers for the user
- [ ] #3 The README explains the Mastodon-side author attribution setting
- [ ] #4 Sharing a post on a Mastodon instance whose account lists the domain shows the author attribution in the preview card, or the notes record what was checked
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: after TASK-192. The tag on a solo-author homepage names the site author, which TASK-192 changes from a free-text name to a username; build on the new shape.
<!-- SECTION:NOTES:END -->
