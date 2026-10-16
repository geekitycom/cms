---
id: TASK-420
title: A read post's cover reaches Mastodon as an image attachment
status: Done
assignee:
  - '@claude'
created_date: '2026-10-16 14:12'
updated_date: '2026-10-16 14:20'
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
- [x] #1 A read post whose cover is an upload federates with an Image attachment for it: absolute URL, the upload's media type, and the cover's alt text as name
- [x] #2 A read post whose cover is a remote https address federates with no attachment for it
- [x] #3 The federated content still carries the cover in the read line, and the post is still a Read, not a Photo
- [x] #4 A cover marked decorative in the media library is not attached, as with body images
- [x] #5 Docs that describe how a read post federates say the cover is attached
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. article.ts: a coverAttachment(read, baseUrl, altTexts) beside imageAttachments, applying its rule: an upload under the site's uploads, image media type, not decorative, becomes an Image with the cover's alt (front matter alt, else the library) as name; a remote address yields nothing. Placed after photo attachments and before body images, skipped if the same URL is already attached.
2. Tests in the federation tests: upload cover attached with absolute URL, media type and alt; remote cover not attached; decorative cover not attached; content keeps the cover img and the post stays a Read Note.
3. docs/federation.md (and the read section wherever covers are described) say the cover is attached.
4. Verify on a scratch site: create a read post with an uploaded cover, fetch the AP Note, see the attachment.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shape: one helper, uploadedImage(src, alt, baseUrl, altTexts), holds the upload/decorative/media-type rule. imageAttachments and the new coverAttachment both call it. Order: recording, photos, cover, body images. A cover already attached as a photo, or repeated in the body, is attached once.
Verified live on the demo: a read post with cover /uploads/2026/09/geekity-icon.png served as a Note with one Image attachment (absolute URL, image/png, the cover's alt as name). The content kept the img, and the page kicker still said Read. cms suite 6240 pass, lint and typecheck clean.
Found, not changed: photoAttachments attaches decorative photos and remote photos without a media type, so docs/media.md 'Decorative pictures are left out' is not quite true for post photos. Pre-existing and outside this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A read post's uploaded cover now federates as an Image attachment, named with its alt text, so Mastodon shows it. A remote or decorative cover is not attached. The cover stays in the read line, and the post stays a Read Note. Body images and the cover share one helper. Docs updated (federation, media, page-shell). Verified by five new article tests, the full cms suite (6240 pass), and a live ActivityPub fetch on the demo.
<!-- SECTION:FINAL_SUMMARY:END -->
