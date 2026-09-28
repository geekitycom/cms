---
id: TASK-148
title: Configurable robots.txt with AI-crawler rules and Content-Signal
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - seo
  - agents
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/seo/robots-txt/'
  - 'https://specification.website/spec/agent-readiness/robots-for-ai-crawlers/'
  - 'https://specification.website/spec/agent-readiness/content-signals/'
priority: medium
type: feature
ordinal: 172800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
robots.txt is fixed: it disallows /admin/ and names the sitemap. Site owners increasingly want to allow or block named AI crawlers (GPTBot, ClaudeBot, Google-Extended and others) and to declare Content-Signal preferences (search, ai-input, ai-train), and they have no way to do either.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A site can add robots.txt rules in config or settings, while the CMS always keeps the /admin/ disallow and the Sitemap line
- [ ] #2 The admin offers a simple AI-crawler policy (allow all, block training, block all) that writes the matching per-agent groups
- [ ] #3 Content-Signal directives can be set and are emitted in the documented syntax
- [ ] #4 The .md and .json alternates of HTML pages send X-Robots-Tag: noindex so they do not compete with the HTML in search results
<!-- AC:END -->
