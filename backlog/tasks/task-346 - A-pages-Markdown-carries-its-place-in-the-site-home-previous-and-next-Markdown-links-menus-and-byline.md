---
id: TASK-346
title: >-
  A page's Markdown carries its place in the site: home, previous and next,
  Markdown links, menus and byline
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 13:43'
updated_date: '2026-10-11 14:40'
labels:
  - public-site
  - indieweb
dependencies:
  - TASK-345
references:
  - 'https://md.geekity.com/'
priority: medium
type: feature
ordinal: 305800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Andrew, 2026-10-11: the Markdown versions of pages should be pleasant to browse in a Markdown browser such as https://md.geekity.com/, his implementation of Dave Winer's Markdown Browser spec (https://gist.githubusercontent.com/scripting/c81461104f079b7a017802286853c4f1/raw/5b8c3d99149fce34bbe1e6066cce1098e07bb709/markdownbrowser.md), with language models still the main readers. The browser parses `home`, `previous` and `next` from front matter.

The spec's rules that matter here: a link to a `.md` document is internal and loads in the browser; an http(s) link is external; there is no content negotiation, so a link to one of the site's pages must point at its `.md` URL to stay in the Markdown web. Front matter is optional and describes structure, never presentation; the suggested fields are `title`, `previous`, `next` and `home`.

Today a document's `.md` is its front matter (with `author` as a username) and its body. Links in the body point at HTML URLs, there is no navigation, and no bio anywhere (the author archive's `.md` is a heading and a list).

