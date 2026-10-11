---
id: TASK-354
title: Each site setting is described once
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
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
- [ ] #1 Settings keys are declared once and the site.json and form converters are derived from that declaration
- [ ] #2 A test shows every declared key survives form to site.json to form
- [ ] #3 settings.ts is split so the model, file I/O, form conversion and normalizers are separate modules
- [ ] #4 site.json written for an existing site is byte-identical before and after
<!-- AC:END -->
