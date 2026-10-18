---
id: TASK-389
title: >-
  Settings registry wave 3b: settings pages save through the registry and the
  form halves leave site/
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 16:45'
updated_date: '2026-10-14 00:33'
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
- [x] #1 Each settings page saves only the fields it carries through `settings.set`, refuses a form with a problem as a 400 without writing, and its existing settings-*.test.ts pass with their assertions on the file and the rendered page
- [x] #2 Two pages saved at once both land: a test saves General and Discussion concurrently and both changes are in site.json
- [x] #3 Navigation, Taxonomy and Connected apps write their settings through `set`; CarriedField, CarriedSettings and the onFile argument are deleted
- [x] #4 Change hooks reconcile relay subscriptions when site.relays changes, tell followers when a profile key changes, and mint the IndexNow key when site.index_now turns on; the `saved` callbacks and the minting branch are deleted
- [x] #5 The General page shows the base URL in effect and refuses to save it while GEEKITY_BASE_URL or config.baseUrl overrides it, as today
- [x] #6 site/site-json.ts is deleted; site/setting-rows.ts holds no read or write code; the form halves live in admin/
- [x] #7 docs/settings.md describes the `site` namespace and `geekity settings list site`; pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Registry: a change hook can reach the registry (SettingChange.settings), and a runtime listener can watch one setting (watch(ref, listener) -> unwatch), run after the declaration's own hook. Tests first.
2. SITE: writtenWhole so a save still writes every declared key (themes and Eleventy read the file raw); a legacy reader that drops the retired navigation/soloAuthor keys; an onChange on site.index_now that mints site.index_now_key through set when it turns on and the key is empty. Tests first.
3. admin/settings-fields.ts: the submitted/shown/check halves of setting-rows.ts and settings-form.ts move here; the carried rows and onFile go; submittedChanges(form, fields) turns a page's fields into the Map set takes. site/setting-rows.ts and site/settings-form.ts are deleted, their tests move with them.
4. settings-page.ts: the save validates and writes only the page's fields through settings.set; a field whose setting an env/config override holds is neither checked nor written, and the page says which fields are set elsewhere; a set refusal is a 400 with the problems. The saved callback goes. General's base_url read goes (covered by the override rule).
5. Federation: a watch on SITE.relays registered where the relay service is built runs relays.sync(); the page loses its saved callback.
6. Navigation, Taxonomy, Connected apps, Appearance write their one setting through set; the read-modify-write edits run on one serial queue so two edits cannot lose each other.
7. Delete site/site-json.ts: parseSiteJson/siteDataPath move to their users (plugins/enabled.ts, legacy-migrations via storedValues/fileWith); tests move to a __testing__ writeSiteSettings helper. Golden test reworked to pin what remains.
8. Tests: concurrent General + Discussion save; env override on a page field is shown and not written; base_url refusal; index_now mint; relays hook.
9. docs/settings.md: the site namespace and geekity settings list site. Full verification and a curl session on a scratch demo copy.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-388 (2026-10-13): the settings pages render from c.var.site, which holds values in effect, so a GEEKITY_SITE__* override shows in their forms. Until this task refuses overridden fields, saving a page writes the env value into site.json. That is a bug only for sites using the new GEEKITY_SITE__* variables, which TASK-388 introduced, so this task should land before the next release. settingsFromSiteJson, siteJsonFor, updateSiteSettings and writeSiteJson remain for the pages, Navigation, Taxonomy, Connected apps and Appearance, and they already parse through SITE. site.avatar is now declared.

