---
id: TASK-193
title: Homepage h-card is the site's representative h-card
status: To Do
assignee: []
created_date: '2026-10-01 17:01'
updated_date: '2026-10-01 17:04'
labels:
  - indieweb
  - microformats
  - theme
milestone: m-27
dependencies:
  - TASK-192
references:
  - packages/cms/themes/default/partials/bio.njk
  - packages/cms/themes/default/layouts/home.njk
  - packages/cms/themes/default/layouts/front-page.njk
  - 'https://microformats.org/wiki/representative-h-card-parsing'
priority: medium
type: bug
ordinal: 209800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a solo-author site the homepage shows the author's bio h-card, but its u-url is the author archive (/author/a/ on shll.me), not the homepage. The representative h-card algorithm picks the h-card whose u-url (and ideally u-uid) equals the page URL, or one whose u-url matches a rel=me link, so a parser reading https://shll.me/ may find no representative h-card. IndieAuth clients, IndieMark level 2 checks and reply-context fetchers on other sites read it to show who the site is. On the homepage of a solo-author site, give the bio h-card u-url and u-uid equal to the site URL, keeping the link to the author archive (rel=author) as a plain link or an extra u-url. Other pages keep today's markup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a solo-author site the homepage's bio h-card has u-url and u-uid equal to the homepage URL, for both a listing homepage and a static front page
- [ ] #2 A microformats2 parser run on the homepage with the representative h-card algorithm returns that h-card with name, url and photo
- [ ] #3 The author archive link and rel=me links still appear, and other pages' h-cards are unchanged
<!-- AC:END -->
