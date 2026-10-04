---
id: TASK-258
title: Convert Micropub HTML content to clean Markdown
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 00:30'
updated_date: '2026-10-04 01:01'
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
- [x] #1 A Micropub create or update with HTML content stores Markdown that renders to the same structure (headings, paragraphs, emphasis, links, lists, images, code, blockquotes)
- [x] #2 Pretty-printed, indented HTML never becomes a code block; markup Markdown cannot express stays as an unindented HTML block
- [x] #3 Script, style, iframe, event-handler attributes and javascript: URLs sent by a client are removed; tests prove none reach the page
- [x] #4 Text and Markdown content are unchanged; q=source answers the stored Markdown; decision-27 and README's Micropub section record the rule
- [x] #5 A body as iA Writer sends it as HTML round-trips to sensible Markdown, tested with a captured or reconstructed request
- [x] #6 Text and Markdown content from a Micropub client has every raw HTML token (html_block, html_inline, as the site's markdown-it reads it) run through the same allow-list, with the rest of the text kept exactly as sent; markdown-it's link validation blocks javascript: in [text](url), proven by a test; the editor and hand-written files stay unsanitized, as decision-27 records
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. web/sanitize.ts gains cleanPostHtml: the existing tag scanner run as a pure tag filter with a post allow-list (headings, lists, tables, figure, details, img src/alt, code/pre, blockquote, a with http(s)/mailto/relative), canonical rebuilt tags, script/style/iframe/object/svg/... dropped with their content, layout and text kept. No tree balancing, so a partial fragment (an html_block that opens <details>) keeps its shape. The comment sanitizer is untouched.
2. content/markdown.ts records where each html_inline token starts in its inline source and exports the token stream of the site's own instance.
3. micropub/clean-content.ts: cleanMarkdown rewrites each dirty html_block (its source lines) and html_inline (located by its offset) with cleanPostHtml, re-parses and fails closed if any HTML is still dirty or the non-HTML tokens changed. markdownFromHtml runs cleanPostHtml, then turndown (atx headings, fenced code, '<' and entity '&' escaped in text) keeping tables/figure/details/etc as unindented HTML blocks and sub/sup/etc inline, then cleanMarkdown as a final gate.
4. create.ts content() uses both; update reuses createForm so replace/add are covered; q=source reads the stored body.
5. Tests per criterion as an attacker, iA Writer reconstructed body, render checks through renderMarkdown.
6. decision-27 amendment and README Micropub section.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Library: turndown 7.2.4 (MIT, maintained, domino parser bundled). @types/turndown dropped: it needs the browser DOM lib, so src/micropub/turndown.d.ts types the parts used. turndown-plugin-gfm not added (unreleased since 2017); tables stay as HTML blocks, strikethrough is a small rule.
Sanitizer: cleanPostHtml added to web/sanitize.ts on the existing tag scanner, as a tag filter without balancing (the comment sanitizer's implicit closing breaks nested lists and can't clean fragments). Comment sanitizer untouched.
Scope addition from the site owner (AC #6): Markdown/text content has each html_block and html_inline token, read by the site's markdown-it instance, cleaned in place; html_inline offsets recorded by a rule in content/markdown.ts; fixpoint re-read; unfindable HTML refused with 400.
Found while testing: turndown does not escape '<' in text, so HTML text '&lt;script&gt;' became a live <script> in Markdown; escape override fixed, tested. Double-encoded 'javascript&amp;#58;' guarded by a non-decoding attribute escape, tested.
iA Writer body: reconstructed (no capture available), tested in content.test.ts AC #5.
Validation: pnpm build, pnpm test (3868 + 30 pass), typecheck, lint, format:check all pass. Live: local site on :48731, curl JSON {html} create with pretty-printed div/table, onerror, javascript: link, script -> 201, file holds Markdown with unindented <table> block, q=source returns it, page has 0 'alert('; form Markdown create with <img onerror> and <script> -> stored 'Markdown *kept* <img src="x">'.

Red-team follow-up (two reviewers, commit 7e8fbb1). Found: the string cleaned was not the string stored. (1) normalizeBody trimmed after cleaning, so '    <script>…', '\t<img onerror>', '    <svg onload>', '    <base href=javascript:>' passed as indented code blocks and became live HTML once stored. (2) A lone \r: markdown-it breaks a line on it but dirtyHtml's lineStarts used \n only, so html_block maps pointed past the source and the cleaned region was empty.
Fix: cleanMarkdown normalises first (normalizeBody: \r\n? -> \n, trim; NUL -> U+FFFD as markdown-it does), cleans that, normalises the result and refuses unless re-cleaning it changes nothing. createForm's content() repeats that fixed-point guard on the exact body it stores, for HTML and Markdown alike (400 'content has HTML the site cannot clean.'). Payloads added as failing tests first: content.test.ts (Markdown and HTML paths) and html-content.test.ts (endpoint create, page rendered). decision-27 amendment updated.
Sweeps after the fix: redteam-a/probe.ts 110 payloads, 1 flag (abbr title="javascript:…", inert tooltip text, agreed non-finding), 0 refused; redteam-a/confirm.ts every indented payload stores as <img src="x"> or empty, mid-body indented code stays escaped code; redteam-b/run.mts 239 payloads, 0 flagged, 4 refused fail-closed (multi-line tag in a quote, list or footnote, inline footnote with dirty HTML); redteam-b/x.mts all inert.
Gate: pnpm build, test (3884 + 30 pass), typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub content is cleaned at the boundary in createForm (create and update). {html} goes through cleanPostHtml (new post allow-list in web/sanitize.ts) then turndown to Markdown, with tables/figures/details/dl kept as unindented HTML blocks and '<'/entities escaped in text. Text/Markdown keeps its text and has each markdown-it html_block/html_inline token cleaned in place, failing closed when HTML cannot be located. q=source answers the stored Markdown; editor and hand-written files are untouched. decision-27 amendment and README Micropub section record the rule. Verified by content.test.ts (attacker cases, pretty-printed HTML, reconstructed iA Writer body), html-content.test.ts (endpoint create/update/q=source/page), full suite, typecheck, lint, format, and a curl run against a local site.
<!-- SECTION:FINAL_SUMMARY:END -->
