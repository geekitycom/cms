---
id: decision-34
title: >-
  A YouTube or Vimeo URL on a line of its own is a video: it renders as the
  provider's privacy-enhanced player with the URL linked beneath it
date: '2026-10-09 15:20'
status: accepted
---
## Context

TASK-294. An author who wanted a YouTube or Vimeo video in a post pasted the provider's `<iframe>` code into the Markdown: HTML they had to fetch and trust, different per provider, and not a clean source. The andrewshell.org migration brings 12 videos from Eleventy shortcodes (`{% youtube %}` 9 times, `{% vimeo %}` 3 times) and YouTube links in 14 WordPress posts, which WordPress auto-embedded because each sat on a line of its own.

The body has to read well everywhere it goes: the page, the Markdown and text/plain representations (which are the file's body), the JSON (body and HTML), the RSS, Atom and JSON feeds, the fediverse (Mastodon keeps links and drops iframes) and the WordPress-style embed view (whose policy is `default-src 'none'`, so it frames nothing).

Options weighed for the syntax: a bare URL on its own line; a fenced or `::video` directive; a front matter key; a Liquid-style shortcode. Options for the rendering: the provider's iframe; a click-to-load facade; oEmbed fetched at render time.

## Decision

**Syntax.** A YouTube or Vimeo URL that is a top-level paragraph by itself, written bare or in `<…>`, is a video. Nothing else is: a URL with words beside it, a `[link](url)` with words of its own, a URL in a list item or a blockquote, and any URL the recogniser below does not know all stay ordinary links. A `[link](url)` is the way to write a video's address without embedding it.

This is the convention WordPress, Ghost and Medium share, so a WordPress post's video needs no conversion, an Eleventy shortcode converts to one line, and the source reads as a link in any Markdown renderer, Eleventy included (which prints it as text).

**Providers.** Read by `videoOf` in `packages/cms/src/content/video.ts`, the one recogniser, which the editor's bundle shares:

- YouTube: `youtube.com`, `www.` and `m.` with `/watch?v=ID`, `/shorts/ID`, `/embed/ID` or `/live/ID`; `youtu.be/ID`; `www.youtube-nocookie.com/embed/ID`. The ID is 11 characters of `[A-Za-z0-9_-]`. A `t` or `start` query of seconds or `1h2m3s` becomes the player's start time.
- Vimeo: `vimeo.com/ID`, `vimeo.com/ID/HASH` (an unlisted video), `vimeo.com/channels/NAME/ID` and `player.vimeo.com/video/ID` with an optional `h=HASH`.

Playlists, channels, profiles and every other host stay links.

**Rendering.** The URL becomes

```html
<figure class="video-embed video-embed-youtube">
<iframe src="https://www.youtube-nocookie.com/embed/ID" width="560" height="315" title="YouTube video" loading="lazy" allow="…" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
<figcaption><a href="URL">URL</a></figcaption>
</figure>
```

on one line, with `video-embed-vimeo`, `https://player.vimeo.com/video/ID?dnt=1` (and `h=` for an unlisted video) and `Vimeo video` for Vimeo. The players are the providers' privacy-enhanced ones: YouTube's no-cookie host, and Vimeo's `dnt=1`. `loading="lazy"` keeps a player below the fold from loading until the reader nears it. The core sets no inline style: `width` and `height` give a theme that does nothing the providers' standard 560 by 315 player, and a theme makes it responsive by styling `.video-embed iframe` (the default theme sets it full width at 16:9).

The figcaption link is the same in every HTML the post goes out as, so a feed reader, a fediverse server or the embed view that drops the iframe still shows the video's address. The Markdown and text/plain representations carry the URL as written, because they are the file.

**Editor.** The post and page editor has an Add video button next to Add file. It asks for an address, refuses one `videoOf` does not recognise, and inserts it as a paragraph by itself at the cursor (`ownParagraph`, `packages/cms/src/admin/own-paragraph.ts`).

## Consequences

- Nothing about a video is stored: no front matter, no data file, no fetch. A post's video is its source line, and the WordPress importer's job (TASK-291) is to write that line.
- No click-to-load facade. A facade needs a thumbnail, which YouTube serves from a fixed URL and Vimeo only through its API, and JavaScript on the page. The no-cookie player with `loading="lazy"` gets most of the privacy for none of that. A theme that wants a facade can replace `.video-embed` on the client.
- No oEmbed at render time. It would make rendering depend on the network, and the providers' oEmbed HTML is the same iframe.
- A provider is one branch in `videoOf` and one in `playerOf`. Adding one (PeerTube, say) is that and a line in doc-2.
- The labels `YouTube video` and `Vimeo video` (the iframe titles) are English, like the rest of the core's own wording in a body.
- The admin preview is a sandboxed `srcdoc` frame under the admin's `frame-src 'self'`, so a video in the preview is an empty box with its link beneath. The page itself plays it.
- The public site sends no `frame-src`, so a site that adds a `Content-Security-Policy` of its own through `securityHeaders` must allow `https://www.youtube-nocookie.com` and `https://player.vimeo.com` in it for the players to load.
