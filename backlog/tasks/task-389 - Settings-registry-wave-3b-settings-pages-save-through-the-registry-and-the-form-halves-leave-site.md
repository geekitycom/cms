---
id: TASK-389
title: >-
  Settings registry wave 3b: settings pages save through the registry and the
  form halves leave site/
status: To Do
assignee: []
created_date: '2026-10-13 16:45'
updated_date: '2026-10-13 22:09'
labels: []
milestone: m-38
dependencies:
  - TASK-388
references:
  - >-
    backlog/decisions/decision-53 -
    One-settings-registry-over-namespaced-files-declarations-overrides-migration-and-the-CLI.md
priority: medium
type: feature
ordinal: 348800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 section 7 (wave 3) and section 9. With the `site` namespace declared and every reader on the registry, the seven settings pages (General, Reading, Permalinks, Discussion, Email, Privacy, Federation) save through `settings.set` and keep their own templates, labels and layout. The submitted, shown and check halves of each row move from site/setting-rows.ts to admin/settings-fields.ts because they are form concerns. The carried machinery (CarriedField, CarriedSettings, onFile) is deleted: the Navigation, Taxonomy and Connected apps screens write site.menus, site.taxonomy_redirects and site.clients_without_pkce through `set`. The Federation and General `saved` callbacks become change hooks on site.relays and the profile keys; the IndexNow key is minted by a hook on site.index_now. license, licenseUrl and licenseName become one setting whose type is { choice, url, name }. site/site-json.ts and the read and write halves of setting-rows.ts are deleted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each settings page saves only the fields it carries through `settings.set`, refuses a form with a problem as a 400 without writing, and its existing settings-*.test.ts pass with their assertions on the file and the rendered page
- [ ] #2 Two pages saved at once both land: a test saves General and Discussion concurrently and both changes are in site.json
- [ ] #3 Navigation, Taxonomy and Connected apps write their settings through `set`; CarriedField, CarriedSettings and the onFile argument are deleted
- [ ] #4 Change hooks reconcile relay subscriptions when site.relays changes, tell followers when a profile key changes, and mint the IndexNow key when site.index_now turns on; the `saved` callbacks and the minting branch are deleted
- [ ] #5 The General page shows the base URL in effect and refuses to save it while GEEKITY_BASE_URL or config.baseUrl overrides it, as today
- [ ] #6 site/site-json.ts is deleted; site/setting-rows.ts holds no read or write code; the form halves live in admin/
- [ ] #7 docs/settings.md describes the `site` namespace and `geekity settings list site`; pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-388 (2026-10-13): the settings pages render from c.var.site, which holds values in effect, so a GEEKITY_SITE__* override shows in their forms. Until this task refuses overridden fields, saving a page writes the env value into site.json. That is a bug only for sites using the new GEEKITY_SITE__* variables, which TASK-388 introduced, so this task should land before the next release. settingsFromSiteJson, siteJsonFor, updateSiteSettings and writeSiteJson remain for the pages, Navigation, Taxonomy, Connected apps and Appearance, and they already parse through SITE. site.avatar is now declared.
<!-- SECTION:NOTES:END -->
