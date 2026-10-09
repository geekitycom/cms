---
id: TASK-298
title: A site adds analytics or other scripts to every page without copying a layout
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:47'
updated_date: '2026-10-09 16:34'
labels: []
milestone: m-31
dependencies: []
priority: medium
ordinal: 258800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
andrewshell.org loads two analytics snippets in <head> on every page: Umami (`<script defer src="https://cloud.umami.is/script.js" data-website-id="…">`) and Google Analytics 4 via googletagmanager (an async gtag.js loader plus a short inline gtag config). Many sites need the same: analytics, a verification tag, a chat widget.

Today the only way is to override a template. Theme lookup is site theme first, one file at a time, so a site theme's layouts/base.njk cannot extend the packaged one: "layouts/base.njk" resolves to itself. The default theme has no empty partial meant for additions either. Adding two script tags therefore means copying the whole ~330-line base.njk, or every layout, and the copy stops receiving default theme updates. That is the opposite of what the per-file override is for.\n\nA site needs a supported way to add its own markup to the head (and, if useful, the end of the body) of every public page and keep the default theme as it is. Whether that is a site setting, an admin screen, a hook partial the default theme includes, a way to extend the packaged template by name, or something else is for this task to decide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A site adds the Umami and GA4 snippets above to the head of every public page while using the default theme unchanged, without copying any packaged template
- [x] #2 The addition keeps working when the default theme is updated
- [x] #3 The added markup does not appear in the admin, in emails, or in the Markdown, JSON, text/plain or feed representations
- [x] #4 It works for a Docker deployment with no custom image
- [x] #5 If the site sets a Content-Security-Policy, the docs say what the snippets need; inline config such as gtag works under the default headers
- [x] #6 The default theme README (and packaged README if a setting is added) documents it with the Umami and GA4 example
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Shape: two hook partials the default theme ships empty, partials/head-end.njk (included by layouts/base.njk just before </head>, outside every block) and partials/body-end.njk (just before </body>, outside every block). A site theme of theme.json plus one partial adds its markup to every public HTML page and inherits every other default template, so default theme updates keep reaching it. Chosen over a site setting/admin textarea: no new storage, no admin surface that lets a settings editor run script on the site origin, and it uses the per-file override already documented. Docker: mount ./themes (compose already has the line).
2. Failing tests first (src/web/page-hooks.test.ts): a theme with only theme.json + partials/head-end.njk + partials/body-end.njk carrying the Umami and GA4 snippets; the head snippet appears inside <head> on post, page, home, tag, 404; the body snippet before </body>; not on .md/.json/text/plain representations, feeds, the admin, or a rendered mail; the empty default partials add nothing (existing no-JavaScript test covers that).
3. Implement: the two partials and the two includes in base.njk.
4. Docs: default theme README section with the Umami + GA4 example, the Docker mount, and what a Content-Security-Policy needs (script-src for the two origins plus 'unsafe-inline' or a hash for the gtag config; connect-src for both collectors; default headers set only frame-ancestors so inline works). Packaged README pointer near Security headers. Decision-37 records the choice.
5. Verify: pnpm build/test/typecheck/lint/format:check; run the demo site with a theme carrying the snippets and curl pages and representations; run deslop and no-comments.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Chose two empty hook partials in the default theme (decision-37) over a raw-HTML site setting: no new admin surface able to run script on the admin's origin, no storage, and it reuses the per-file theme override. base.njk includes partials/head-end.njk last in <head> and partials/body-end.njk last in <body>, outside every block.
Found while testing AC #3: the admin editor preview (/admin/preview) renders the post/page layout, so the snippets leaked into an admin response. preview.ts now puts editorPreview: true on the context and base.njk skips both partials when it is set. Named editorPreview rather than preview because document front matter is spread onto the context and an imported post could carry a preview key.
Verification:
- src/web/page-hooks.test.ts (7 tests): head snippets in <head> of /, post, page, tag, 404 with the packaged shell kept; body snippet after the footer; nothing added on the packaged theme; absent from text/markdown, text/plain, application/json, index.md, index.json, the three feeds, llms.txt, admin pages, the editor preview (post and page), and a rendered mail.
- pnpm build, test (cms 5145 pass, 0 fail), typecheck, lint, format:check all pass.
- Live, built CLI against a scratch site with themes/analytics holding only theme.json, partials/head-end.njk (the README's Umami + GA4 snippet) and static/gtag.js: curl showed the snippets in <head> on /, a post, a tag and the 404; none in markdown/text/json/feeds/llms.txt/admin login; /theme/gtag.js served as text/javascript; CSP header was frame-ancestors 'self' only. Headless Chrome on the post page showed an inline script in the partial ran (data-inline-ran=yes) under the default headers.
- AC #2: appended a marker to the packaged partials/jsonld.njk, restarted, and the hooked site served it alongside the snippets; reverted with git checkout.
- AC #4: docker build of the repo's Dockerfile, run with ./content, ./data and ./themes:/site/themes:ro mounted (the compose line): snippets in <head>, none in the Markdown representation. Image removed afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Sites add analytics or any other markup to every public page through two hook partials the default theme ships empty, partials/head-end.njk (last in <head>) and partials/body-end.njk (last in <body>), included by layouts/base.njk outside every block. A site theme of theme.json plus one partial gets the markup and keeps every other packaged template, so default theme updates keep arriving. The admin editor preview sets editorPreview and leaves both out. The default theme README gains 'Adding to every page' with the Umami and GA4 example, the Docker volume, and a CSP table (script-src, connect-src, img-src, and three ways to allow the inline gtag config); the packaged README points to it from Theme overrides and Security headers. decision-37 records the choice. Verified with src/web/page-hooks.test.ts, the full gate, curl against the built CLI and the Docker image, and headless Chrome for the inline script.
<!-- SECTION:FINAL_SUMMARY:END -->
