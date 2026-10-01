---
id: TASK-192
title: 'Site author is one select: a user, or several authors'
status: To Do
assignee: []
created_date: '2026-10-01 16:45'
updated_date: '2026-10-01 16:45'
labels:
  - settings
  - admin
  - indieauth
dependencies:
  - TASK-180
references:
  - packages/cms/admin/pages/settings/general.njk
  - packages/cms/src/admin/settings-general.ts
  - packages/cms/src/web/authors.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/indieauth/identity.ts
  - packages/cms/docs/eleventy.config.example.js
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
- [ ] #1 Settings > General has one Site author select listing each user by display name plus Several authors, and no free-text author field or Solo author checkbox
- [ ] #2 Choosing a user shows that user's bio and rel="me" links on the homepage and makes the root their IndieAuth identity; choosing Several authors shows neither
- [ ] #3 site.json stores the username in author and no soloAuthor key; a site with no author is a several-authors site
- [ ] #4 The footer, Atom, JSON Feed and RSS print the user's display name, never the username, and the site title when no author is set
- [ ] #5 An existing site.json whose author matches a username or display name keeps working as that user; one that matches nobody renders as Several authors, and the change is documented as breaking
- [ ] #6 The Eleventy example config prints the same author name as the CMS
- [ ] #7 decision-23 is amended and the new site.json shape is recorded as a decision
- [ ] #8 A feed item whose post stores a username as its author prints that user's display name (shll.me's JSON Feed items currently show "a"), in feed-item.ts and the JSON Feed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found 2026-10-01: posts store the author's username, and feed-item.ts / feed-json.ts print document.author raw, so shll.me's JSON Feed lists items by "a" rather than "Andrew Shell". Same resolve-the-username fix as the site author.
<!-- SECTION:NOTES:END -->
