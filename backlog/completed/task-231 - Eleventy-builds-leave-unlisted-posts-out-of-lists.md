---
id: TASK-231
title: Eleventy builds leave unlisted posts out of lists
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 12:48'
updated_date: '2026-10-03 13:44'
labels:
  - eleventy
  - content
dependencies: []
priority: low
type: bug
ordinal: 246800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-227 added visibility: unlisted (and hides unrecognized values like a draft). The CMS reads the key; the example Eleventy config in apps/demo does not, so an Eleventy build of the same content/ still lists unlisted posts in collections, feeds and the sitemap, and still builds pages for posts with an unrecognized visibility. doc-2 and packages/cms/README.md record the gap. The 11ty compatibility promise (decision-9, doc-2) means a site built either way publishes the same set.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The example Eleventy config excludes unlisted posts from its collections and feeds and adds noindex to their pages
- [x] #2 A post with an unrecognized visibility value gets no page in the Eleventy build
- [x] #3 apps/demo's eleventy test covers both, and doc-2 drops the recorded gap
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Demo content: add an unlisted post and a post with an unrecognized visibility (visibility: private) so the demo exercises both.
2. apps/demo/test/eleventy.test.ts: capture the built collections through an options.config probe collection; assert the unlisted post is written, carries <meta name="robots" content="noindex">, and is in no collection (all, post, its tags, categories); assert the unrecognized-visibility post gets no page. Watch them fail.
3. packages/cms/docs/eleventy.config.example.js: a geekity-visibility preprocessor beside geekity-drafts. Absent or public: nothing. unlisted: eleventyExcludeFromCollections = true and noindex = true (the context flag the CMS theme reads). Anything else: return false, like a draft. Header list gains the rule.
4. Demo layouts post.njk and page.njk print the robots meta from noindex, as the CMS theme does.
5. doc-2 and packages/cms/README.md drop the recorded gap and say what the Eleventy config does.
6. Verify: pnpm build, test, typecheck, lint, format:check, pnpm --filter demo test:11ty; inspect _site from build:11ty for both posts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mechanism: a geekity-visibility addPreprocessor in packages/cms/docs/eleventy.config.example.js, beside geekity-drafts, so the rule lives in one place. Eleventy 3.1.6 runs preprocessors on the same data object TemplateMap later reads eleventyExcludeFromCollections from, so setting it there removes the document from collections.all, every tag collection and collections.categories (verified by the probe, and by deleting that line: the collection assertion then fails). noindex is the context flag the CMS theme already reads; the demo layouts post.njk and page.njk print the robots meta from it. A static build cannot send X-Robots-Tag.
The demo builds no feed or sitemap template (the CMS generates those in code), so the test adds a probe Nunjucks template to its temporary build that lists every collection entry, standing in for a feed or sitemap drawn from collections.
Demo content gained posts/2026-09-03-a-post-only-its-link-finds.md (unlisted) and posts/2026-09-04-a-visibility-nobody-knows.md (visibility: private); apps/demo site.test still passes with them.
Validation: pnpm build, pnpm test (3659 pass), typecheck, lint, format:check all exit 0; pnpm --filter demo test:11ty 8/8; pnpm --filter @geekity/cms test:11ty 18/18. pnpm --filter demo build:11ty wrote 2026/09/a-post-only-its-link-finds/index.html with <meta name="robots" content="noindex"> and no 2026/09/a-visibility-nobody-knows/.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The example Eleventy config now reads visibility the way isServed/isListed do: unlisted keeps its page, sets eleventyExcludeFromCollections and the noindex flag, and any value other than public or unlisted returns false like a draft. Demo layouts print the robots meta from noindex. apps/demo/test/eleventy.test.ts covers both with new demo posts and a collections probe template; doc-2 and packages/cms/README.md drop the recorded gap and document the rule. Verified with the full build/test/typecheck/lint/format run, both test:11ty suites, a mutation check on the exclusion line, and the built _site output.
<!-- SECTION:FINAL_SUMMARY:END -->
