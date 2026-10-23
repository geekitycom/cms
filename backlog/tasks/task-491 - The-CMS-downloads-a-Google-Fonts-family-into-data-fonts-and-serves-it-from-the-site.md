---
id: TASK-491
title: >-
  The CMS downloads a Google Fonts family into data/fonts and serves it from the
  site
status: To Do
assignee: []
created_date: '2026-10-23 02:13'
labels:
  - fonts
  - privacy
milestone: m-46
dependencies: []
references:
  - packages/cms/src/files/data-files.ts
  - packages/cms/src/web/asset-routes.ts
  - packages/cms/src/theme/assets.ts
  - 'https://developers.google.com/fonts/docs/css2'
ordinal: 416800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: a chosen Google Font is hosted by the site so a reader never contacts Google. Given a family and the styles a role needs, the CMS fetches the CSS2 API stylesheet with a WOFF2 user agent, downloads every file it lists (all unicode-range subsets), and writes a local @font-face stylesheet that points at same-origin URLs. A family or style Google does not have is refused with a message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A font store fetches `https://fonts.googleapis.com/css2?family=<family>:ital,wght@<styles>&display=swap`, downloads the listed WOFF2 files from fonts.gstatic.com through the CMS fetch helper (timeouts, size cap, https only), and writes them with a generated stylesheet under data/fonts/<family-slug>/ atomically
- [ ] #2 Only fonts.googleapis.com and fonts.gstatic.com are contacted; URLs in the returned CSS on any other host are refused
- [ ] #3 A family Google does not have, or a requested style it lacks, yields a typed refusal naming what is missing; nothing is written
- [ ] #4 data/fonts/** is declared rebuildable under decision-55 with a lost sentence, so exports skip it
- [ ] #5 The files are served at a same-origin path with the fingerprinted, immutable caching other assets get, the right content types, and a 404 for anything not in the store
- [ ] #6 Fetching the same family and styles again is a no-op when the files are present; a job can refetch a family whose files are missing
- [ ] #7 Tests run against a stubbed Google (no network) and cover success, an unknown family, a missing style, a foreign host in the CSS and a refetch; docs/public-site.md or docs/settings.md notes that saving a font needs outbound HTTPS from the server
<!-- AC:END -->
