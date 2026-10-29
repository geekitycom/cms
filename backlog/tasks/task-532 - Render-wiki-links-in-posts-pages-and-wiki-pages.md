---
id: TASK-532
title: Render [[wiki links]] in posts, pages and wiki pages
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T20:10:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-529
references:
  - decision-66
ordinal: 434800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: writing [[Some page]] should link to /<wiki_base>/some-page/ without looking up the URL. The body Markdown keeps the [[ ]] syntax; it is resolved at render time by a markdown-it inline rule, as fediverseHandles is (src/content/markdown.ts). Links are written whether or not the target exists, so stored HTML depends only on the body and the base. The link parser in src/content/markdown-links.ts mirrors the main plugin set and must get the rule too, or the .md and .gmi representations keep the raw brackets.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `[[Target]]`, `[[Target|text]]`, `[[Target#Heading]]` and `[[Target#Heading|text]]` render as `<a class="wiki-link" href="/<wiki_base>/<slugify(Target)>/#<heading slug>">`, with the heading slug matching headingAnchors
- [x] #2 A target that slugifies to nothing, code spans, code blocks and an escaped `\[[` stay literal
- [x] #3 The `.md` representation shows an ordinary Markdown link and the Gemini representation a link line; feeds, ActivityPub and backlinks get the real link from the stored HTML
- [x] #4 The admin preview renders wiki links the same way; comments do not
- [x] #5 Changing `wiki_base` re-renders every document whose body has a wiki link
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/content/wiki-links.ts: parse [[Target]], [[Target|text]], [[Target#Heading]], [[Target#Heading|text]] at an inline position and a markdown-it plugin (inline rule before 'link') that pushes <a class="wiki-link" href="/<base>/<slugify(Target)>/#<slugify(Heading)>">; base read from the parse env, default base otherwise. Empty slug, code and escaped \[[ stay literal.
2. renderMarkdown gains an optional wikiBase argument; parseDocument and the admin preview pass the site's base.
3. markdown-links.ts registers the same rule and records each wiki link's whole span; rewriteMarkdownLinks takes the wiki base and always writes [text](href) for a wiki link (the site rewrite when it answers, the site path otherwise). markdown-representation passes the base, so .md has a Markdown link and .gmi a => line.
4. Reconciler: a document whose body has [[ is also re-indexed when its rendered HTML differs, so a new wiki_base re-renders it (scan origin, so nothing federates). Bodies without [[ keep the hash + permalink check only.
5. Tests: markdown.test (AC1/2), markdown-links.test, wiki-pages.test over HTTP (HTML, index.md, index.gmi, feed, backlinks, base change), preview test, comment markdown test, sync test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: src/content/wiki-links.ts holds the inline rule (before markdown-it's 'link'), registered in the site renderer (markdown.ts) and the link parser (markdown-links.ts). The base comes from the parse env; renderMarkdown(body, handles?, wikiBase?) and rewriteMarkdownLinks(body, rewrite, wikiBase?) take it. parseDocument and the admin preview pass the site's base; markdown-representation passes siteView(c).bases.wiki for the document body and a posts page's body.
Choices: link text is plain text (escaped), not inline Markdown. Inside [x](url) the wiki link wins and the outer brackets stay literal, as CommonMark does for an inner link. A missing target in .md keeps the site path (/wiki/slug/) since siteHrefFor has no page to rewrite to; existing targets get index.md / index.gmi. md2gemini writes inline links as numbered => lines after the paragraph, so the .gmi shows 'the tools[1]' and '=> /wiki/garden-tools/index.gmi 1: ...'.
Re-render on base change: the reconciler now also re-indexes a document whose body contains '[[' when its fresh HTML differs from the stored HTML. Bodies without '[[' keep the old hash+permalink check, so handles resolved later still do not re-index anything. The change is emitted with origin 'scan', which federation, notify and IndexNow ignore.
Not touched: write.ts and editor-actions.ts renderMarkdown calls (alt-text and text-only uses where the href does not matter); the markdownLinks Nunjucks filter used for the bio (not a post/page/wiki body); comments' own renderer.
Evidence: markdown.test (AC1/2), markdown-links.test, comments/markdown.test, admin/wiki.test preview under wiki_base=notes, sync.test re-render, web/wiki-pages.test over HTTP (HTML, /feed/ content:encoded, backlinks on the target, index.md, index.gmi, base change via the admin settings save). pnpm build/test (cms 7891 pass)/test:11ty/typecheck/lint/format:check all exit 0. Curled a scratch server on port 3911: HTML has <a class="wiki-link">, index.md has [the tools](/wiki/garden-tools/index.md), index.gmi has => lines, heading anchor matches the target's id="in-the-shed". Base change over a live server not curled (wiki_base is saved through the admin; proven by the app.request test).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wiki links render at parse time: [[Target]], [[Target|text]], [[Target#Heading]] and [[Target#Heading|text]] become <a class="wiki-link" href="/<wiki_base>/<slug>/#<heading-id>"> in posts, pages and wiki pages, via one markdown-it inline rule (src/content/wiki-links.ts) shared by the renderer and the link parser. The .md representation gets ordinary [text](url) links and the .gmi numbered => link lines; feeds, ActivityPub and backlinks read the stored HTML. The admin preview uses the site's base; comments keep their own renderer and the brackets. A wiki_base change re-indexes every document whose body has [[ and whose HTML changed (scan origin, nothing federates). Verified with unit and HTTP tests and the full build/test/typecheck/lint/format run. Risk: a site with many [[ bodies re-renders them all on a base change, which is the intent.
<!-- SECTION:FINAL_SUMMARY:END -->
