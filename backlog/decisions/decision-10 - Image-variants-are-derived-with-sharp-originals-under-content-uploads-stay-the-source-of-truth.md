---
id: decision-10
title: >-
  Image variants are derived with sharp; originals under content/uploads stay
  the source of truth
date: '2026-09-04 01:13'
status: accepted
---
## Context



## Decision



## Consequences

## Context

Uploads are stored and served exactly as they arrived, so a phone photo goes out at full size to every reader and to every fediverse instance that fetches the page. The user asked for image optimization and pointed at 11ty/image (`@11ty/eleventy-img`) as a reference. That plugin turns one source image into several widths and formats with sharp and writes a `<picture>` with `srcset` and explicit dimensions, at Eleventy build time. The CMS has no build step; it renders at request time.

## Decision

The CMS uses [sharp](https://sharp.pixelplumbing.com/) directly to generate image variants: a fixed set of widths, WebP alongside the original format, with EXIF stripped and orientation applied. The original file under `content/uploads/` is untouched and remains the only source of truth. Variants are derived state written to a directory of their own, generated when a file is uploaded and regenerated lazily when one is missing, so deleting the directory is safe (decision-9). The Markdown renderer emits `<picture>` or `<img srcset sizes width height>` for images that point at an upload; the RSS `content:encoded` and the ActivityStreams `content` keep a plain `<img>` of the original, since readers and remote instances cannot resolve the site's variants sensibly.

11ty/image is the reference for the output HTML and the width set, so a site that builds the same `content/` with Eleventy can run the plugin over the same originals and get equivalent markup. The plugin itself is not used by the CMS.

## Consequences

- sharp is a native dependency with prebuilt binaries for the platforms Node 24 supports. It adds tens of megabytes to `node_modules` and a build-from-source fallback on unusual platforms. This is accepted for a package whose whole job includes serving images.
- Encoding happens in the request that uploads the file, which makes uploads slower by the encode time. AVIF is left out of the default set because its encoder is an order of magnitude slower than WebP; it can be turned on by config.
- The variant directory is the first derived state outside SQLite. It must be excluded from git, from Eleventy input, and from the content sync, and the file-first milestone must treat it as rebuildable.
- Rendering has to know an image's dimensions without opening the file on every request, so the dimensions are recorded when variants are generated and read from the index or a sidecar, never probed at render time.
