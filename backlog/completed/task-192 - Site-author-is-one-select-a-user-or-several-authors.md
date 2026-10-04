---
id: TASK-192
title: 'Site author is one select: a user, or several authors'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 16:45'
updated_date: '2026-10-01 21:26'
labels:
  - settings
  - admin
  - indieauth
milestone: m-27
dependencies:
  - TASK-180
references:
  - packages/cms/themes/default/partials/jsonld.njk
priority: medium
type: feature
ordinal: 208800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Settings > General has a free-text Author field and a separate Solo author blog checkbox (TASK-180). Nothing on the screen ties them together, and the switch only takes effect when the free text happens to equal a user's username or display name (userForAuthor). Both the demo (author "Joe Blog", user ada) and shll.me (author "Andrew", user a / Andrew Shell) were saved with the switch on and no visible effect: no bio, no rel="me", and the root is not an IndieAuth identity.

Replace both controls with one select, Site author, whose options are each user by display name and "Several authors". site.json stores the chosen username in author and drops soloAuthor: a username means a solo-author site, no author means several authors. Every reader of site.author that prints a name (footer, Atom author, JSON Feed authors, the RSS dc:creator fallback, the owner name in render.ts) resolves the username to the user's display name; the site title stands in where no author is set. render.ts, identity.ts and decision-23 read the solo author from author alone. The Eleventy example resolves the name the same way so a static build prints the same text.

Breaking: an existing site.json whose author matches a username or display name converts to that user on load or first save; one that matches nobody becomes Several authors, and its feeds show the site title instead of the old free-text name. Record the shape in a decision and amend decision-23.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings > General has one Site author select listing each user by display name plus Several authors, and no free-text author field or Solo author checkbox
- [x] #2 Choosing a user shows that user's bio and rel="me" links on the homepage and makes the root their IndieAuth identity; choosing Several authors shows neither
- [x] #3 site.json stores the username in author and no soloAuthor key; a site with no author is a several-authors site
- [x] #4 The footer, Atom, JSON Feed and RSS print the user's display name, never the username, and the site title when no author is set
- [x] #5 An existing site.json whose author matches a username or display name keeps working as that user; one that matches nobody renders as Several authors, and the change is documented as breaking
- [x] #6 The Eleventy example config prints the same author name as the CMS
- [x] #7 decision-23 is amended and the new site.json shape is recorded as a decision
- [x] #8 A feed item whose post stores a username as its author prints that user's display name (shll.me's JSON Feed items currently show "a"), in feed-item.ts and the JSON Feed
- [x] #9 The default theme's JSON-LD follows the choice: with a user chosen, the WebSite's publisher and about reference that user's Person; with Several authors, the publisher is an Organization named for the site, there is no about, and no Person node is printed on pages about nobody in particular
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: site.json author holds a username; no author means Several authors; soloAuthor is gone from SiteSettings, siteJsonFor (which also deletes a stored soloAuthor key and omits an empty author) and the form.
2. authors.ts: authorName(users, author) prints a user's display name (else username, else the raw string); siteAuthorName(users, site) is the site author's display name or the site title. userForAuthor stays the one resolver, so a legacy display name keeps resolving (AC #5).
3. Settings > General: replace the Author text field and Solo author checkbox with one Site author select (users by display name + Several authors). shown and reads normalise a legacy value through userForAuthor, so the first save writes the username.
4. render.ts: soloAuthor = siteAuthorContext(users, site.author); the share-image owner falls back to the title. identity.ts drops the soloAuthor flag.
5. Feeds: FeedSource carries users; Atom/JSON Feed/RSS print siteAuthorName for the feed and authorName for each item and the dc:creator fallback; the feed fingerprint hashes the printed names.
6. Default theme: footer and article:author print soloAuthor.name or the site title; JSON-LD WebSite publisher/about reference the solo author's Person, else publisher is an Organization named for the site and no about. Demo theme and demo site.json follow.
7. Eleventy example: a soloAuthor global read from data/users.json by the same rule; the fixture build prints the same name.
8. Decisions: new decision for the site.json author shape; amend decision-23. README/docs note the breaking change.
9. Tests first for each AC, then pnpm build/test/typecheck/lint/format:check and curl a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found 2026-10-01: posts store the author's username, and feed-item.ts / feed-json.ts print document.author raw, so shll.me's JSON Feed lists items by "a" rather than "Andrew Shell". Same resolve-the-username fix as the site author.

Built 2026-10-01.
- Shape: site.json author is a username or absent (several authors); soloAuthor is gone from SiteSettings and siteJsonFor deletes a stored key. userForAuthor stays the one resolver, so an old display name still names its user (AC #5).
- New helpers in src/web/authors.ts, exported from the package: authorName(users, author) prints a user's display name, else username, else the stored string; siteAuthorName(users, site) prints the site author's display name, else the site title.
- General page: Site author select (users by display name + Several authors). shown/reads normalise through userForAuthor, so the select shows a legacy display name as that user and a save writes only a username or no key.
- render.ts: soloAuthor on the context is siteAuthorContext(users, site.author), on every page. Share-image alt falls back to the title. identity.ts reads author alone.
- Feeds: FeedSource and FeedItemContext carry users; item.creator is now always set (author, else site author, else title). FEED_ITEM_REVISION 5 -> 6; the feed fingerprint hashes the printed names so a display-name change moves the ETag.
- Default theme: footer prints soloAuthor.name or site.title; article:author no longer falls back to site.author. JSON-LD: WebSite publisher and about = site author's Person on every page (was about only at /); several authors = Organization at {baseUrl}/#organization publishing the WebSite and entries, no about.
- Eleventy example: soloAuthor global read from data/users.json (GEEKITY_DATA_DIR) by the same rule; fixture page.njk prints it.
- Demo site.json drops author Joe Blog (demo users are untracked) and the starter template drops author You: both are several-authors sites.
- decision-25 created with backlog decision create; the CLI has no command to write a decision body or amend one (backlog decision --help lists create and list only), so the decision-25 body and the decision-23 amendment were edited by hand.
- Verified: pnpm build && pnpm test (3079 + 30 demo) && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:11ty all pass. Curled a scratch copy of the demo on :3917: select lists Several authors / Ada Lovelace / grace; saving ada wrote author ada with no soloAuthor; footer, Atom, JSON Feed print Ada Lovelace; homepage has the bio card and rel="author me" to /author/ada/; JSON-LD WebSite publisher and about = ada#person. Legacy author "Ada Lovelace"+soloAuthor resolved to Ada; "Joe Blog" rendered as Several authors with the site title. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Site author is one select on Settings > General: each user by display name, or Several authors. site.json stores the username in author, or no author for several authors; soloAuthor is gone. Every name printer resolves through userForAuthor: footer, Atom, JSON Feed, RSS dc:creator and feed items print display names (authorName/siteAuthorName in src/web/authors.ts), with the site title where nobody is named. The homepage bio, rel=me claims and IndieAuth root follow author alone. Default theme JSON-LD: WebSite publisher/about reference the site author's Person, or an Organization named for the site with several authors. The Eleventy example exposes the same soloAuthor. Breaking: a free-text author that names nobody becomes several authors and its feeds show the site title. decision-25 records the shape; decision-23 amended. Verified with the full pnpm gate (build, test, typecheck, lint, format:check, test:11ty) and curl against a scratch demo.
<!-- SECTION:FINAL_SUMMARY:END -->
