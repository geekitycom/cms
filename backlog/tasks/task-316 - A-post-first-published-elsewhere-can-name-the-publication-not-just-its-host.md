---
id: TASK-316
title: 'A post first published elsewhere can name the publication, not just its host'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 09:43'
updated_date: '2026-10-10 10:46'
labels:
  - enhancement
milestone: m-31
dependencies: []
references:
  - /Users/andrewshell/code/personal/blog-asdo-11ty/_includes/layouts/essay.njk
  - packages/cms/src/content/original.ts
priority: low
ordinal: 275800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-293. andrewshell.org post 133, Why You're Great at Setting Bad Goals, was a guest post first published on Smarter Engineers, someone else's Substack (canonical_href https://open.substack.com/pub/albexl/p/why-youre-great-at-setting-bad-goals). Its Eleventy front matter also carried canonical_name: "Smarter Engineers", and the Eleventy essay layout printed 'This essay was originally published on {{ canonical_name | default("my Substack newsletter") }}.' WordPress dropped both keys. TASK-293 brought back canonical_href: rel=canonical points at the original, and the default theme's entry meta prints 'Originally published at <host>' from hostLink(). The label is always the URL's host, so post 133 reads 'Originally published at open.substack.com', which names a generic Substack host rather than the publication, and canonical_name is unread. The other 16 cross-posts are on andrewshell.substack.com, where the host reads fine. Proposal: read canonical_name (the Eleventy key, so the value copies over as canonical_href did) as the label of the original link when it is a non-empty string, falling back to the host. The asdo_geekity migration overlay already carries canonical_name into the post, where core keeps it as an unread extra key, so the value is in place when this lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 canonical_name, a non-empty string next to a valid canonical_href, becomes the label of the theme context's original link; without it the label stays the host
- [x] #2 The default theme's entry meta prints 'Originally published at Smarter Engineers' for a post with that canonical_name, linking canonical_href
- [x] #3 canonical_name without a valid canonical_href is ignored and named by geekity sync, like an invalid canonical_href
- [x] #4 doc-2's extra-keys table and the default theme README document the key next to canonical_href
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Parse at the boundary: original.ts replaces originalUrlOf with originalOf(extra), returning { url, name? } from canonical_href (absolute http(s) URL) and canonical_name (trimmed non-empty string), or undefined without a valid canonical_href. Callers migrate in the same change.
2. Theme context: documentContext builds original as the one SyndicationLink shape { url, label }, label = name ?? host. post.njk already prints original.label, so no template change.
3. Sync: when canonical_name is set and no valid canonical_href stands next to it, warn naming the file and the value, as the invalid canonical_href warning does.
4. Tests first: original-url.test.ts for the label (named, blank name, non-string name, name without href) and the printed line; sync.test.ts for the canonical_name warning.
5. Docs: doc-2 extra-keys table row for canonical_name next to canonical_href (via backlog doc update), default theme README context table and the Originally published paragraph.
6. Verify: pnpm build/test/typecheck/lint/format:check; curl a scratch site post with canonical_name "Smarter Engineers"; geekity sync on a post with canonical_name and no valid canonical_href.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
originalUrlOf became originalOf(extra) in packages/cms/src/content/original.ts, returning { url, name? }: canonical_href parsed as before, canonical_name trimmed and kept only when non-empty, nothing at all without a valid canonical_href. Both callers (web/context.ts, content/sync.ts) migrated; the old function is gone. The theme context keeps its one SyndicationLink shape: original.label is the name, else the host (hostLabel split out of hostLink). post.njk already printed original.label, so no template change.
A canonical_name that is not a non-empty string next to a valid canonical_href falls back to the host silently; only a canonical_name with no valid canonical_href is warned about, per AC#3. A file with a bad canonical_href and a canonical_name gets both warnings.
Docs: doc-2 row added with backlog doc update --content (the CLI replaces the whole body, so the body was rebuilt from the file with one row inserted after canonical_href); default theme README paragraph and context-table row.
Validation: tests written first; the named-label web test and the sync warning test failed before the change. pnpm build, test (cms 5193 pass, all packages 0 fail), typecheck, lint, format:check pass. Real run on a scratch site (geekity init, .mjs config): geekity sync printed 'posts/2026-09-04-lonely-name.md names canonical_name "Smarter Engineers" with no absolute http or https canonical_href, so it names nothing.'; curl of /2026/09/why-youre-great-at-setting-bad-goals/ showed rel=canonical at the open.substack.com URL and 'Originally published at <a class="u-url" href="https://open.substack.com/pub/albexl/p/why-youre-great-at-setting-bad-goals">Smarter Engineers</a>'; the lonely-name post printed no Originally published line. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post's canonical_name, when it is a non-empty string next to a valid canonical_href, is now the label of the theme context's original link, so the default theme prints "Originally published at Smarter Engineers" for andrewshell.org post 133 instead of the open.substack.com host. Without it the label stays the host. A canonical_name with no valid canonical_href is ignored and named by geekity sync. Parsing lives in originalOf in content/original.ts, which replaced originalUrlOf. Documented in doc-2 and the default theme README. Verified with new web and sync tests (failing first), the full build/test/typecheck/lint/format run, and geekity sync plus curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
