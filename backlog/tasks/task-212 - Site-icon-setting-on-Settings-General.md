---
id: TASK-212
title: Site icon setting on Settings > General
status: To Do
assignee: []
created_date: '2026-10-02 07:03'
updated_date: '2026-10-02 07:03'
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
- [ ] #1 Settings > General has a Site icon field that saves an upload path to site.json icon, and clearing it removes the key
- [ ] #2 The page shows a preview of the current icon, and a hint that it should be square and at least 512 pixels
- [ ] #3 A path that is not an image upload the site can derive icons from is refused with a message naming the problem, and nothing is saved
- [ ] #4 With an icon set, the homepage links the derived favicon and apple-touch-icon, /favicon.ico answers 200, and the manifest and OpenSearch description list it
- [ ] #5 A site.json that already has icon or avatar keeps the icon it has, and the field shows that value
- [ ] #6 The README documents the setting
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Related: TASK-211 uses this icon as the last fallback for og:image.
<!-- SECTION:NOTES:END -->
