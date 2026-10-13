---
id: TASK-388
title: >-
  Settings registry wave 3a: the site namespace is declared and every reader
  moves to the registry
status: To Do
assignee: []
created_date: '2026-10-13 16:45'
labels: []
milestone: m-38
dependencies:
  - TASK-386
references:
  - >-
    backlog/decisions/decision-53 -
    One-settings-registry-over-namespaced-files-declarations-overrides-migration-and-the-CLI.md
priority: medium
type: feature
ordinal: 347800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 section 7 (wave 3) moves content/_data/site.json onto the registry as the `site` namespace: the 48 rows of site/setting-rows.ts become setting declarations with fileKey where the file spelling differs (url, postsPerPage and so on), so the file does not change. SiteSettings becomes the namespace's values type. This task is the read side: readSiteSettings and its 43 callers move to `settings.values(SITE)` or `settings.get`, and the sync-only chains named in the record are redesigned rather than awaited in place: the sync Renderer takes a site snapshot its handler awaited, settleConfig moves into serve(), host.siteInfo() returns a Promise (a plugin API break, released as a major together with wave 4), relays.sync() and the reply-notice listener become fire-and-forget async, and IndieAuth and Micropub read the settled config.baseUrl. The write side (pages saving through `set`) is the next task; readSiteSettings and readSiteJson are deleted here, updateSiteSettings is deleted there.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The `site` namespace declares every current SiteSettings key with type, default, fileKey, description and check; `site.base_url` declares override from config.baseUrlSource; a site.json written today reads back as the same SiteSettings values, shown by a test over the demo site.json and over each row's existing read tests
- [ ] #2 Every non-test caller of readSiteSettings and readSiteJson reads through the registry; both functions are deleted
- [ ] #3 The Renderer API stays synchronous and receives the site values as an input from its async caller; no file under web/render.ts or web/page-sources.ts reads the registry
- [ ] #4 host.siteInfo() returns Promise<PluginSiteInfo>; both published plugins that call it are updated in the same PR; the change is marked breaking in the commit
- [ ] #5 settleConfig runs inside the async serve() and createCms stays synchronous; cms/boot.ts no longer reads site.json synchronously
- [ ] #6 keys the namespace does not declare (feedSize, anything a site added) survive a write unchanged, shown by a test
- [ ] #7 pnpm lint, typecheck and test pass
<!-- AC:END -->
