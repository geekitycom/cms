---
id: TASK-354
title: Each site setting is described once
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 23:17'
labels: []
milestone: m-33
dependencies:
  - TASK-353
type: chore
ordinal: 313800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
admin/settings.ts lists about 40 keys by hand in SettingsForm, settingsFromSiteJson, siteJsonFor, settingsFromForm, formFromSettings, settingsProblems and SETTINGS_FIELDS. A key missing from siteJsonFor is silently dropped on save. The file also mixes types, site.json I/O, a legacy migration, form conversion and about 20 normalizers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings keys are declared once and the site.json and form converters are derived from that declaration
- [x] #2 A test shows every declared key survives form to site.json to form
- [x] #3 settings.ts is split so the model, file I/O, form conversion and normalizers are separate modules
- [x] #4 site.json written for an existing site is byte-identical before and after
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pin the old behaviour first: site/settings-golden.test.ts records site.json text, settings and form for representative inputs (empty file, every key set, empty strings, custom/CC license, lists, invalid hand edits, legacy keys, extra keys) into settings-golden.json (GOLDEN_UPDATE=1 rewrites), plus an every-key round trip form -> settings -> site.json -> settings -> form.
2. Declare each setting once: site/setting-rows.ts holds one row per SiteSettings key (site.json read/write, value off a submitted form, and for form fields the field name, form text and check), in site.json write order; a missing key is a type error.
3. Split admin/settings.ts: site/settings.ts (model, defaults, derived views), site/setting-values.ts (normalizers and guards), site/site-json.ts (site.json conversion + file I/O, loops over the rows), site/settings-form.ts (form conversion and checks, loops over the rows), admin/settings-migration.ts (legacy rows). admin/settings.ts keeps SETTINGS_PATH and re-exports so importers keep working; TASK-364 can drop the re-exports.
4. Prove: golden passes unchanged, mutate a row once to see it fail, run build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Golden first: site/settings-golden.test.ts recorded settings-golden.json from the old admin/settings.ts (10 site.json cases incl. missing, unparseable, every key, empty strings, CC/custom/unreadable license, wrong-type hand edits, legacy keys in an old key order; 5 form cases; problems for a good and a bad form). Re-recording it against the old module after the refactor gave a byte-identical file (cmp). The in-memory form, SETTINGS_FIELDS, settings and problems objects are compared with sorted keys: their key order changed (table order is now site.json write order) and nothing observes it; every site.json text is compared byte for byte.
Mutation proof: tagline row switched to empty:'absent' fails the golden test; relays row writing nothing fails both the golden and the round-trip test.
Layout: site/settings.ts (SiteSettings, choices, defaults, robotsPolicyOf, taxonomyBasesFromSettings, effectiveBaseUrl, retentionPolicyOf); site/setting-values.ts (patterns, guards, normalizers); site/setting-rows.ts (SETTING_ROWS, one row per key, typed so a missing key is a compile error; SettingsField/CarriedSettings/SettingsForm/SettingsContext; SETTING_KEYS, SETTINGS_FIELD_NAMES); site/site-json.ts (site.json conversion and file I/O); site/settings-form.ts (SETTINGS_FIELDS, settingsProblems, settingsFromForm, formFromSettings); admin/settings-migration.ts (legacy settings rows). admin/settings.ts keeps SETTINGS_PATH and re-exports the rest so importers keep working; TASK-364 can point importers at site/ and drop the re-exports. None of the site/ modules import Hono or admin rendering.
SETTINGS_FIELDS is now typed Record<SettingsField, string> rather than a const object of literals; admin/appearance.ts reads body[THEME_FIELD] once into a local so narrowing still works. Also exported from the barrel now: parseSiteJson, readSiteJson, robotsPolicyOf etc. were already exported; nothing removed.
Validation: pnpm build, pnpm test (cms 5545 pass, all packages 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Each site setting now has one row in packages/cms/src/site/setting-rows.ts saying how site.json reads and writes it, how a form save makes it, and for form fields the field name, form text and check. settingsFromSiteJson, siteJsonFor, settingsFromForm, formFromSettings, settingsProblems and SETTINGS_FIELDS loop over the rows, and the row table's type makes a key without a row a compile error. The 1671-line admin/settings.ts is split into site/settings.ts (model), site/setting-values.ts (normalizers), site/site-json.ts (site.json conversion + I/O), site/settings-form.ts (form conversion) and admin/settings-migration.ts (legacy rows); admin/settings.ts re-exports them for TASK-364 to remove. Verified by a golden test recorded from the old code (byte-identical when re-recorded against it), an every-key form -> site.json -> form round trip, row mutations that make both fail, and pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
