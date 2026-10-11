---
id: TASK-345
title: 'The homepage is named and served at / in every representation, not only HTML'
status: To Do
assignee: []
created_date: '2026-10-11 13:38'
labels:
  - public-site
dependencies:
  - TASK-343
references:
  - packages/cms/src/web/routes.ts
priority: medium
type: bug
ordinal: 304800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on shll.me (v0.30.0), whose homepage is the About page. The HTML form knows the page is the homepage: /about/ answers 301 to /. The other representations do not:
- https://shll.me/index.md has front matter `permalink: /about/`, a URL that redirects; the HTML version names the page /.
- /about/index.md and /about/index.json answer 200 with the page, so the homepage is served at two URLs per representation.
- /about.md answers 301 to /about/index.md, which then answers 200, instead of one 301 to /index.md.

Every representation of the homepage should say it is /, and the page's own permalink should redirect to the root form of the same representation in one hop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /index.md and /index.json name the homepage by / (front matter permalink in Markdown, url in JSON), as the HTML does
- [ ] #2 /about/index.md, /about/index.json and /about.md each answer one 301 to /index.md or /index.json when that page is the homepage; /about/ still answers 301 to /
- [ ] #3 A page that is not the homepage keeps its URLs and redirects
- [ ] #4 Tests cover each representation; doc-3 and docs/public-site.md say so
<!-- AC:END -->
