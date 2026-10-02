---
id: TASK-215
title: Feeds carry a post's photos
status: To Do
assignee: []
created_date: '2026-10-02 16:22'
labels:
  - feeds
  - micropub
dependencies: []
priority: medium
type: bug
ordinal: 231800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-166 added the photo front matter key (photosOf/photoAlt in packages/cms/src/content/photo.ts). The RSS, Atom and JSON feeds do not include photos, so a photo-only post reads empty in a feed reader. Each feed format should carry the photos the way it carries body images (JSON Feed image/attachments, an img in RSS/Atom content), with alt text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A photo-only post shows its photos, with alt text, in the RSS, Atom and JSON feed items
- [ ] #2 Tests assert the photos appear in each feed format
<!-- AC:END -->
