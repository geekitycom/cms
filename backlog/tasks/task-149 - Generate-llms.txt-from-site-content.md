---
id: TASK-149
title: Generate /llms.txt from site content
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - agents
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/agent-readiness/llms-txt/'
  - 'https://specification.website/spec/agent-readiness/link-headers/'
priority: low
type: feature
ordinal: 173800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CMS already serves every document as Markdown (.md or Accept: text/markdown), which is what agents want. There is no /llms.txt index that points them at it. A generated llms.txt (site name, tagline, and the key pages and recent posts linked to their .md URLs) is cheap to produce from the content index.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /llms.txt is served as text/markdown and lists the site title, description, pages and recent posts, each linked to its .md URL
- [ ] #2 It is advertised with a Link header and a link element on the home page
- [ ] #3 It has validators and 304 support like the sitemap
- [ ] #4 A site can turn it off, or replace it with its own file
<!-- AC:END -->
