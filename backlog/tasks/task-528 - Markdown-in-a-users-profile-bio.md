---
id: TASK-528
title: Markdown in a user's profile bio
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T13:59:00Z'
updated_date: '2026-10-29T14:30:00Z'
labels:
  - theme
  - markdown
  - federation
dependencies: []
priority: medium
type: feature
ordinal: 430800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A user's profile bio (Users > Edit > Bio, profile.bio) is plain text everywhere it goes. The default theme's partials/bio.njk prints it escaped as the card's p-note, so it appears under every post and page and on the author archive. The Markdown header prints it through escapeMarkdown, and partials/jsonld.njk gives it as the Person's description. The ActivityPub actor's summary (federation/actor.ts) is set from the raw string, so fediverse profiles show it, and because summary is HTML there, a < or & typed in the bio reaches remote servers unescaped.

So a bio can't link anything: not a 'start here' page for new readers, a project, an employer, or another piece of writing. A site that wants a linked introduction writes the h-card by hand in a page body as HTML, which then drifts from the profile and puts raw HTML in that page's Markdown and gemtext.

Proposal: treat the bio as a short piece of inline Markdown (links, emphasis, code; paragraphs optional) and render it once per format. HTML for the card and the actor summary, with no raw HTML (html: false, as comments/markdown.ts does), internal links made absolute where the output leaves the site. The Markdown as written, with site links rewritten through markdownUrl, for the .md and .gmi pages. Plain text for JSON-LD description and anywhere else that needs text. A bio with no Markdown in it renders as it does today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A bio containing [text](url) renders a working link in the default theme's bio card, keeping the card's p-note
- [x] #2 The .md page prints the bio's Markdown as written, with the site's own links given their .md URLs, and the .gmi page converts it to text plus link lines
- [x] #3 The ActivityPub actor summary is HTML rendered from the bio, with links absolute; raw HTML typed in a bio is escaped, never passed through; a plain-text bio with < or & is escaped correctly
- [x] #4 JSON-LD description and other plain-text uses get the bio's text with the Markdown removed
- [x] #5 A bio with no Markdown in it renders the same as today in every format
- [x] #6 The users admin form says the bio takes Markdown, and the theme docs give the bio's HTML, Markdown and text forms in the template context
- [x] #7 Tests cover a linked bio in the card, the .md and .gmi pages, the actor summary and JSON-LD, raw HTML in a bio, and an unchanged plain bio
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module packages/cms/src/site/bio.ts: bioHtml(bio, {baseUrl?}) renders with markdown-it html:false, schemed linkify, no typographer, links held to http/https/mailto or site-relative, relative hrefs made absolute when a baseUrl is given; bioText(bio) gives the inline text with the Markdown removed.
2. profileContext (site/authors.ts) adds bioHtml and bioText beside bio (the Markdown as written), so themes get all three forms.
3. Default theme: partials/bio.njk prints bioHtml in <div class="bio-note p-note">; jsonld.njk description uses bioText.
4. Markdown/gemtext: a markdownLinks filter in the Markdown environment rewrites a Markdown string's site links through the context's markdownUrl, leaving other links as written; markdown-bio.md.njk prints bio.note | markdownLinks instead of escapeMarkdown. md2gemini turns the inline links into text plus link lines.
5. federation/actor.ts summary = bioHtml with baseUrl (absolute links); admin federation panel shows bioText.
6. Users admin form hint says the bio takes Markdown; docs (template-context, markdown, gemini, federation, bylines as needed) give bio, bioHtml, bioText.
7. Tests first (tdd): unit tests for bio.ts; HTTP tests for card, .md, .gmi, actor, JSON-LD, raw HTML, plain bio; update existing expectations.
8. Run build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New packages/cms/src/site/bio.ts renders a bio: bioHtml (markdown-it, html: false, schemed linkify, links held to http/https/mailto or site-relative; with baseUrl, links made absolute via absoluteUrl) and bioText (inline tokens as text, paragraphs a blank line apart). profileContext adds bioHtml and bioText beside bio, which stays the Markdown as written, so third-party themes printing author.bio keep printing the same string.
Card: partials/bio.njk prints bioHtml in <div class="bio-note p-note">, since a bio may have several paragraphs and a <p> cannot hold them. For a plain bio the words and look are the same (Tailwind preflight zeroes p margins; added .bio-note p + p spacing), but the markup is now div > p rather than p. Actor summary is bioHtml with the base URL, so a plain bio is now '<p>text</p>\n' rather than the bare string; Mastodon shows it the same.
Markdown/gemtext: new markdownLinks filter in the Markdown environment runs rewriteMarkdownLinks with the context's markdownUrl, only rewriting links whose URL changes, so a bare external URL is left as typed. markdown-bio.md.njk prints bio.note | markdownLinks instead of escapeMarkdown. md2gemini turns inline links into text[n] plus '=> url n: url' link lines, the same as a post body.
JSON-LD Person description and the admin federation panel's summary use bioText. Users form hint says the bio takes Markdown.
Docs: bylines.md (bio, bioHtml, bioText rows and how to print each), page-shell.md (card and JSON-LD), markdown.md (bio.note is Markdown, markdownLinks filter, front page example), gemini.md (layout templates example), federation.md (summary is HTML from the Markdown bio, raw HTML escaped).
Tests: src/site/bio.test.ts (unit), src/web/bio-markdown.test.ts (HTTP: card, .md, .gmi, actor summary, JSON-LD, raw HTML, plain bio), admin users hint; updated expectations in entry, listings, layout-markdown, markdown-representation, authors, federation, delivery tests.
Verified: pnpm build && pnpm test (cms 7820 pass, 0 fail) && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A user's bio is now Markdown, rendered once per format. The default theme's card prints it as HTML (links, emphasis, code; raw HTML escaped) in a div.bio-note.p-note; the .md page prints it as written with site links given .md URLs through a new markdownLinks filter, and the .gmi page converts those to link lines; the ActivityPub actor summary is the HTML with site links made absolute; JSON-LD and the admin federation panel get the text with the Markdown removed. Themes get author.bio (Markdown), author.bioHtml and author.bioText. A plain bio reads the same everywhere; the card's markup is now div > p and the actor summary is wrapped in <p>. Full build, tests, typecheck, lint and format check pass.
<!-- SECTION:FINAL_SUMMARY:END -->
