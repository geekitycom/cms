---
id: TASK-180
title: 'Solo author setting: the homepage speaks for the site author'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 02:16'
updated_date: '2026-10-01 14:08'
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
- [x] #1 Settings > General has a Solo author blog switch, stored with the other general settings, off by default for new sites and documented in README
- [x] #2 With it on, the homepage shows the site author's bio card on both a post-listing homepage and a static front page
- [x] #3 With it on, the homepage carries the site author's rel="me" profile links and a rel="me" link to their author archive, and the author archive carries rel="me" back to the homepage; a Mastodon profile link to the homepage verifies
- [x] #4 With it off, a post-listing homepage shows no bio card and neither page makes the rel="me" claims between homepage and author archive
- [x] #5 The homepage's JSON-LD names the site author as the person the site is about only when the switch is on
- [x] #6 Switching it on for an existing site whose static front page already shows a bio changes nothing a reader sees there, proven by a test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Settings: add soloAuthor (boolean, default false) to SiteSettings, read/written as site.json soloAuthor, submitted as solo_author, shown as a checkbox on Settings > General; README Site settings names it.
2. Render context: render.ts puts soloAuthor (the site author's profile) on every page's context when site.json has soloAuthor true and the author setting resolves to a user; absent otherwise. One object the theme asks about, and the server-side fact TASK-157 will read.
3. Theme: bio.njk gains bioRelMe (default true); false prints rel="author" and strips me from the profile links. front-page.njk bios soloAuthor or siteAuthor, with bioRelMe only when soloAuthor. home.njk at the root prints the bio when soloAuthor. base.njk gives the header home link rel="me" on the solo author's own archive. jsonld.njk adds WebSite about -> Person on the homepage only when soloAuthor.
4. Tests first (tdd): admin switch round trip and default; listing and front-page homepages with switch on/off (bio, rel=me profile links, rel=me to archive, archive rel=me back); JSON-LD about; AC6 visible-text equality of the front page with switch off vs on.
5. Docs: README Site settings, theme README (context key, bio, structured data).
6. Verify: pnpm build/test/typecheck/lint/format:check, curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: SiteSettings.soloAuthor (boolean, default false, site.json soloAuthor, form solo_author). render.ts puts soloAuthor (the site author's AuthorContext) on every page's context when the switch is on and the author setting resolves to a user; absent otherwise. The theme reads only that key.
Decision: with the switch off, a static front page still prints its bio card (AC #6 keeps what a reader sees) but makes no claims. bio.njk takes bioRelMe=false, which links the name rel="author" alone and strips me from the profile links. This is a behaviour change for existing sites with a static front page: their homepage stops carrying rel="me" until they turn the switch on, so a Mastodon field pointing at the homepage would lose its verification on its next recheck.
The archive claims the homepage back via rel="me" on the header's home link, which changes nothing visible. JSON-LD: WebSite gains about -> the site author's #person on the homepage only, when the switch is on.
Mastodon verification is proven by the shape Mastodon checks (an a rel="me" to the profile URL on the linked page), not against a live Mastodon instance.
Validation: pnpm build, pnpm test (2808 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all clean. Curled a scratch site on :3917: on, / has the h-card, rel="author me" to /author/ada/, rel="me" to the Mastodon link and WebSite about; /author/ada/ has header-link-home rel="me". Off, / has none of those and the archive's home link has no rel. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a Solo author blog switch to Settings > General (site.json soloAuthor, off by default, documented in README and the theme README). On, the homepage carries the site author's bio card on both a post listing and a static front page, their rel="me" profile links and a rel="me" link to their archive; the archive's home link carries rel="me" back; the homepage's JSON-LD WebSite names them as about. Off, a listing homepage prints no bio and the static front page keeps its card without any rel="me" claims. Verified by src/web/solo-author.test.ts (13 cases, 5 failing before the change), the General settings round-trip test, the full suite, and curl against a running site in both states.
<!-- SECTION:FINAL_SUMMARY:END -->
