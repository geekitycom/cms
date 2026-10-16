---
id: TASK-420
title: A read post's cover reaches Mastodon as an image attachment
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-16 14:12'
updated_date: '2026-10-16 14:12'
labels:
  - federation
milestone: m-31
dependencies: []
references:
  - packages/cms/src/federation/article.ts
  - packages/cms/src/content/read.ts
  - backlog/tasks/task-394
priority: medium
type: feature
ordinal: 375800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A read post's cover (read-of.photo, TASK-394) federates only as an <img> inside the read line in content. Mastodon strips <img> from content and shows only attachments, so Mastodon followers see a read post with no cover, while the page and the feeds show it. TASK-394 left the cover out of attachment on purpose, reasoning that an attachment is the post's own media. That reasoning holds on the page, where a cover counted as a post photo would make the post discover as Photo, but not on ActivityPub, where attachment is how a server shows a picture. TASK-141 already attaches every uploaded image a post shows for exactly this reason (imageAttachments in packages/cms/src/federation/article.ts). The cover should follow the same rule: an uploaded cover becomes an Image attachment with its alt text as name; a cover given as a remote https address stays out, since the site cannot check its media type. The page, feeds, microformats and Post Type Discovery do not change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A read post whose cover is an upload federates with an Image attachment for it: absolute URL, the upload's media type, and the cover's alt text as name
- [ ] #2 A read post whose cover is a remote https address federates with no attachment for it
- [ ] #3 The federated content still carries the cover in the read line, and the post is still a Read, not a Photo
- [ ] #4 A cover marked decorative in the media library is not attached, as with body images
- [ ] #5 Docs that describe how a read post federates say the cover is attached
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. article.ts: a coverAttachment(read, baseUrl, altTexts) beside imageAttachments, applying its rule: an upload under the site's uploads, image media type, not decorative, becomes an Image with the cover's alt (front matter alt, else the library) as name; a remote address yields nothing. Placed after photo attachments and before body images, skipped if the same URL is already attached.
2. Tests in the federation tests: upload cover attached with absolute URL, media type and alt; remote cover not attached; decorative cover not attached; content keeps the cover img and the post stays a Read Note.
3. docs/federation.md (and the read section wherever covers are described) say the cover is attached.
4. Verify on a scratch site: create a read post with an uploaded cover, fetch the AP Note, see the attachment.
<!-- SECTION:PLAN:END -->
