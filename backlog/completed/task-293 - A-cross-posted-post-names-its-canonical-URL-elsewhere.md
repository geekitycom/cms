---
id: TASK-293
title: A cross-posted post names its canonical URL elsewhere
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:00'
updated_date: '2026-10-09 15:10'
labels: []
milestone: m-31
dependencies: []
ordinal: 253800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post first published elsewhere, such as a Substack essay republished on the blog, should tell search engines and readers where the original lives. andrewshell.org has 17 such posts; its Eleventy site carried canonical_href in front matter, and the WordPress import lost it. Today the default theme always prints rel=canonical as the page's own URL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A front matter key (named in doc-2) holding an absolute https URL makes the page's <link rel="canonical"> point there instead of at its own URL
- [x] #2 The value is exposed to themes in the template context, and the default theme shows a short "Originally published at ..." link to it on the post
- [x] #3 A value that is not an absolute http(s) URL is ignored and named by geekity sync
- [x] #4 The JSON and Markdown representations and the post's h-entry carry the original URL (u-syndication or u-url per microformats guidance, chosen in the task)
- [x] #5 doc-2 and the default theme README document the key
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Key: canonical_href, the name andrewshell.org's Eleventy front matter already used, so the 17 posts' values copy over and an Eleventy build reads the same key (decision-3).
2. originalUrlOf(extra) in packages/cms/src/content/original.ts: the value when it is an absolute http or https URL, else undefined.
3. documentContext exposes it as original ({ url, label }, the SyndicationLink shape); base.njk's rel=canonical and og:url use original.url on an entry, else the page URL.
4. post.njk's entry-meta line prints 'Originally published at <host>' as a u-url link after the permalink's. u-url, not u-syndication: mf2 defines u-syndication as copies of this post, and the original is not a copy; decision-19's original-post-discovery reads a copy's off-host u-url and rel=canonical as the original.
5. Content sync warns, naming the file and value, when canonical_href is set but not an absolute http(s) URL; the post is still indexed.
6. JSON and Markdown representations already carry front matter verbatim; tests pin that canonical_href is in both.
7. Tests first for each AC, then the code.
8. Document the key in doc-2's extra-keys table and the default theme README (context table, head section, entry meta).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Key named canonical_href, the name andrewshell.org's Eleventy site used, so its 17 posts' values carry over unchanged. A plainer name such as canonical or original would be a one-line rename of ORIGINAL_FRONT_MATTER_KEY plus docs if preferred.
h-entry markup: a second u-url (after the permalink's), not u-syndication. mf2 h-entry defines u-syndication as copies of this post; the original is not one. decision-19's original-post-discovery already reads a copy's off-site u-url and rel=canonical as the original.
og:url follows rel=canonical, keeping the README's 'og:url is the canonical URL'. The oEmbed discovery links and JSON-LD still use the page's own URL. A listing (pagination) never takes the original, only an entry.
The JSON and Markdown representations already carried front matter verbatim; the new tests pin canonical_href in both. No code change was needed there.
Validation: new src/web/original-url.test.ts (10 tests over HTTP plus microformats-parser) and a sync.test.ts case; 4 of the web tests failed before the change. pnpm build, test (cms 5047 pass), typecheck, lint, format:check all pass. Real run: geekity sync on a scratch site printed 'posts/2026-09-03-bad.md names canonical_href "my substack", which is not an absolute http or https URL, so the page stays its own canonical URL.'; curl of the served post showed rel=canonical and og:url at the Substack URL and the Originally published at line; the bad post kept its own canonical; index.json and index.md carried canonical_href. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post's canonical_href front matter, when it is an absolute http(s) URL, now makes the page's rel=canonical and og:url point at the original, is on the theme context as original { url, label }, and the default theme prints 'Originally published at <host>' as a second u-url of the h-entry. Any other value is ignored and geekity sync names the file. JSON and Markdown representations carry the key in their front matter. Documented in doc-2 and the default theme README. Verified with new HTTP and microformats tests, a sync warning test, the full build/test/typecheck/lint/format run, and curl plus geekity sync against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
