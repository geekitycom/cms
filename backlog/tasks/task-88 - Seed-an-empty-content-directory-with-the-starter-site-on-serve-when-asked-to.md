---
id: TASK-88
title: 'Seed an empty content directory with the starter site on serve, when asked to'
status: To Do
assignee:
  - '@claude'
created_date: '2026-09-19 15:24'
labels:
  - content
  - infra
milestone: m-15
dependencies: []
references:
  - packages/cms/src/init.ts
  - packages/cms/src/cli.ts
  - packages/cms/templates/site
type: feature
ordinal: 113800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Docker image mounts content/ from the host, and on a new box that volume is empty. Rather than boot a site with no site.json and nothing to show, the image should start from the same starter site `geekity init` writes (templates/site/content: site.json, a hello-world post, an about page, the collection data files), after which the first-run setup screen creates the admin. Make this a behaviour of `geekity serve`, switched on by an environment variable (for example GEEKITY_SEED_CONTENT=true) or a config option, so the image can turn it on while a site run from npm keeps today’s behaviour of never writing content it was not asked to. A directory counts as empty when it is missing or has no entries at all; anything else, even a lone dotfile, is left untouched, so a mounted site is never overwritten. The seeded site.json takes its url from the resolved base URL so the settings screen shows the real address. Seeding reuses the code `geekity init` already copies with rather than a second copy of the template. It logs one line saying it seeded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With seeding on and a missing or empty content directory, serve writes the starter content and then boots, proven by a test
- [ ] #2 With seeding on and a content directory that has any entry, nothing is written or changed, proven by a test
- [ ] #3 With seeding off, which is the default, serve writes nothing to an empty content directory
- [ ] #4 The seeded site.json url is the resolved base URL
- [ ] #5 Seeding and `geekity init` share one copy routine and one template
- [ ] #6 The README documents the switch in the configuration table
<!-- AC:END -->
