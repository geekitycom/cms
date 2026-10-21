---
id: TASK-456
title: The dashboard lists Umami top pages and referrers
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
updated_date: '2026-10-21 04:12'
labels:
  - plugins
  - umami
  - dashboard
milestone: m-42
dependencies:
  - TASK-454
  - TASK-444
priority: medium
ordinal: 393800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two ranked lists for the last 7 days: top pages and top referrers. A page path that matches a post links to that post in the editor, which ties traffic back to content.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Top pages lists the ten most viewed paths with views, and a path that matches a post shows the post title and links to its editor
- [x] #2 Top referrers lists the ten biggest referring domains with visitors, and the site own domain is left out
- [x] #3 Both lists handle an empty week with a short empty state
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Plugin: move daysEnding/rangeOf (with dayIn, midnightIn, addDays) from src/traffic.ts to src/period.ts; traffic.ts imports them.
2. Research: Umami 3 /metrics counts distinct sessions (visitors) for every type, path included; referrer is referrer_domain (a host name) and Umami itself drops the website hostname without www. /metrics/expanded returns name, pageviews, visitors, visits per value, ordered by visitors. So top pages read /metrics/expanded?type=path (views per path), top referrers read /metrics?type=referrer (visitors per domain).
3. Core (feat(cms), separate commit): no plugin-facing way maps a path to a post (PluginSite and siteInfo have none; engagement lists only engaged posts). Add core service '@geekity/cms/posts' with byPath(paths) -> {path, permalink, title, editUrl}[]: path as asked, query/fragment dropped, base URL directory taken off, trailing slash added when missing, only served posts. Types in plugin.ts, CORE_SERVICES in registry, provideCore in cms/services.ts, test through a plugin widget on a real site, docs/plugins.md Core services.
4. Plugin client: expandedMetrics(type, range, {limit}) -> {value, pageviews, visitors}[]; fake Umami route websites/:id/metrics/expanded.
5. Plugin widgets: pagesWidget + referrersWidget in src/top.ts, two half-width cards after the traffic card. Pages: ten most viewed paths (fetch more than ten, sort by views), labels/links via byPath. Referrers: ten biggest referring domains by visitors, leaving out configured domains, the site URL host and www. variants. Empty period -> short paragraph. Follow context.period.
6. Docs: plugin README On the dashboard, package descriptions; tests per AC first; verify all gates + Chromium screenshots at 1280 and 390.

7. Revised after the screenshot: views of every path that leads to the same post (such as /hello/ and /hello?utm_source=x) are added up before ranking, so a post is listed once.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Period: both widgets follow context.period (7 by default, 30 with ?period=30); the ACs' 'last 7 days' is the 7-day view. daysEnding/rangeOf/dayIn/midnightIn now live in packages/plugin-umami/src/period.ts, shared by traffic.ts and top.ts.

Umami research (umami-software/umami master source): /metrics counts count(distinct session_id) for every type, the path too, so it gives visitors, not views. The referrer metric is referrer_domain (a host name, not a full URL), counted as distinct visitors, and Umami itself drops the website hostname without www. on Postgres (ClickHouse compares without stripping www.). /metrics/expanded returns name, pageviews, visitors, visits per value, ordered by visitors. So top pages read metrics/expanded?type=path&limit=100 and keep the ten with the most views; top referrers read metrics?type=referrer&limit=25 labelled 'Visitors per referring domain'. Umami 2 has no metrics/expanded; README says top pages need Umami 3.

Path -> post: no plugin-facing lookup existed (PluginSite, siteInfo and the engagement service cannot map an arbitrary path). Added core service '@geekity/cms/posts' byPath(paths) -> {path, permalink, title, editUrl}[] (packages/cms/src/admin/posts-by-path.ts, types in plugin.ts, CORE_SERVICES in registry.ts, provideCore in cms/services.ts, docs/plugins.md Core services). It drops query and fragment, takes the base URL directory off, tries the trailing-slash form, and lists only served posts (no pages, drafts, scheduled). No host API bump: the plugin's workspace:^ peer range moves with the unified release.

Layout: two half-width cards (Umami: top pages, Umami: top referrers) after the full-width traffic card, side by side at 1280 px, stacked at 390 px with no horizontal scroll (screenshots against the fake Umami: scratchpad/shot456/dash456-1280.png, dash456-390.png). Own domain left out of referrers: site URL host and each Domains entry, compared lower case without www.

Validation: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0 (cms 6514 pass, plugin-umami 79 pass). Proof is the fake Umami in packages/plugin-umami/test/fake-umami.ts; no live Umami was used.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added two half-width Umami dashboard cards after the traffic card, following the dashboard period. Top pages lists the ten pages with the most views (Umami metrics/expanded, since /metrics counts visitors), merging paths that lead to the same post and showing that post's title linked to its editor. Top referrers lists the ten referring domains with the most visitors, without the site URL host or the configured Domains (with or without www.). Each card says so when the period has no data. Path-to-post mapping is a new core service, @geekity/cms/posts byPath(), typed, tested and documented in docs/plugins.md. Period helpers moved to src/period.ts. Verified with plugin unit and site tests against the fake Umami, core service tests on a real site, all repo gates, and headless Chromium screenshots of /admin at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
