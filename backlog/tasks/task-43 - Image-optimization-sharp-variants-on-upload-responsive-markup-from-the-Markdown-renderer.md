---
id: TASK-43
title: >-
  Image optimization: sharp variants on upload, responsive markup from the
  Markdown renderer
status: To Do
assignee: []
created_date: '2026-09-04 01:14'
updated_date: '2026-09-04 01:14'
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
- [ ] #1 Uploading a JPEG or PNG produces the configured widths in WebP and the original format, none wider than the original, with EXIF removed and orientation applied; a GIF is stored unchanged
- [ ] #2 A post page renders an uploaded image as a picture element with a WebP source and an img with srcset, sizes, width, height, lazy loading and the original alt text, and the variants it references are served
- [ ] #3 Feeds, the JSON and Markdown representations and the Article content keep a plain img pointing at the original
- [ ] #4 Deleting the variant directory and requesting the page regenerates what is needed and the page still renders
- [ ] #5 Width and format sets are configurable, AVIF is off by default, and the feature can be switched off, in which case markup is the plain img
- [ ] #6 The variant directory is ignored by git, the content sync and the Eleventy example config, and the README documents the Eleventy equivalent
<!-- AC:END -->
