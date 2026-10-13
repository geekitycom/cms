---
id: TASK-264
title: Name an untitled photo post by its first photo's alt text
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 10:50'
updated_date: '2026-10-04 10:54'
labels:
  - content
  - theme
dependencies: []
priority: low
type: enhancement
ordinal: 223800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A photo post with no title and no text is filed at /photo/ (then photo-2, photo-3…, TASK-242) and labelled 'Photo' (TASK-261), though its first photo usually carries alt text: on shll.me (0.21.0) /2026/10/photo/ has photo alt 'Greg'. Use the first photo's alt text instead: as the slug of a new post (newSlug rules, NOTE_SLUG_WORDS cap) in writeDocument's chain where 'photo' comes today, and as postLabel's wording where 'Photo' comes today (LABEL_WORDS cap). It is a label only: no stored title, no page heading (showsTitle unchanged), and the kicker's post-type word ('Photo', the kicker-kind span) is untouched. 'photo' and 'Photo' remain the fallback when the first photo has no alt text. An existing post keeps its slug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new photo post with no title or text whose first photo has alt text gets a slug from that alt text (first five words), from the editor and from Micropub
- [x] #2 Its label (<title>, og:title, twitter:title, JSON-LD headline, admin list and messages) is the alt text, capped like a note's first words; no heading is shown and the kicker still reads Photo
- [x] #3 With no alt text the slug is photo and the label Photo; existing posts keep their slug; only the first photo's alt is used
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests: editor slug from first photo's alt (posts.test.ts TASK-242 block), Micropub slug (create.test.ts), postLabel unit (post-type.test.ts), page head + admin list + flash + kicker still Photo + no h1 (untitled-label.test.ts); fallbacks photo/Photo with no alt, only first photo's alt, existing post keeps slug.
2. typeSlug's photo case: slugWords(first photo alt, NOTE_SLUG_WORDS) || 'photo'.
3. wordlessLabel's photo case: first photo's alt, capped at LABEL_WORDS like a note's text, else 'Photo'.
4. Update theme README line on untitled labels; run build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Only the alt stored on the post's first photo counts, not the media library's description: postLabel has no library to read, and the slug reads the same value so the two agree. A whitespace-only alt falls back. The editor test that named a photo with alt 'A gull' 'photo' now expects a-gull; the no-alt case moved to its own test. The README mp-slug row and the theme README JSON-LD note say the new fallback. Validation: pnpm build, test (4082 + 30 pass), typecheck, lint, format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An untitled, wordless photo post is now named by its first photo's alt text. writeDocument's typeSlug returns slugWords(first alt, NOTE_SLUG_WORDS) before falling back to 'photo', so a new post from the editor or Micropub is filed at /greg/ instead of /photo/; existing posts keep their slug. postLabel's wordless photo case returns the alt cut to LABEL_WORDS like a note, else 'Photo', which feeds <title>, og:title, twitter:title, JSON-LD headline, the admin list and flash messages. showsTitle and the kicker are untouched. Proved by post-type.test.ts (label, cap, no-alt, second-photo-only), posts.test.ts (editor slug, five-word cap, no-alt fallback, existing slug kept), create.test.ts (Micropub greg and photo), untitled-label.test.ts (escaped head tags, kicker reads Photo, no h1.p-name, admin list and flash escaped). Full pnpm build/test/typecheck/lint/format:check pass.
<!-- SECTION:FINAL_SUMMARY:END -->
