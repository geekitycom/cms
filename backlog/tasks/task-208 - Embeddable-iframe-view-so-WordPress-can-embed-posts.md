---
id: TASK-208
title: Embeddable iframe view so WordPress can embed posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:40'
updated_date: '2026-10-01 19:22'
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
- [x] #1 Pasting a post URL into the WordPress block editor shows the embedded card, checked with WordPress's own oEmbed code or a real WordPress site
- [x] #2 Only the embed route can be framed by another origin; every other page still sends X-Frame-Options SAMEORIGIN and frame-ancestors 'self'
- [x] #3 The embed page shows only the card, never drafts, and nothing from an admin session
- [x] #4 The oEmbed html is the blockquote followed by a sandboxed iframe of the embed page, and consumers that strip iframes still get the blockquote
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. GET /_geekity/embed?url= reuses embeddableAt (published posts and pages only, drafts and scheduled 404) and answers a standalone HTML page: the oEmbed card plus inline style and a small inline script for WordPress's postMessage protocol (reads #?secret=, posts {message:'height'} on load/resize and on a 'ready' message, posts {message:'link'} on link clicks). No theme, no admin bar, nothing session-dependent.
2. Framing: the embed response sets its own Content-Security-Policy (frame-ancestors * plus a tight default-src 'none' policy with the script hash) and marks the context frameable so the baseline middleware leaves X-Frame-Options off for that response only. Every other route keeps SAMEORIGIN and frame-ancestors 'self'.
3. oEmbed html becomes blockquote + <iframe sandbox="allow-scripts" security="restricted" src=embed-url width height title frameborder=0 marginwidth=0 marginheight=0 scrolling=no style="position: absolute; visibility: hidden;">, matching WordPress's own provider output, so a consumer keeping the html shows the blockquote and one stripping iframes still has it.
4. Verify with WordPress's own wp_filter_oembed_result under PHP against the running demo, and in a browser with wp-embed.js hosting the filtered html: the iframe becomes visible with the card.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented plan steps 1-3; step 4 (WordPress PHP and browser check) left to the reviewer.

Route: GET /_geekity/embed?url= (EMBED_PATH in web/oembed.ts, mounted beside OEMBED_PATH). Resolves with embeddableAt exactly as oEmbed does; byline resolution moved into one embedSubject(c, found) helper that both handlers use. The card is built once by embedCard(subject) in oembed.ts; oEmbedFor (still pure) appends embedFrame(...) to it, and embedPage(subject) wraps it in a standalone document (doctype, lang from siteLocale, charset, viewport, robots noindex, title, inline style, inline script). embedResponse gives ETag/304 and cache-control no-cache like oEmbedResponse.

Headers: the response sets its own CSP, default-src 'none'; style-src and script-src by sha256 of the exact inline contents, computed at module load; base-uri 'none'; form-action 'none'; frame-ancestors *. No img-src, since the card has no image. The handler sets a typed frameable variable (GeekityEnv); applyBaseline skips x-frame-options when it is set, including one configured in securityHeaders (documented on GeekityConfig.securityHeaders and in the README security headers section). The 404 branch never sets it.

Found while testing: the publicAdminBar middleware injected the admin bar, its offset style and the session's CSRF token into the embed page for a signed-in request, and swapped its cache headers for private/no-store. publicAdminBar now leaves frameable responses alone. The 'same page for a signed-in admin' test caught it.

oEmbed html is now the blockquote followed by <iframe sandbox="allow-scripts" security="restricted" src=<absolute embed URL> width height title frameborder=0 marginwidth=0 marginheight=0 scrolling=no style="position: absolute; visibility: hidden;">.

Tests (src/web/oembed.test.ts, 10 new): embed page for post/page/note carries the oEmbed card and loads nothing; 404 and SAMEORIGIN for draft, scheduled, foreign origin, tag listing, page 2, empty url; CSP frame-ancestors * with hashes matching the inline contents and no X-Frame-Options even with securityHeaders X-Frame-Options DENY; post, oEmbed endpoint, 404 and /admin/login keep SAMEORIGIN and frame-ancestors 'self', and a site's own DENY stays on everything else; signed-in and anonymous get byte-identical pages and ETags with no set-cookie (and the signed-in post page does carry the bar); the oEmbed html ends with the iframe whose src resolves to the embed route under a base path; 304 on ETag; and the inline script run in node:vm against a stand-in frame: height on load, resize and ready (only with the matching secret), link clicks posted and prevented, nothing at all with no secret.

Mutation checks (scripted, each caught by at least one new test): baseline keeping XFO on frameable; handler never marking frameable; baseline dropping XFO everywhere; frameable set before the 404; admin bar on frameable pages; wrong style hash; frame-ancestors 'self'; oEmbed html without the frame; frame src pointing at the oEmbed endpoint; frame not hidden; ready accepted from any secret; link click not prevented; script active with no secret; ETag varying per response; page card differing from the oEmbed card; a draft served by the embed route.

Docs: README route table row and security headers paragraph; themes/default/README.md embed card paragraph.

Checks: pnpm build, test (3061 + 30 pass), typecheck, lint, format:check clean.

Orchestrator verification against the demo on :3417 with WordPress 7.1.2's own code (wp-includes/class-wp-oembed.php discovery plus wp_filter_oembed_result, run under PHP 8.5 with only HTTP and option functions stubbed). Discovery found /_geekity/oembed. The filter now returns the blockquote plus the sandboxed iframe with #?secret= and data-secret. Before this branch it returned false. The filtered html, hosted on another origin (:8765) with WordPress's own wp-embed.js in Chrome, ends with the iframe visible and the blockquote hidden. The frame reports height 151 and WordPress clamps it to 200. A same-origin copy of the page answers a dispatched click with {message:'link', value:<post URL>}, default prevented. The extension's synthetic click does not reach cross-origin frames, so the click path was checked this way. The real inline script ran under the embed CSP, so the hashes match in Chrome. Headers on the live demo: the embed sends frame-ancestors * and no X-Frame-Options, and the post page sends SAMEORIGIN and frame-ancestors 'self'. Observed: a frame loaded in a hidden background tab has a 0px viewport, so its first report is 2473px. When the tab becomes visible, the resize corrects it to 151 and then 200. The script is unchanged because no reader sees the hidden-tab value.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Each post and page now has an embed view at /_geekity/embed?url=. It is a standalone card page with a hash-pinned inline style and the WordPress height/link postMessage script. It is the only response another origin may frame: frame-ancestors * and no X-Frame-Options, via a typed frameable flag that the baseline headers and the admin bar both honour. The oEmbed html is now the blockquote followed by a hidden sandboxed iframe of that page, the shape WordPress's own provider sends. Verified with 10 HTTP tests and 16 mutation checks, WordPress 7.1.2's own discovery and filter code under PHP (previously it returned false), and wp-embed.js in Chrome swapping the card in at the right height.
<!-- SECTION:FINAL_SUMMARY:END -->
