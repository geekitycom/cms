---
id: TASK-298
title: A site adds analytics or other scripts to every page without copying a layout
status: To Do
assignee: []
created_date: '2026-10-08 11:47'
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
- [ ] #1 A site adds the Umami and GA4 snippets above to the head of every public page while using the default theme unchanged, without copying any packaged template
- [ ] #2 The addition keeps working when the default theme is updated
- [ ] #3 The added markup does not appear in the admin, in emails, or in the Markdown, JSON, text/plain or feed representations
- [ ] #4 It works for a Docker deployment with no custom image
- [ ] #5 If the site sets a Content-Security-Policy, the docs say what the snippets need; inline config such as gtag works under the default headers
- [ ] #6 The default theme README (and packaged README if a setting is added) documents it with the Umami and GA4 example
<!-- AC:END -->
