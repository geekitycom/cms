---
id: TASK-294
title: Embed a video in a post without writing iframe HTML
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:05'
updated_date: '2026-10-09 15:27'
labels: []
milestone: m-31
dependencies: []
priority: medium
ordinal: 254800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An author who wants a YouTube or Vimeo video in a post today pastes the provider's <iframe> code into the Markdown. That is HTML the author has to fetch, read and trust, it differs per provider, and it leaves no clean source behind in the file. Geekity should have one official, documented way to put a video in a post, written in the Markdown source without iframe code, that the site renders as a working player.\n\nHow it is written (a bare URL on its own line, a directive, a front matter key or something else) and how it renders (a direct iframe, a click-to-load facade, oEmbed or something else) are decisions for whoever picks this up. They are not settled here.\n\nThe andrewshell.org migration has 12 videos from the Eleventy site ({% youtube %} 9 times, {% vimeo %} 3 times) and YouTube links in 14 WordPress posts, so the importer will need a form to convert them to.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post can include a YouTube or Vimeo video using only something written in its Markdown source, with no iframe HTML
- [x] #2 The published page shows a working, responsive player for the video
- [x] #3 The Markdown, JSON, text/plain and feed representations of the post carry something meaningful for the video, at least a link to it
- [x] #4 Adding a video from the editor does not require writing that syntax by hand
- [x] #5 The chosen syntax, which providers it supports and how it renders are recorded in a decision, and doc-2 and the default theme README document it
- [x] #6 A video URL the feature does not recognise stays a plain link
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Syntax: a YouTube or Vimeo URL alone in its own top-level paragraph (a bare URL on a line of its own, as WordPress, Ghost and GitHub do). The Markdown, text/plain and JSON markdown carry the URL as written; [text](url) with link text stays a link, which is the escape hatch.
2. New src/content/video.ts: videoOf(url) parses a URL into {provider, id, start?|hash?} or undefined (YouTube watch/shorts/embed/live and youtu.be with t/start; Vimeo /ID, /ID/HASH, /channels/x/ID, player.vimeo.com/video/ID?h=). videoEmbedHtml renders figure.video-embed > iframe (youtube-nocookie.com, player.vimeo.com with dnt=1, loading=lazy, title, allow, referrerpolicy, 560x315) + figcaption link to the URL, so feeds, JSON html and readers that strip iframes still get a link.
3. markdown.ts: a core rule after linkify replaces a lone-link paragraph whose link text is its own URL with that html_block when videoOf recognises it; anything else stays a link.
4. Default theme CSS: .video-embed iframe full width, aspect-ratio 16/9.
5. Editor: an Add video button in editor/main.ts that takes a URL, refuses one videoOf does not recognise, and inserts it as its own paragraph (pure helper unit tested; button checked in headless Chrome).
6. Decision record, doc-2 Markdown dialect section, default theme README section.
7. Tests first for each AC: markdown render, document representations (md, text, json, feed), unrecognised URL stays a link; then pnpm build/test/typecheck/lint/format:check and curl the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Syntax: a YouTube or Vimeo URL that is a top-level paragraph by itself (bare or <...>) plays as the video (decision-34). videoOf in packages/cms/src/content/video.ts is the one recogniser; a markdown-it core rule (videoEmbeds in content/markdown.ts) swaps a lone autolink paragraph it recognises for figure.video-embed > iframe (youtube-nocookie.com or player.vimeo.com?dnt=1, loading=lazy, 560x315) + figcaption link to the URL as written. No inline style; the default theme makes .video-embed iframe full width at 16:9.
Representations: md and text/plain are the file so carry the URL; JSON carries it in markdown and the player+link in html; RSS, Atom and JSON feeds carry the player and the link (src/web/video-embed.test.ts).
Editor: Add video button next to Add file (editor/main.ts) opens an address field, refuses anything videoOf does not recognise, and inserts via ownParagraph (src/admin/own-paragraph.ts), which puts the URL between blank lines and the cursor after them.
Verification: unit tests (video.test.ts 34, own-paragraph.test.ts 10), site tests (video-embed.test.ts 7, fail 6 of 7 with the rule switched off). Live: geekity serve on a scratch site; curl showed both players, the playlist URL left a plain link, text/plain carrying the URL, and the feed carrying player and link. Headless Chrome over CDP: players load (screenshots show YouTube and Vimeo posters), iframe width equals the text column at 1280 (702x395) and 375 (330x186); in /admin/posts/new Add video refused https://example.com/not-a-video with an error, inserted https://youtu.be/dQw4w9WgXcQ as Some words.\n\nURL\n\nMore words., and the Preview tab rendered a figure.video-embed.
Known limits (in decision-34): the admin preview is a sandboxed srcdoc frame under frame-src 'self', so a video there is an empty box with its link; a site adding its own CSP via securityHeaders must allow the two player hosts. Gates: pnpm build, test (cms 5098 pass), typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A YouTube or Vimeo URL on a line of its own now plays as the provider's privacy-enhanced player (youtube-nocookie, Vimeo dnt=1), lazily loaded in figure.video-embed with the URL linked beneath, so feeds, JSON and the fediverse keep a link; Markdown and text/plain carry the URL as written; anything unrecognised stays a link. The editor gains an Add video button that validates the address and inserts it as its own paragraph. decision-34 records the syntax, providers and rendering; doc-2 and the default theme README document it. Verified with unit and site tests, curl against geekity serve, and headless Chrome (players load, responsive at 1280 and 375, Add video refuses and inserts correctly).
<!-- SECTION:FINAL_SUMMARY:END -->
