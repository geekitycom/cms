---
id: TASK-258
title: Convert Micropub HTML content to clean Markdown
status: To Do
assignee: []
created_date: '2026-10-04 00:30'
labels:
  - micropub
  - security
dependencies: []
priority: high
type: bug
ordinal: 273800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Micropub create or update whose content is {"html": "…"} (iA Writer can send HTML; other clients too) is written to the post body as it came (content() in packages/cms/src/micropub/create.ts), and the renderer passes HTML through (markdown-it html: true, as Eleventy does). Checked 2026-10-03 against the site's renderer: (1) pretty-printed HTML breaks, because a line indented four spaces after a blank line becomes a code block, so '<div>\n    <p>a</p>\n\n    <p>b</p>\n</div>' renders the second paragraph as escaped code; (2) <script> and event-handler attributes pass through, so any app granted only the create scope can run script on the public site, where the signed-in owner's admin bar and session are; (3) the editor then shows raw HTML in a Markdown editor.

At the Micropub boundary, sanitize the HTML (drop script, style, iframe, object, embed, form, event-handler and javascript: attributes; reuse or extend web/sanitize.ts) and convert it to GitHub-flavoured Markdown (turndown or similar). Markup Markdown cannot express (tables, figure, details, embeds the sanitizer keeps) stays as an HTML block with its indentation removed, so nothing turns into a code block. Plain-text and Markdown content (p3k-content-type) are unchanged. q=source answers the stored Markdown. Hand-written Markdown files keep html: true; this only changes what Micropub writes. Record the rule in decision-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Micropub create or update with HTML content stores Markdown that renders to the same structure (headings, paragraphs, emphasis, links, lists, images, code, blockquotes)
- [ ] #2 Pretty-printed, indented HTML never becomes a code block; markup Markdown cannot express stays as an unindented HTML block
- [ ] #3 Script, style, iframe, event-handler attributes and javascript: URLs sent by a client are removed; tests prove none reach the page
- [ ] #4 Text and Markdown content are unchanged; q=source answers the stored Markdown; decision-27 and README's Micropub section record the rule
- [ ] #5 A body as iA Writer sends it as HTML round-trips to sensible Markdown, tested with a captured or reconstructed request
<!-- AC:END -->
