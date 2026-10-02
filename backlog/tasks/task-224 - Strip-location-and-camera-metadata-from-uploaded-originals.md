---
id: TASK-224
title: Strip location and camera metadata from uploaded originals
status: To Do
assignee: []
created_date: '2026-10-02 23:48'
labels:
  - privacy
  - media
  - security
dependencies: []
references:
  - packages/cms/src/admin/uploads.ts
  - packages/cms/src/images/variants.ts
priority: high
type: bug
ordinal: 239800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Uploaded files keep their metadata, so a phone photo's GPS coordinates are public. storeUpload writes the uploaded bytes to content/uploads/{yyyy}/{mm}/ unchanged (packages/cms/src/admin/uploads.ts:288, writeWithoutOverwriting). The site serves that original at /uploads/..., uses it as the <img> fallback in every <picture> (src/images/markup.ts), and photo posts federate it as the attachment URL. The derived variants are clean, because sharp keeps no metadata unless asked (src/images/variants.ts:288), but the original is not. Both the admin media library and the Micropub media endpoint (TASK-165) go through storeUpload.

What leaks: EXIF GPS (latitude, longitude, altitude, direction), the time the photo was taken, the camera and lens, the device's serial number on some cameras, XMP and IPTC blocks (which can carry location names and the author), and PNG text chunks. Video from phones carries location too: MP4 and M4V hold it in the ©xyz atom of the udta box and in XMP.

Upload types today: .png .jpg .jpeg .gif .webp .avif for images, .mp4 .m4v .webm .mp3 .m4a .aac .ogg .oga .opus for media, and .pdf .txt .md .vtt .srt.

Constraints:
- Orientation: a JPEG's EXIF orientation tag decides how it displays. Stripping it without applying it turns phone photos sideways. Either keep that one tag, or apply the rotation.
- Quality: prefer removing metadata segments losslessly (JPEG APP1/APP13 segments, PNG eXIf/tEXt/iTXt/zTXt chunks, WebP EXIF/XMP chunks) over re-encoding the image, which loses quality.
- Existing uploads: files already in content/uploads keep their metadata until something strips them, and a site that keeps content/ in git also keeps the old bytes in its history. The README says so and how to rewrite history if the owner wants them gone.

This is unconditional, not a privacy setting: no site needs its photos to publish where they were taken. TASK-223's Settings > Privacy page can say that it happens.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An uploaded JPEG, PNG, WebP or AVIF carrying EXIF GPS, XMP and IPTC is stored with none of them, proven by a test that writes such a file, uploads it through storeUpload, and reads the stored bytes back
- [ ] #2 A JPEG whose EXIF orientation is not 1 displays the same way after the upload as before, proven by comparing decoded pixels or dimensions
- [ ] #3 Removing metadata does not re-encode a JPEG or PNG; a test compares the decoded pixels before and after
- [ ] #4 An uploaded MP4 or M4V with a location (©xyz or XMP) is stored without it, or the task notes say why video is out of scope and a follow-up task is filed
- [ ] #5 A geekity command (or admin tool) strips metadata from files already in content/uploads, reports what it changed, and is safe to run twice
- [ ] #6 The README's media library section and Personal data table say that location and camera metadata are removed on upload, that older uploads need the command, and that git history keeps old bytes until rewritten
<!-- AC:END -->
