---
id: TASK-148
title: Configurable robots.txt with AI-crawler rules and Content-Signal
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-10-01 12:44'
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
- [x] #1 A site can add robots.txt rules in config or settings, while the CMS always keeps the /admin/ disallow and the Sitemap line
- [x] #2 The admin offers a simple AI-crawler policy (allow all, block training, block all) that writes the matching per-agent groups
- [x] #3 Content-Signal directives can be set and are emitted in the documented syntax
- [x] #4 The .md and .json alternates of HTML pages send X-Robots-Tag: noindex so they do not compete with the HTML in search results
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the robots file out of web/sitemap.ts into a new web/robots.ts that models it as groups (user agents + rule lines). robotsTxt(baseUrl, policy?) and robotsResponse(baseUrl, conditional?, policy?) stay backward compatible for the package exports.
2. Three new site.json settings on the Reading page: aiCrawlers (allow | block-training | block-all), contentSignalSearch / contentSignalAiInput / contentSignalAiTrain ('' | yes | no), and robotsRules (extra robots.txt lines, a textarea, stored as an array of lines).
3. Every group the file carries, the CMS's own and the site's, gets Disallow: /admin/ unless it already disallows / or /admin/, so a crawler matched by a named group cannot escape the admin rule (RFC 9309 picks one group per crawler). The Sitemap line is always last. The form refuses a line that is not a robots.txt field, a rule above any User-agent line, and an Allow under /admin/. A hand-edited file drops such lines instead of failing.
4. AI policy groups: block-training writes one Disallow: / group per training agent (GPTBot, ClaudeBot, anthropic-ai, Google-Extended, Applebot-Extended, Bytespider, CCBot, meta-externalagent); block-all also blocks the retrieval agents (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User).
5. Content-Signal: the set signals are written as 'Content-Signal: search=yes, ai-input=yes, ai-train=no' in the * group and in every site group that is not fully disallowed and has none of its own.
6. representationResponse sets X-Robots-Tag: noindex on every non-HTML representation (the .md and .json alternates, by extension or by Accept).
7. Tests first for each AC: web/robots.test.ts over HTTP and admin/settings-reading.test.ts for the form. Then build, test, typecheck, lint, format:check, and curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. robots.txt moved from web/sitemap.ts to a new web/robots.ts that models the file as groups. Every group, the CMS's and the site's, carries Disallow: /admin/ (skipped when the group already disallows /) and the Content-Signal line (skipped when fully disallowed or the group has its own), because RFC 9309 gives a crawler only the one group that names it. Settings live on Settings > Reading under a new Crawlers heading and in site.json as aiCrawlers, contentSignalSearch/AiInput/AiTrain and robotsRules (array of lines). The form refuses non-robots lines, rules above any User-agent, and Allow under /admin/; a hand edit drops such lines. Comments in robotsRules are stored but not served. robotsTxt(baseUrl, policy?) and robotsResponse(baseUrl, conditional?, policy?) stay call-compatible for package consumers. X-Robots-Tag: noindex is set in representationResponse for every non-HTML representation, by extension or Accept; the anonymous-pages golden gained exactly that header on the .md and .json captures. AI crawler tokens: training list from specification.website plus meta-externalagent; retrieval list adds Perplexity-User, Claude-SearchBot and Claude-User to the spec's three. Docs: packages/cms/README.md, README.md, doc-3.
Validation: pnpm build, pnpm test (2716 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Curled a geekity init site served from dist on :3417 with block-training, signals and two custom groups: robots.txt served the * group with Content-Signal: search=yes, ai-input=yes, ai-train=no, eight Disallow: / training groups, SlowBot and Sneaky groups each with Disallow: /admin/ (Sneaky's Allow: /admin/ dropped), and the Sitemap line last. /2026/01/hello-world/index.md and index.json sent x-robots-tag: noindex; the HTML did not. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
robots.txt is now configurable. Settings > Reading gains a Crawlers section: an AI-crawler policy (allow all, block training, block all) that writes per-agent Disallow: / groups, three Content-Signal choices emitted as 'Content-Signal: search=yes, ai-input=yes, ai-train=no', and a textarea of extra robots.txt groups. The CMS keeps Disallow: /admin/ in every group and the Sitemap line last. The .md and .json representations of every page send X-Robots-Tag: noindex. Verified with new tests in src/web/robots.test.ts and src/admin/settings-reading.test.ts (written failing first), the full gate run, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
