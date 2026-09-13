---
id: TASK-81
title: >-
  Head: description, Open Graph and Twitter card tags, icons from the site
  avatar, and one JSON-LD graph from a partial
status: To Do
assignee: []
created_date: '2026-09-13 13:36'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-80
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/media
  - /Users/andrewshell/code/wordpress/asdo-theme/functions.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 106800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The source theme emits, in the head of every page, a meta description, Open Graph tags (title, description, url, type website or article, site_name, image), Twitter card tags (summary card with title, description, image), icon links and one JSON-LD graph (decision-16). Add the same to the default theme. The description is the page description or the entry summary (TASK-79), else the tagline. The image is the entry image when the front matter names one, else the site avatar. Icon links (icon at 32 and 16, apple-touch-icon at 180) come from the site avatar through the image variants the media module already derives (decision-10), and are omitted when the site has no avatar; a web manifest is not needed. JSON-LD lives in partials/jsonld.njk, included from the base head block, and prints one @graph: WebSite with the SearchAction only once search exists, Person from siteAuthor (name, url, image, description, jobTitle, address, sameAs from the links and the actor id), ProfilePage on an author archive, BlogPosting on a post and Article on a page with headline, url, mainEntityOfPage, datePublished, dateModified, description, image, author and publisher pointing at the Person. Nothing is printed for a Person when there is no siteAuthor. No Microdata anywhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every page has a meta description, og:title, og:description, og:url, og:type (article on a post or page, website elsewhere), og:site_name, og:image, twitter:card summary, twitter:title, twitter:description and twitter:image, with the description and image chosen by the rules in the description
- [ ] #2 With a site avatar, the head links icon 32x32, icon 16x16 and apple-touch-icon 180x180 to derived variants that answer 200 as image/png; without one, no icon links are printed and nothing 404s
- [ ] #3 partials/jsonld.njk prints one script of type application/ld+json whose @graph holds WebSite and Person on every page, adds ProfilePage on an author archive and BlogPosting or Article on a post or page, and validates as JSON; with no siteAuthor the Person and the author and publisher references are absent
- [ ] #4 No itemscope, itemtype or itemprop attribute appears in any packaged template
- [ ] #5 A site theme that ships its own partials/jsonld.njk replaces the graph, proven by a test; themes/default/README.md documents the partial and the meta rules
<!-- AC:END -->
