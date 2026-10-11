---
id: TASK-348
title: Links in emails keep the site base path
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 17:29'
labels: []
milestone: m-32
dependencies:
  - TASK-347
references:
  - packages/cms/src/web/negotiate.ts
type: bug
ordinal: 307800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/negotiate.ts absoluteUrl keeps a base path, so /x on https://h/blog/ becomes https://h/blog/x. Seven private absolute() copies (comments/submission.ts, comments/records.ts, comments/moderate.ts, contact/delivery.ts, contact/submission.ts, notifications/comments.ts, notifications/digest.ts) use new URL(path, base) and drop /blog. Comment, contact and digest emails on a site served under a path link to the wrong place. Other ad hoc trailing-slash joins (web/templates.ts, notifications/links.ts, admin/recovery.ts) may have the same drift.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One absolute-URL builder exists and every former copy imports it
- [x] #2 Comment, moderation, contact and digest emails built for a site with base URL https://example.com/blog/ link to URLs under /blog/
- [x] #3 Trailing-slash joins across cms and plugins use one pair of helpers, and a base URL with a doubled trailing slash behaves the same in cms and plugins
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add packages/cms/src/util/url.ts with absoluteUrl (moved from web/negotiate.ts) and withTrailingSlash/withoutTrailingSlash (strip every trailing slash).
2. Failing tests first: util/url.test.ts; base-path (https://example.com/blog/) email tests in notifications/comments, notifications/digest, contact/site; resetLink under a path in admin/recovery; doubled trailing slash in config.test.
3. Delete the seven private absolute() copies and import absoluteUrl; repoint every negotiate.ts absoluteUrl import to util/url.ts.
4. Route notifications/links.ts and admin/recovery.ts resetLink through absoluteUrl; replace ad hoc slash joins in templates, documents, webmention/links, config, indieauth/identity, plugins/install with the pair.
5. Export the pair through @geekity/cms/plugin and use it in plugin-llm, plugin-tag-suggest and plugin-wordpress.
6. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
absoluteUrl now lives in packages/cms/src/util/url.ts beside withTrailingSlash/withoutTrailingSlash. negotiate.ts no longer defines it; every importer (about 40 files) imports from util/url.ts, and web/index.ts re-exports it from there, so the public @geekity/cms export is unchanged. The seven private absolute() copies are gone.

Also fixed: notifications/links.ts (approve/spam/delete/unsubscribe links) and admin/recovery.ts resetLink resolved root paths with new URL and dropped the base path; both go through absoluteUrl now. The theme absoluteUrl filter in web/templates.ts is the shared function.

withoutTrailingSlash strips every trailing slash (the plugins' old /\/+$/), so config.baseUrl 'https://h/blog//' now resolves to 'https://h/blog' instead of 'https://h/blog/'. The pair is exported through @geekity/cms/plugin (an addition, HOST_API_VERSION unchanged) and the plugin bundles inline it; no bundle references @geekity/cms at runtime. Left alone: path normalizations that keep '/' for the root (web/navigation.ts, webmention/links.ts sitePath, admin/settings.ts URL tidying) since they are not base-URL joins.

Failing-before evidence: comment notice, digest and contact emails on https://example.com/blog/ linked https://example.com/2026/09/hello-world/, https://example.com/_geekity/moderate?..., https://example.com/admin/comments and /admin/messages; resetLink gave https://example.com/admin/reset; config gave 'https://geekity.example/blog/' for a doubled slash.

Validation: pnpm build, pnpm test (cms 5501 pass, plugins and demo pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
One absolute-URL builder (util/url.ts absoluteUrl) replaces the seven private copies that dropped a site's base path, and moderation links, reset links and the theme filter use it too, so comment, moderation, contact, digest and reset emails on https://example.com/blog/ link under /blog/. One trailing-slash pair (withTrailingSlash/withoutTrailingSlash) replaces the ad hoc joins in cms and the plugins, exported via @geekity/cms/plugin, so a doubled trailing slash means the same in both. Verified with new failing-first tests (util/url, notifications/comments, notifications/digest, contact/site, admin/recovery, config) and the full build/test/typecheck/lint/format gate.
<!-- SECTION:FINAL_SUMMARY:END -->