**Design settled 2026-10-11 (Andrew):**
- Themes own the chrome, code owns the contract. The default theme ships `partials/markdown-header.md.njk` and `partials/markdown-footer.md.njk` on the theme search path, the way mail templates are (`.txt.njk`), and a site theme overrides either. Code keeps the front matter (`title`, `permalink`, `home`, `previous`, `next`, `author`), the document's own body, and the rewriting of the site's own links. The partials get the HTML context (menus, the author and bio, soloAuthor, newestPosts, site) plus a filter that escapes Markdown.
- Shaped for a later Gemini (gemtext) renderer, which links one URL per line and has no inline links, rules or chrome (research: geminiprotocol.net gemtext spec, subscription companion spec). Navigation stays data until it is written: menus, home, previous, next, the byline and the bio reach templates as lists of label and URL, never pre-rendered Markdown. Store canonical permalinks and add the `.md` suffix only when writing, so a `.gmi` renderer can use the same data.
- The footer is a heading followed by link lists, not a sentence after a horizontal rule; the byline is a link line, not a link inside a sentence.
- Dated post lists (listings, the author archive) show each post as `YYYY-MM-DD Title`, which maps straight onto a gemlog index.
- Front matter keeps the author's username beside the display name.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every document's Markdown has front matter `home: /index.md`; a post has `previous` and `next` naming the same neighbours as the HTML post navigation; a paginated listing page has `previous` and `next` naming its newer and older pages; all as root-relative `.md` URLs, absent when there is no neighbour
- [x] #2 Every link to a document on this site in a Markdown representation (the body, listings, the footer, llms.txt) points at that document's `.md` URL; external links and images are unchanged; the `.md` suffix is added when the representation is written, not stored
- [x] #3 A document's Markdown header and footer come from `partials/markdown-header.md.njk` and `partials/markdown-footer.md.njk` in the default theme, overridable by a site theme like any partial; the front matter, the body and the link rewriting are not template-controlled
- [x] #4 The default footer is a heading followed by link lists: a byline link line to the author's Markdown (posts) and the site's menus, each item with its own label; the partials receive menus, byline and bio as data (label and URL), and a Markdown-escaping filter keeps labels literal
- [x] #5 The author archive's Markdown starts with the author's bio; on a solo-author site the homepage's Markdown carries it too
- [x] #6 Listings and the author archive list each post as `YYYY-MM-DD Title` linking its Markdown
- [x] #7 Front matter `author` is the author's display name, and the username is kept beside it
- [x] #8 llms.txt has a Navigation section with the same menus
- [x] #9 Checked by browsing a served site in https://md.geekity.com/: Home, Previous and Next work and following links stays in Markdown; doc-3, docs/public-site.md and the theme docs describe the Markdown layout and what a theme can override
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: MarkdownLink {label, url} with url the canonical (served) path, never .md; MarkdownChrome context for the partials: site, menus, home, previous, next, byline, bio {name, url, note, links}, heading. Paths stay canonical; the writer adds .md.
2. One resolver, markdownHref(href, pageUrl) in web/routes.ts: an own-site URL that lands (through the homepage rule, redirect_from, query and path redirects, via links.ts's exported landing) on a served document or a listing becomes representationHref(servedPath, 'markdown') with its fragment; anything else comes back unchanged. Used for the body, the partials (markdownUrl filter), listings and llms.txt.
3. content/markdown.ts: markdownLinks(body), a markdown-it pass that records each inline link's, autolink's and linkified URL's destination range and each reference definition's, outside code; rewriteMarkdownLinks(body, rewrite) applies the edits. Images, code and raw HTML untouched.
4. Renderer.renderMarkdownChrome(context) renders partials/markdown-header.md.njk and partials/markdown-footer.md.njk through a twin environment with autoescape off (mail precedent), adding the escapeMarkdown and markdownUrl filters. Default partials: header prints the bio (author archive, solo homepage); footer is a heading then link lists (byline link line, menus).
5. Markdown writer (web/markdown-page.ts): front matter (document front matter, author as display name with author_username beside it, home, previous, next) + header + body + footer. negotiateDocument and listingMarkdown both use it; listings list posts as YYYY-MM-DD Title; listing pages carry previous/next front matter.
6. llms.txt: LlmsEntry.href becomes the canonical path; llmsTxt adds .md when writing; a Navigation section lists the menus.
7. Tests first per AC; update existing exact-body tests.
8. Docs: doc-3, docs/public-site.md, docs/theme (template-context or a new markdown page), default theme README.
9. Verify: build/test/typecheck/lint/format; serve a scratch site; browse it in a local mdbrowse with Playwright.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: MarkdownLink {label, url} with url the canonical served path; MarkdownChrome (url, title, home, previous, next, byline, bio) is what the partials get beside site, menus, navigation and soloAuthor. The .md is added only when written: by the markdownUrl filter in the partials, and by markdownUrlFor/markdownHrefFor in web/routes.ts for front matter, listings and llms.txt (LlmsEntry.href is now the canonical path).
One resolver: markdownHrefFor(c, pageUrl) reads a link with siteLinkAt (webmention/links.ts, factored out of ownSiteLinks) and follows it with links.ts's landing (now exported, the TASK-330 walk): query redirects, served document or former permalink or listing, declared path redirects. The target's servedPath gives the .md, so the homepage is /index.md. Fragment kept; anything else unchanged (/search/, /feed/, uploads, other sites).
Body rewrite: content/markdown-links.ts rewriteMarkdownLinks(body, rewrite), a markdown-it pass (same options as the site renderer) that wraps the link, autolink and linkify inline rules and the reference block rule to record destination ranges, maps inline content back to source lines, and only edits a range that spells what the parse read. Images, code spans and blocks, raw HTML untouched; an autolink or bare URL to the site becomes [url](.md).
Chrome: Renderer.renderMarkdownChrome renders partials/markdown-header.md.njk and partials/markdown-footer.md.njk through markdownEnvironment (autoescape off, the mail precedent) with escapeMarkdown and markdownUrl filters. Default header: title heading (absent when the body opens with its own H1) then the bio; default footer: ## site title, [Written by Name](archive) link line on posts, then navigation (navigationLinks: every menu item once, also llms.txt's Navigation section) as one list.
Front matter: documentFrontMatter plus author as display name with author_username beside it, then home, previous (older post / newer listing page), next. Listing Markdown gains front matter title, permalink, home, previous, next; posts listed as - [YYYY-MM-DD Title](/x/index.md): description, root-relative (were absolute).
Deleted: llmsListingTxt and LlmsListing (llms.ts), documentMarkdown's serializeDocument path, the .md baked into llmsEntry.href. JSON and feeds unchanged; JSON frontMatter keeps author as stored.
HTML unchanged: the anonymous-pages golden (admin-bar.test.ts) changed only in the post Markdown body and its ETag.
Verification: pnpm build, test (cms 5481 pass, demo 32, plugins all pass), typecheck, lint, format:check all exit 0. Mutation checks: dropping the body rewrite, the navigation front matter, namedAuthor or the homepage bio each fails markdown-representation.test.ts. Scratch site (static homepage about, posts page news, solo author ada, ?p=3 redirect, redirect_from): a crawl from /index.md over front matter and body links visited 10 Markdown URLs, all 200 text/markdown; the only site links without .md are /search/ and /feed/, which have no Markdown. Local mdbrowse (MDBROWSE_ALLOW_PRIVATE=true, Playwright on Chrome for Testing): opened /, homepage shows the bio; footer News link, status-bar Next and Previous on the posts page listing, a listing entry, Previous and Next between posts, body links via /?p=3 and a relative ../first/#top, the footer byline to the author archive (with bio), and Home all navigated inside mdbrowse. Screenshots in the session scratchpad shots/. md.geekity.com itself cannot reach a local server; browsing it there needs a deployed site.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A page's Markdown now carries its place in the site. Front matter adds home: /index.md, previous and next (a post's HTML neighbours, a listing's newer and older pages) as root-relative .md URLs, and author as the display name with author_username beside it. Every link to a document or listing of the site, in the body (a markdown-it pass over the source, through the homepage rule, redirect_from and declared redirects), listings, the footer and llms.txt, points at its .md; the suffix is added only when written. The header and footer come from partials/markdown-header.md.njk and partials/markdown-footer.md.njk (autoescape off, escapeMarkdown and markdownUrl filters), overridable by a site theme; the default footer is a heading, a byline link line and the site's navigation; the author archive and a solo author homepage carry the bio; dated lists read YYYY-MM-DD Title; llms.txt has a Navigation section. Verified by src/content/markdown-links.test.ts, src/web/markdown-representation.test.ts, the full build/test/typecheck/lint/format:check run, a crawl of a served scratch site, and browsing it in a local mdbrowse with Playwright. doc-3, docs/public-site.md, docs/theme/markdown.md, docs/theme/filters.md and the theme READMEs describe it.
<!-- SECTION:FINAL_SUMMARY:END -->
