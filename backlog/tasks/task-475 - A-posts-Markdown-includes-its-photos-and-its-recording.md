---
id: TASK-475
title: A post's Markdown includes its photos and its recording
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
updated_date: '2026-10-22 00:31'
labels:
  - markdown
  - public-site
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
  - packages/cms/themes/default/partials/photos.njk
  - packages/cms/themes/default/partials/recording.njk
ordinal: 400800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A photo post's photos and a podcast or video post's enclosure appear only as front matter in its Markdown. The HTML draws figures and a player with Download, Transcript or Captions, and Other versions links. The Markdown should carry them as Markdown: an image with its alt text per photo, and links to the recording, its transcript or captions, and its alternates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each photo of a post appears in its Markdown as an image with the photo's alt text, in the order the HTML draws them
- [x] #2 A post with an enclosure links the recording (with its type and length where known), its transcript or captions, and each alternate version
- [x] #3 The data is on the Markdown partial context, documented, and tested
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. In markdownKindContext (render.ts), take photos and enclosure from the same documentContext call, passing the image config so a photo's alt falls back to the media library as in the HTML. Put photos on a post's context as { url, alt } and enclosure as the HTML's EnclosureContext.
2. Move formatFileSize from admin/formatting.ts to util/file-size.ts and give the Markdown environment the same fileSize filter the admin has.
3. In the default markdown-header.md.njk, after the kind lines and before the body, write the recording (Download link with type and size), its Transcript or Captions link, an Other versions list (title or type, with type and size where known), then each photo as an image with its alt text, in the HTML's order: recording, then photos.
4. Tests in markdown-representation.test.ts: photo order and alt (front matter and media library), audio and video recording lines, alternates, transcript vs captions, and both partials receiving photos and enclosure.
5. Document photos and enclosure in docs/theme/markdown.md and the header row in docs/public-site.md.
6. Run build, test, test:11ty, typecheck, lint, format:check; curl the scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Photos and enclosure come from the same documentContext call markdownKindContext already made, now given the image config so a photo's alt falls back to the media library (_data/media.json) as the HTML does; only url and alt of each photo go on the Markdown context, not the HTML markup. formatFileSize moved from admin/formatting.ts to util/file-size.ts (its test moved with it) so the Markdown environment can have the admin's fileSize filter without web importing admin. The default header writes the recording, its Transcript or Captions link, an 'Other versions:' list (title or type; type and size in parentheses where there is a title or a size), then each photo as ![alt](url), after the kind lines and before the body, matching post.njk's order (recording, photos, content). Alternates' lang and the duration are on the context but not printed by the default theme.
Validation: pnpm build, pnpm test (cms 6571 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Curled the scratch site (port 3472) with Accept: text/markdown on a temporary audio post with captions, a video alternate and a photo; got the download line with (audio/mpeg, 22.4 MB), Captions, Other versions and the image, above Show notes. Temporary post removed and server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post's Markdown header now writes its recording (a Download link with type and size, the Transcript or Captions link, and an Other versions list) and then each photo as an image with its alt text, in the order the post's HTML draws them. photos ({ url, alt }) and enclosure (the HTML's EnclosureContext) are on both Markdown partials' context, taken from documentContext, and the Markdown environment gains the admin's fileSize filter (formatFileSize moved to util/file-size.ts). Documented in docs/theme/markdown.md and docs/public-site.md. Verified with five new tests in markdown-representation.test.ts, the full build/test/test:11ty/typecheck/lint/format:check run, and a curl of the scratch site's Markdown for a recording post.
<!-- SECTION:FINAL_SUMMARY:END -->