Built (2026-10-13):
- Registry: SettingChange carries settings (the registry), so a declaration hook can set another setting; watch(ref, listener) adds a runtime listener run after the declaration's own hook (errors logged), returning an unwatch. writtenWhole now writes every declared key as the value it reads (or its default) on every set, which is what updateSiteSettings used to do, so a page save still leaves the whole namespace in site.json for themes and Eleventy.
- SITE: writtenWhole; legacy drops the retired navigation/soloAuthor keys (siteJsonFor used to); site.index_now has onChange mintIndexNowKey, which sets site.index_now_key through the registry when IndexNow turns on and the key is empty (works from the CLI too). siteJsonPath(contentDir) exported for the two raw readers left (plugins/enabled.ts, legacy-migrations).
- admin/settings-fields.ts holds the field table (submitted/shown/check/onDisk), formFromSettings, settingsProblems, submittedSettings(form, fields), siteChanges(partial) -> the Map set takes (a default goes as undefined). site/setting-rows.ts, site/settings-form.ts and site/site-json.ts are deleted; CarriedField/CarriedSettings/onFile and the index_now_key minting branch are gone.
- settings-page.ts: the save validates and writes only the page's fields through settings.set('site', ...); a field whose setting an env/config override holds is neither checked nor written (setElsewhere over the page's keys), and layouts/settings-page.njk lists each with what sets it. A registry refusal is a 400 with its problems. The saved callback and General's base_url read are deleted (the override rule covers base_url). This fixes the GEEKITY_SITE__* bug from TASK-388: an overridden value is no longer written into site.json. It also changes one case of AC #5: with config.baseUrl set and no url in site.json, a General save used to write config.baseUrl into the file; now the file keeps no url (settings-general.test.ts updated: forged base_url not written, stored base_url stays '').
- Relays: cms/services.ts watches SITE.relays and runs relays.sync(). The Federation flash no longer adds the 'A follow has been sent...' sentence (the hook result does not reach the page; no test asserted it). A change from the CLI runs in another process and is reconciled at the next boot sync (docs say so).
- Profile keys: no site.json key feeds an actor since decision-14 (userActor reads users.json and config.baseUrl; General's saved callback was already removed in ba8db330), so there is nothing to hook; recorded here rather than inventing one.
- Navigation, Taxonomy, Connected apps write menus, taxonomy_redirects and clients_without_pkce through editSiteSetting (admin/site-setting-edit.ts): get + set on one module-level serial queue, so two edits in the process cannot overwrite each other. Appearance writes theme through set. A refusal (an override) is flashed.
- Tests: writeSiteJson/updateSiteSettings in 41 test files and scripts/fed-smoke.ts replaced by __testing__/site-settings.ts writeSiteSettings/changeSiteSettings (no checks, for fixtures). The golden test moved to admin/settings-fields-golden.test.ts: every file frame (read, form, rewritten bytes) and the fields and problems frames are identical to the old golden; form frames differ only where the old test passed empty carried settings (the new save keeps the file's menus, redirects, key and clients) and where set's checks refuse (no upload for the icon).
- New tests: registry hook-sets-another and watch/unwatch (failed first: 'Cannot read properties of undefined (reading set)', 'registry.watch is not a function'); site namespace whole write, tidy rewrite ('CC0' !== 'cc0' before), retired keys, IndexNow minting; admin env override shown, named and not written; General + Discussion concurrently (5 rounds); relays followed and left through cms.settings.set.

Verification: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check exit 0 (cms 5863, demo 32, plugin-llm 48, plugin-post-summary 22, plugin-tag-suggest 31, plugin-wordpress 106, all pass). Curl session on a scratch copy of the demo (geekity serve on 4389, GEEKITY_BASE_URL and GEEKITY_SITE__TAGLINE set, signed in as ada): General showed 'Tagline from env' and named site.tagline/GEEKITY_SITE__TAGLINE and site.base_url/GEEKITY_BASE_URL, base_url disabled; a General save with a forged base_url wrote the title, license and author and left tagline and url as stored, feedSize kept; Reading (index_now on minted indexNowKey, posts_per_page 3), Discussion, Permalinks, Email, Privacy and Federation each 303 with their keys in site.json; Reading with posts_per_page 0 was a 400 naming the field and site.json was byte-identical after; Navigation add + save of a sidebar menu, Connected apps add, Appearance theme, a tag rename (taxonomyRedirects recorded, old archive 301s to the new) all landed; General and Discussion posted in parallel three times and both changes were in site.json each time. geekity settings list site/get/set worked; set under GEEKITY_SITE__TAGLINE exits 1 naming it. Server stopped (pid checked by cwd). AC #4 note: the profile-key clause has no subject (see above); relays and IndexNow hooks are built and tested.

Review fixes (2026-10-14, uncommitted on m39-settings-registry-wave-3b):
- IndexNow: mintMissingIndexNowKey(settings, by) in site/namespace.ts mints when site.index_now is on and the key is empty and not overridden. The site.index_now hook and a boot step in cms/services.ts both call it, so GEEKITY_SITE__INDEX_NOW=true or a site.json with indexNow and no key gets a key at boot. docs/settings.md says so.
- Taxonomy: a refused taxonomy_redirects write now flashes a warning beside the rename or delete notice instead of only logging.
- writtenWhole tidy rewrite kept for every namespace (maintenance and dev-mode too); a registry test pins it for maintenance.
- migrateSettingsToFile and the __testing__ writeSiteSettings helper drop the retired navigation and soloAuthor keys again (withoutRetiredKeys, the function SITE.legacy uses).
- Cleanups: siteChanges sends toJson(value) with no default mapping (license.toJson of no license is now undefined so it round-trips); the golden's form-save strings changed only in key order. One parseSiteJson beside siteJsonPath replaces the copies in legacy-migrations, plugins/enabled, __testing__/site-settings and the golden test. Unused settings-fields re-exports left admin/index.ts. pageForm is one loop; setElsewhere is resolved once per request. editSiteSetting queues per registry (WeakMap).
- Verification: pnpm build, test (cms 5872), typecheck, lint, format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The seven settings pages, Navigation, Taxonomy, Connected apps and Appearance save through settings.set('site', ...). The form table moved to admin/settings-fields.ts; site/site-json.ts, site/setting-rows.ts and site/settings-form.ts are deleted with CarriedField/CarriedSettings/onFile, the saved callbacks and the IndexNow minting branch. The registry gains watch() and hands hooks the registry; site.index_now mints its key in a declaration hook, and the running site watches site.relays to reconcile relays. A setting an env/config override holds is shown with its source and is never checked or written by a save, which fixes the GEEKITY_SITE__* write-through from TASK-388. SITE is written whole and drops retired keys, so site.json keeps its old shape (golden file frames identical). Verified with the full build/test/typecheck/lint/format chain and a curl session saving every page on a scratch demo.
<!-- SECTION:FINAL_SUMMARY:END -->
