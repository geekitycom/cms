---
id: TASK-224
title: Strip location and camera metadata from uploaded originals
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 23:48'
updated_date: '2026-10-03 00:48'
labels:
  - privacy
  - media
  - security
dependencies: []
references:
  - packages/cms/src/admin/uploads.ts
  - packages/cms/src/images/variants.ts
  - packages/cms/src/content/metadata/index.ts
  - packages/cms/src/content/metadata/sweep.ts
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
- [x] #1 An uploaded JPEG, PNG, WebP or AVIF carrying EXIF GPS, XMP and IPTC is stored with none of them, proven by a test that writes such a file, uploads it through storeUpload, and reads the stored bytes back
- [x] #2 A JPEG whose EXIF orientation is not 1 displays the same way after the upload as before, proven by comparing decoded pixels or dimensions
- [x] #3 Removing metadata does not re-encode a JPEG or PNG; a test compares the decoded pixels before and after
- [x] #4 An uploaded MP4 or M4V with a location (©xyz or XMP) is stored without it, or the task notes say why video is out of scope and a follow-up task is filed
- [x] #5 A geekity command (or admin tool) strips metadata from files already in content/uploads, reports what it changed, and is safe to run twice
- [x] #6 The README's media library section and Personal data table say that location and camera metadata are removed on upload, that older uploads need the command, and that git history keeps old bytes until rewritten
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: src/content/metadata/ holds one pure stripper per container format (bytes -> { bytes, removed }), and index.ts keys them by upload extension (the signature-checked type). Formats without a stripper pass through unchanged. A structure the stripper cannot walk throws UnreadableMetadataError.
2. JPEG: walk segments; keep APP0 JFIF, APP2 ICC_PROFILE, APP14 Adobe and every non-APP marker; drop other APP1 (EXIF, XMP), APP13 (IPTC), other APPn, COM and bytes after EOI. When EXIF orientation is 2..8, replace the EXIF segment with a minimal one holding only the orientation tag. Lossless.
3. PNG: keep critical chunks and an allowlist of rendering ancillaries; drop eXIf/tEXt/zTXt/iTXt/tIME and unknowns; keep a minimal eXIf with orientation when it is not 1 (CRC from node:zlib).
4. WebP: keep VP8/VP8L/VP8X/ALPH/ANIM/ANMF/ICCP; drop XMP and unknown chunks; EXIF becomes minimal orientation or goes; VP8X flags and RIFF size fixed.
5. GIF: drop comment extensions and application extensions other than NETSCAPE2.0/ANIMEXTS1.0/ICCRGBG1012, and trailing bytes.
6. AVIF: lossless in place. Parse meta/iinf/iloc, find Exif and mime application/rdf+xml items, overwrite their payload with an empty EXIF / an empty padded XMP packet of the same length, so no offset moves.
7. MP4/M4V: blank udta, meta and uuid boxes at top level and under moov/trak/mdia/minf by turning them into zero-filled free boxes of the same size (no chunk offset moves).
8. storeUpload strips before writing and refuses (415) a file the stripper cannot read.
9. geekity strip-metadata walks content/uploads, rewrites changed files atomically keeping mtime, reports each change, exits 1 on an unreadable file; second run changes nothing.
10. README: media library, Personal data table, geekity command table and CLI usage.
11. Tests per AC with sharp-built fixtures; verify over HTTP by uploading a GPS JPEG and fetching /uploads/...
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. src/content/metadata/ holds one pure stripper per container (jpeg.ts, png.ts, webp.ts, gif.ts, isobmff.ts for AVIF and MP4/M4V), keyed by extension in index.ts; tiff.ts reads the EXIF orientation and builds a 26-byte orientation-only TIFF. storeUpload strips before writeWithoutOverwriting, so the admin control, the media library, the Micropub media endpoint and Micropub photo parts are all covered; a file whose structure cannot be walked gets 415.

Decisions:
- Lossless everywhere, AVIF included: rather than re-encode, the Exif item is overwritten with an empty EXIF payload and the XMP item with an empty padded xpacket of the same length, so no iloc offset moves. AVIF orientation is irot/imir, untouched.
- MP4/M4V: udta, meta and uuid boxes at top level and under moov/trak/mdia/minf become zero-filled free boxes of the same size, so stco/co64 offsets stay right whether moov is before or after mdat. Video is in scope; no follow-up task needed.
- Orientation kept as a minimal EXIF (JPEG APP1, PNG eXIf, WebP EXIF chunk) when it is not 1.
- Allowlists, not denylists: PNG keeps critical + rendering ancillaries, WebP keeps picture chunks, JPEG keeps APP0/ICC APP2/Adobe APP14, GIF keeps NETSCAPE/ANIMEXTS/ICC application extensions. Trailing bytes after EOI/IEND/trailer go.
- Truncation tolerated where a box or chunk is cut by end of file (existing tests upload bare signatures); a JPEG whose segments cannot be followed is refused.
- Out of scope, by design: MP3/M4A/Ogg tags, WebM, PDF metadata. Documented in the README.
- IPTC has a home only in JPEG (APP13) and PNG text chunks; both are covered by the fixtures. WebP and AVIF have no IPTC container.

geekity strip-metadata (src/content/metadata/sweep.ts + cli.ts) rewrites only changed files via temp file + rename, restores mtime (library sorts by it), reports each file, exits 1 on unreadable files.

Not changed: decision-10 still says the original under content/uploads is untouched; the orchestrator may want a decision note that metadata is now stripped from originals.

Validation: pnpm build, pnpm test (3534 pass), typecheck, lint, format:check all green. HTTP: built dist, scratch site on :4719, signed in as ada, POST /admin/uploads with a sharp-made JPEG (orientation 6, EXIF GPS + camera, XMP, IPTC, COM); GET /uploads/2026/10/gps.jpg returned 1320 bytes (from 1968) with none of the secrets, and the only APP1 is Exif MM IFD with one entry 0112=6. Copied the unstripped file into content/uploads and ran dist strip-metadata twice: first 'removed IPTC, comment, EXIF, XMP', second '0 stripped, 2 already clean'; served bytes clean. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Uploaded originals are now stored without location and camera metadata. A table of lossless strippers keyed by extension (JPEG segments, PNG chunks, WebP chunks, GIF extensions, AVIF Exif/XMP items overwritten in place, MP4/M4V udta/meta/uuid boxes turned into same-size free boxes) runs inside storeUpload, so every upload path is covered; turned JPEG/PNG/WebP keep an orientation-only EXIF. geekity strip-metadata cleans existing uploads idempotently, keeping mtimes. Both READMEs document it, including the Personal data row and rewriting git history. Verified by uploads.test.ts (raw stored bytes, decoded pixels for JPEG/PNG/WebP/AVIF, orientation 6 shown 20x40), metadata.test.ts (idempotency per format, GIF), cli-strip-metadata.test.ts, the full suite, and an HTTP upload against a running built site.
<!-- SECTION:FINAL_SUMMARY:END -->
