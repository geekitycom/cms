---
id: TASK-212
title: Site icon setting on Settings > General
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 07:03'
updated_date: '2026-10-02 07:18'
labels:
  - settings
  - admin
  - theme
dependencies: []
references:
  - packages/cms/src/images/icons.ts
  - packages/cms/src/admin/settings-general.ts
  - packages/cms/admin/pages/settings/general.njk
  - packages/cms/admin/pages/users/edit.njk
  - backlog/decisions
priority: medium
type: feature
ordinal: 228800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site icon is read from `icon` in site.json, falling back to `avatar` (`iconSetting` in images/icons.ts). It feeds the favicon and apple-touch-icon links (`siteIcons`), /favicon.ico, the web app manifest and the OpenSearch description, and TASK-211 makes it the last fallback for a shared link's picture. Nothing in the admin sets it: decision-14 removed the avatar setting, and `icon` never had a field. So a site managed only through the admin, such as shll.me, serves no icon at all. Add a Site icon field to Settings > General that stores an upload path in `site.json` `icon`, written the way the user Avatar field on the user edit screen is written (a path such as /uploads/2026/10/icon.png). The screen shows the current icon and says what makes a good one: a square image at least 512 pixels wide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings > General has a Site icon field that saves an upload path to site.json icon, and clearing it removes the key
- [x] #2 The page shows a preview of the current icon, and a hint that it should be square and at least 512 pixels
- [x] #3 A path that is not an image upload the site can derive icons from is refused with a message naming the problem, and nothing is saved
- [x] #4 With an icon set, the homepage links the derived favicon and apple-touch-icon, /favicon.ico answers 200, and the manifest and OpenSearch description list it
- [x] #5 A site.json that already has icon or avatar keeps the icon it has, and the field shows that value
- [x] #6 The README documents the setting
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in settings-general.test.ts: save a path writes site.json icon and clearing removes it; preview image and the square/512 hint render; a full URL, a non-image extension, a traversal and a missing upload are each refused with their own message and write nothing; after a save the homepage links icon-32/16/180, /favicon.ico is 200, the manifest lists icons and opensearch.xml has an Image; a site.json with icon or only avatar shows that value and a General save keeps it.
2. images/icons.ts: turn the private iconSource into an exported siteIconProblem(setting) that names what is wrong (not an upload path, not an image type), sharing the rules the head and the manifest already use, so the screen and the public site cannot disagree.
3. settings.ts: add icon to SiteSettings, defaults, SETTINGS_FIELDS, settingsFromSiteJson, siteJsonFor (absent when empty, like locale), FIELD_CHECKS (empty is fine; otherwise siteIconProblem, then the upload must exist under contentDir/uploads, so SettingsContext gains contentDir), settingsFromForm, formFromSettings.
4. settings-page.ts: pass contentDir into the check context.
5. settings-general.ts: carry icon; shown fills the field from a hand-set site.json avatar when there is no icon (AC #5); panels supply the preview (the derived 180px touch icon) and whether the shown value is the avatar fallback.
6. general.njk: Site icon text field with hint (square, at least 512 px, path such as /uploads/2026/10/icon.png) and a preview figure, problem link in the summary.
7. __testing__/settings.ts: add icon to the General defaults.
8. README: document the setting. 
9. Gates: pnpm build, test, typecheck, lint, format:check; curl a scratch site for AC #4.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Related: TASK-211 uses this icon as the last fallback for og:image.

Built: a Site icon text field on Settings > General, saved as site.json icon (absent when empty, like locale). SiteSettings.icon models only the icon key; a hand-set avatar is shown in the field through the page's shown hook and written as icon on the next General save, and saves of other pages leave both keys alone. The avatar key is never written or removed, because feeds and the share image still read it.
Validation reuses the head's rule: images/icons.ts parseIconSetting is the one parser both the public icons and the form check read, so the screen cannot accept what the head would drop. The check also stats the upload under contentDir/uploads (SettingsContext gained contentDir). Three refusal messages: not a media library path (full URL, relative path, traversal, bad encoding), not an image type, no upload at that path.
Preview: the derived 180px apple-touch-icon, with a line saying whether it comes from the avatar, cannot be derived, image optimization is off, or there is no icon yet.
Evidence: 8 new tests in src/admin/settings-general.test.ts (failed first: icon was undefined in site.json). pnpm build, pnpm test (3111 + 30 pass), typecheck, lint, format:check all clean. Curl against a scratch site on :3917: bad paths 400 with their messages and site.json unchanged; after saving /uploads/2026/10/icon.png the homepage links icon-32, icon-16, apple-touch-icon 180, /favicon.ico 200 image/x-icon, manifest lists 192/512/maskable, opensearch.xml has the Image, the touch icon 200 image/png; clearing removed the key and /favicon.ico went back to 404. Server stopped.
Known edge: on a site with a hand-set avatar, clearing the field removes icon and the avatar shows through again; the page says so.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a Site icon field to Settings > General that stores an upload path in site.json icon, previews the derived icon, hints square and at least 512 px, and refuses paths the site cannot derive icons from using the same parser the head uses. A hand-set avatar shows in the field and is kept. Documented in both READMEs. Verified with 8 new route tests, the full gate set, and curl against a scratch site for the favicon, touch icon, /favicon.ico, manifest and OpenSearch.
<!-- SECTION:FINAL_SUMMARY:END -->
