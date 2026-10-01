---
id: TASK-208
title: Embeddable iframe view so WordPress can embed posts
status: To Do
assignee: []
created_date: '2026-10-01 17:40'
labels:
  - interop
  - embed
  - security
dependencies:
  - TASK-205
references:
  - packages/cms/src/web/oembed.ts
  - packages/cms/src/admin/headers.ts
priority: low
type: feature
ordinal: 224800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-205 serves oEmbed rich cards as a static blockquote with no script. WordPress discovers them and builds the blockquote, then wp_filter_oembed_result (wp-includes/embed.php, on oembed_dataparse) drops the result for any provider not on its allowlist unless the html contains an <iframe>, so pasting a Geekity post URL into WordPress falls back to a plain link. Verified against WordPress 7.1.2's own discovery and filter code (harness left in the TASK-205 notes).

Add a per-post embed view, like WordPress's own /embed/ pages: a minimal page at a fixed suffix (for example {permalink}embed/ or /_geekity/embed?url=) rendering the same card, and append an <iframe sandbox src=...> to the oEmbed html after the blockquote, which WordPress's sandboxed embed expects. Only that route may be framed by other sites: it alone drops X-Frame-Options: SAMEORIGIN and sends frame-ancestors * (or none at all), while every other page keeps today's framing protection. The embed page carries no admin bar, no cookies-dependent content, and no script beyond what WordPress's height-messaging needs (decide whether to support its postMessage height protocol, which needs a small script, or ship a fixed height).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pasting a post URL into the WordPress block editor shows the embedded card, checked with WordPress's own oEmbed code or a real WordPress site
- [ ] #2 Only the embed route can be framed by another origin; every other page still sends X-Frame-Options SAMEORIGIN and frame-ancestors 'self'
- [ ] #3 The embed page shows only the card, never drafts, and nothing from an admin session
- [ ] #4 The oEmbed html is the blockquote followed by a sandboxed iframe of the embed page, and consumers that strip iframes still get the blockquote
<!-- AC:END -->
