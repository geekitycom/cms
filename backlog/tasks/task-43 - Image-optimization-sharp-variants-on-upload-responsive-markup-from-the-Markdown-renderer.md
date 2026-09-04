---
id: TASK-43
title: >-
  Image optimization: sharp variants on upload, responsive markup from the
  Markdown renderer
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:14'
updated_date: '2026-09-04 13:43'
labels:
  - content
  - web
milestone: m-6
dependencies:
  - TASK-13
  - TASK-42
references:
  - >-
    backlog/decisions/decision-10 -
    Image-variants-are-derived-with-sharp-originals-under-content-uploads-stay-the-source-of-truth.md
  - 'https://github.com/11ty/image'
  - 'https://sharp.pixelplumbing.com/'
type: feature
ordinal: 28500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement decision-10. On upload of a raster image (PNG, JPEG, WebP, GIF, AVIF), generate variants with sharp into a directory of derived files (proposed `data/images/{yyyy}/{mm}/{name}-{width}.{ext}`, served under a public prefix such as `/uploads/_/`): a fixed width set drawn from 11ty/image's defaults (for example 320, 640, 960, 1280, 1920, never upscaling), in WebP plus the original format, EXIF stripped, orientation applied; animated GIFs are left alone. Record each original's intrinsic width and height and its variant list where the renderer can read them without opening files per request. A variant that is missing at request time is generated lazily and the directory may be deleted at any time. The Markdown renderer, for an image whose `src` is a site upload, emits `<picture>` with a WebP `source` and an `img` carrying `srcset`, `sizes`, `width`, `height` and `loading="lazy"`, keeping the alt text; images from elsewhere are untouched. The RSS `content:encoded`, the JSON and Markdown representations and the ActivityStreams Article `content` keep the plain `<img>` of the original. Config gains `imageWidths`, `imageFormats` (AVIF opt-in) and a switch to disable optimization. The variant directory is excluded from git, from the content sync and from Eleventy input; document in the README how a site building with Eleventy gets the same markup from `@11ty/eleventy-img` over the same originals.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Uploading a JPEG or PNG produces the configured widths in WebP and the original format, none wider than the original, with EXIF removed and orientation applied; a GIF is stored unchanged
- [x] #2 A post page renders an uploaded image as a picture element with a WebP source and an img with srcset, sizes, width, height, lazy loading and the original alt text, and the variants it references are served
- [x] #3 Feeds, the JSON and Markdown representations and the Article content keep a plain img pointing at the original
- [x] #4 Deleting the variant directory and requesting the page regenerates what is needed and the page still renders
- [x] #5 Width and format sets are configurable, AVIF is off by default, and the feature can be switched off, in which case markup is the plain img
- [x] #6 The variant directory is ignored by git, the content sync and the Eleventy example config, and the README documents the Eleventy equivalent
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Dependency: sharp ^0.35.4 in packages/cms (caret, matching every other dependency there).
2. Config (config.ts + tests): imageOptimization (bool, default true, GEEKITY_IMAGE_OPTIMIZATION), imageWidths (number[], default 320/640/960/1280/1920, GEEKITY_IMAGE_WIDTHS), imageFormats (the derived formats besides the original, default ['webp'], GEEKITY_IMAGE_FORMATS, avif opt-in). Validated at boot the way uploadTypes is: an unknown format or a non-positive width throws rather than being ignored.
3. New module src/images/: variants.ts generates with sharp into <dataDir>/images/<uploadPath>/{width}.{ext} with a sidecar image.json holding the intrinsic width, height, source format, source mtime and the variant list; markup.ts rewrites <img src="/uploads/..."> into <picture> for the site's HTML only. Everything is a function of the resolved config plus a module-level record cache, so nothing new has to be threaded through the app.
4. Widths never upscale: the configured widths below the original, plus the original's own width, so the srcset has a variant at full size. GIF (animated or not), SVG and non-images are skipped and stored unchanged. sharp .rotate() applies EXIF orientation and sharp's default drops metadata.
5. Generation on upload: storeUpload's UploadConfig widens to include dataDir and the three image keys, so all three callers (editor, avatar, media screen) pass c.var.config unchanged and get variants for free.
6. Deletion: media.ts's deleteUpload defaults removeDerived to removing the source's derived directory, so no wiring is needed at the mount site.
7. Serving: GET /uploads/_/* registered before /uploads/*; a missing variant regenerates the whole set for that source and is then served, so deleting the directory is safe (AC #4). Optimization off means existing files are still served but nothing is generated.
8. Site markup only: documentContext takes the config as an optional second argument and rewrites content through markup.ts; render.ts and preview.ts pass it. document.html itself stays plain, so feeds, the JSON and Markdown representations and the Article content are untouched by construction (AC #3).
9. Exclusions: the derived directory lives under dataDir, so git (data/ in .gitignore), the content sync (it only walks contentDir) and the Eleventy config (input is content/) all already miss it; each is verified rather than assumed.
10. Docs: README config table rows, an Image optimization section with the @11ty/eleventy-img equivalent, and packages/cms/README.md route table and subsection.
11. Tests beside the sources: src/images/variants.test.ts, src/images/markup.test.ts, config cases, and an end-to-end pass through the admin sandbox harness for upload, page render, variant serving, deletion and regeneration.
12. Gates: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, plus a manual run against a scratch site on port 3000.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built `packages/cms/src/images/`: `variants.ts` (sharp generation, the sidecar, the lazy rebuild and the delete), `markup.ts` (the `<picture>` rewrite), `index.ts`, and three test files — `variants.test.ts` (20 cases), `markup.test.ts` (10) and `site.test.ts` (7 end-to-end through the admin sandbox). Wired into `config.ts` (three new keys), `admin/uploads.ts` (derive inside `storeUpload`), `admin/media.ts` (the default `removeDerived`), `web/routes.ts` (`/uploads/_/*`), `web/context.ts`, `web/render.ts`, `admin/preview.ts` and the `src/index.ts` barrel. Docs in the root README (config table, an Image optimization section with the @11ty/eleventy-img equivalent), `packages/cms/README.md` (both route tables, an Image variants subsection) and a block in `docs/eleventy.config.example.js`. `sharp@^0.35.4` added to `packages/cms`.

Decisions:
- Derived files live at `<dataDir>/images/<the upload's path>/{width}.{ext}` with an `image.json` sidecar beside them, served under `/uploads/_/`. A directory named after the file rather than a suffixed filename, so a delete is one `rm -rf` and the parse of a request path is unambiguous whatever the original was called. The prefix sits inside `/uploads/` so a site's asset host and cache rules only ever learn one path; `_` cannot collide with a real upload, which is filed under `{yyyy}/{mm}/`.
- Everything is a function of `ImageConfig` — a `Pick` of the resolved config — plus two module-level caches, rather than a service threaded through the app. That is what let `storeUpload` derive variants with no change at any of its three call sites, and `deleteUpload`'s `removeDerived` default to the real cleanup with nothing wired at the mount site.
- Widths are the configured ones below the original plus the original's own, so nothing is upscaled and the srcset always has a full-size entry that is not the unprocessed upload. Formats are `imageFormats` plus the original's, which is the `<img>` fallback and cannot be dropped.
- `describeImage` is synchronous, cached, and validated against the original's mtime — decision-10 forbids probing an image at render time. The cache entry deliberately outlives the sidecar: with the process warm, deleting `data/images` leaves the page rendering `<picture>` and each variant request rebuilds the set. Cold (a restart with the directory gone) the first render is the plain `<img>` and generation runs in the background, so the next one is responsive; nothing ever waits on an encoder while a reader waits on a page.
- The rewrite is applied by passing the config to `documentContext`, which `render.ts` and `preview.ts` do and nothing else does. `document.html` itself is untouched, so the feeds, `documentJson`, the Markdown representation and `postArticle` keep the plain `<img>` by construction rather than by remembering to.
- `responsiveImages` is a text rewrite over `<img>` tags taking any lookup, so it is pure and unit-testable; the author's own attributes are kept verbatim and win over every addition. A src under `/uploads/_/` is skipped, so the rewrite cannot feed on its own output.
- GIF is skipped by extension (AC #1) rather than by animation detection, and an animated WebP or AVIF by sharp's page count. The page-count guard is the one branch with no test: sharp 0.35 would not produce a multi-page fixture from raw input in-process, and a real animated file would have been a binary fixture in the repository.
- `sizes` is a constant `100vw`, 11ty/image's default. Making it configurable was left out as scope the task did not ask for.

Verification: 926 package tests and 11 demo tests pass; the Eleventy parity suites pass; build, typecheck, lint and format:check are clean. Also driven against a real server (apps/demo/server.ts over a scratch content and data directory on port 3000, killed afterwards): a 2400x1600 JPEG with EXIF orientation 6 uploaded through /admin/uploads landed as 1600x2400 with widths 320/640/960/1280/1600 in WebP and JPEG and no EXIF in any variant; the post page rendered the picture element and every /uploads/_/ URL in it answered 200; the variant came back as image/webp at 320x480 with a day's cache lifetime; the feed, the ActivityStreams Article and the Markdown representation all kept the plain img and the outside image was untouched; a width nobody offers and a traversal path both 404'd; deleting data/images left the page rendering and the variant regenerated on request; a restart with the directory gone gave a plain img then a picture on the next request; a GIF came back byte-identical with nothing derived; GEEKITY_IMAGE_OPTIMIZATION=off wrote nothing and served the plain img with the variant URL 404; GEEKITY_IMAGE_WIDTHS=400,800 with GEEKITY_IMAGE_FORMATS=avif,webp produced both source elements and served 400.avif; and deleting the referenced upload from the media screen took its derived directory with it after the confirmation step. git check-ignore confirms both data/ and apps/*/data/ cover the variant directory.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Uploaded raster images are now derived into smaller and more modern copies with sharp, and the site's own pages offer them. An upload of a PNG, JPEG, WebP or AVIF writes one file per width per format into `data/images/<the upload's path>/`, plus an `image.json` recording the original's intrinsic size and everything derived from it; the original under `content/uploads/` is never touched and stays the only source of truth (decision-10). Widths are 11ty/image's set, nothing is upscaled, the original's own width is always offered, EXIF orientation is applied and the metadata dropped, and a GIF is stored and served exactly as it arrived. A post page renders a picture element with a WebP source and an img carrying srcset, sizes, width, height and lazy loading; the feeds, the JSON and Markdown representations and the ActivityStreams content keep the plain img of the original, because the rewrite is applied at the theme render path and `document.html` is never changed. The derived directory is disposable: a missing variant rebuilds the whole set for its source on request, and a request for a width or a format the site does not offer is a 404 that encodes nothing. `imageWidths`, `imageFormats` (AVIF opt-in) and `imageOptimization` are config with environment overrides, validated at boot; with optimization off the markup is the plain img and nothing is encoded. The directory lives under `data/`, so git, the content sync and the Eleventy input all miss it, and both READMEs plus the example Eleventy config document how a build gets the same markup from @11ty/eleventy-img over the same originals.

Verified by 37 new tests (packages/cms/src/images/variants.test.ts, markup.test.ts and site.test.ts) inside a suite of 926 that passes in full, by the 11 demo tests and both Eleventy parity suites, by build, typecheck, lint and format:check all clean, and by driving a real server on port 3000 over a scratch site: an EXIF-rotated 2400x1600 JPEG uploaded and derived at five widths in two formats with the orientation applied and the EXIF gone, every variant URL in the rendered page served, the feed and Article keeping the plain img, deleting data/images leaving the page rendering and the variants rebuilding, a cold restart self-healing on the second request, a GIF byte-identical with nothing derived, the off switch producing a plain img and a 404 variant, AVIF and custom widths from the environment, and a media-screen delete taking the derived directory with the original.
<!-- SECTION:FINAL_SUMMARY:END -->
