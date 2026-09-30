---
id: TASK-185
title: Immutable image variants must change URL when an upload name is reused
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 23:57'
updated_date: '2026-09-30 00:49'
labels:
  - performance
  - media
milestone: m-20
dependencies: []
priority: medium
type: bug
ordinal: 208800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-138 made image variants under /uploads/_/ immutable for a year, on the premise that a variant name never changes content. That premise fails when an upload is deleted and different bytes are uploaded under the same name in the same month: the new file gets the old variant URLs, and a browser that cached the old variant keeps showing it for a year (before TASK-138 the exposure was max-age=86400). The fix is to make the variant URL name the source bytes, for example by including a short content hash of the original in the variant path or query, while keeping existing variant URLs resolvable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Re-uploading different bytes under a freed upload name produces variant URLs that differ from the old ones
- [x] #2 Variant URLs whose name matches the served bytes stay Cache-Control: public, max-age=31536000, immutable; any URL that cannot guarantee that gets a short max-age
- [x] #3 Variant URLs already in published pages keep resolving
- [x] #4 A test deletes an upload, reuploads different bytes under the same name, and asserts the page's variant URLs changed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Version = assetVersion (12-hex sha256, memoised on size+mtime) of the ORIGINAL upload, via a sourceVersion(config, source) helper in images/paths.ts. No sidecar change, so existing records keep working and no re-encode is needed.
2. Markup: describeImage returns the record plus the source's version; variant hrefs become /uploads/_/<source>/<file>?v=<version>. responsiveImages' describe callback may omit version (plain URL). variantUrl gains an optional version.
3. Icons: siteIcons hrefs carry ?v=<avatar version> for the same reason (avatar deleted and re-uploaded).
4. Route imageVariant: immutable for a year only when ?v equals the current source's version; any other or missing v (every URL already in published pages) resolves with max-age=86400 (UPLOAD_ASSET_MAX_AGE, the pre-TASK-138 lifetime).
5. Tests first: end-to-end delete + reupload under the freed name asserts page variant URLs change; header assertions for versioned, unversioned and stale v; icon hrefs carry v.
6. Update docs/comments that say variants are immutable by name; check golden file; full gates and curl.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: the version is assetVersion (12 hex of sha256, memoised on size+mtime) of the ORIGINAL upload, read off the file at render via sourceVersion() in images/paths.ts. Nothing is added to the image.json sidecar, so records written before this change keep working and nothing is re-encoded. describeImage returns a DescribedImage (the record plus version); srcset URLs and the three avatar icon hrefs end in ?v=<version>. responsiveImages still accepts a describe callback without a version and then writes plain URLs; variantUrl gains an optional version. Both are additive to the public API (DescribedImage is exported).
Route: imageVariant is immutable for a year only when ?v equals the current source's hash. No v (every URL in pages published before this change) or a stale v still gets the file, at max-age=86400 (UPLOAD_ASSET_MAX_AGE, the pre-TASK-138 lifetime).
Icons were in scope because they share the /uploads/_/ route and the same reuse hole (avatar deleted and re-uploaded).
Golden file unchanged: anonymous golden pages embed no uploads.
Validation: new tests in images/site.test.ts (delete + reupload under the freed name changes every page variant URL; page URLs immutable; plain and ?v=000000000000 resolve at max-age=86400) and page-shell.test.ts (icon hrefs carry v, served immutable). The reupload test failed before the change. pnpm build, test (cms 2536 pass, demo 31 pass), typecheck, lint, format:check green. Curled a scratch copy of the demo on port 3927: /icon-check/ linked 300.webp?v=59ebb3034bcf (immutable); plain and ?v=000000000000 gave public, max-age=86400; replacing the upload's bytes changed the page to ?v=6f411766a9ba. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Image variant and site-icon URLs now carry ?v=<12-hex hash of the original upload's bytes>, so an upload deleted and re-uploaded under the same name gets new URLs. /uploads/_/ serves a year immutable only when v matches the current original; a missing or stale v (including every URL already in published pages) still resolves, at max-age=86400. The hash is memoised on size+mtime and read off the original, so existing sidecars need no rewrite. Verified by a delete-and-reupload end-to-end test, header tests for versioned, plain and stale URLs, icon tests, the full build/test/typecheck/lint/format gates, and curl against a running copy of the demo.
<!-- SECTION:FINAL_SUMMARY:END -->
