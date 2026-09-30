---
id: doc-9
title: 'Paper: the default theme design'
type: specification
created_date: '2026-09-30 20:58'
updated_date: '2026-09-30 21:26'
tags:
  - theme
  - design
  - tailwind
---
# Paper: the default theme design

The design the default theme is restyled to, chosen on 2026-09-30 from three Tailwind mockups (Paper, Stream, Ledger). This document is the whole specification: what the design is, how it tells one kind of post from another, the tokens and type, and the mockup's stylesheet and markup as appendices. A worker on the task that builds it should need nothing else, but the mockup itself is on the dev server at `_local/mockups/indieweb-themes/` (git-ignored; `node build.mjs` rebuilds, `./serve.sh` serves it at https://3000.code01.geekity.com/paper/ when running) with full-page screenshots of every page at 1280 and 390 wide, light and dark, in its `shots/` directory as `paper-*.png`.

## In one paragraph

One warm column, 42rem wide, serif throughout, with sans-serif reserved for small labels. Only an article has a headline. Every other kind of post is its words, set under a small-caps **kicker** that names the kind and the date. The site title is large on the front page and a small link home everywhere else, with the site menu beside or under it. Entries in a listing are separated by hairline rules. Citations (what a reply answers, what a like or bookmark points at) are a left-ruled block with a sans line and an italic quote. The bio, the previous/next cards, the facepiles, the reply thread and the comment form all follow the same restraint: sans small-caps labels, serif words, one accent colour for links and kinds, a second for tags.

It is a refinement of the current default theme (decision-16) rather than a departure: the same paper, ink, rust and blue, the same 18px serif root, the same measure, the same microformats. What changes is the typography (serif headings, a real type scale, italic decks and quotes), the kicker that makes the kind of a post legible, and the stylesheet, which becomes Tailwind compiled at build time.

## Principles

- **Fast.** One compiled stylesheet, no runtime JavaScript, no web fonts, no CDN. Icons, where any, are inline SVG. The highlighter loads only on a page with a code block, as now.
- **Microformats unchanged.** `h-feed`, `h-entry`, `p-name` only on a named post, `e-content`, `p-summary`, `dt-published`, `dt-updated`, `u-url`, `p-category`, `p-author h-card` with `rel="me"` links, and `u-in-reply-to h-cite` on a reply. An untitled post keeps the screen-reader-only `h1` TASK-144 added.
- **The kind is said once, small.** A kicker above the entry, never a badge or an icon. Articles are additionally the only thing with a headline, so the eye finds them without reading the kicker.
- **Dark mode follows the system**, the same design on dark paper. Both schemes meet WCAG 2.2 AAA for text (7:1) and AA for non-text (3:1); see Tokens.
- **Every standalone link and control is at least 24 by 24 CSS px** (WCAG 2.5.8, the checklist's Touch target size rule): the `target` utility (`inline-flex items-center min-h-6 min-w-6`) goes on the site and footer menus, kicker links, Continue reading, the front links, tags, the Published link, the bio's links, citation titles, comment authors, dates and Reply links, and the form controls. Links inside a sentence (the bio line, prose, the comment-help line) keep the inline exception, as TASK-145 decided. The mockup's `targets.mjs` measures every link and control on every page at 390px and lists what is under 24px; only sentence links remain.
- **A link is never marked by colour alone** (WCAG 1.4.1). Every link outside prose is underlined at rest, and hover and focus change more than its colour; see Links under Layout.
- **Semantic class names, styled with `@apply`.** Templates stay readable Nunjucks, the stylesheet is the one place the look lives, and a site theme that has CSS for the existing class names keeps most of it.

## Tokens

The mockup names its tokens `paper`, `ink`, `muted`, `accent`, `accent-2`, `rule`, `edge` and `surface`. The default theme keeps its existing `--color-*` custom property names (they are the README's documented override contract and `src/web/theme-colors.test.ts` reads them) and gives them these values; Tailwind utilities map onto them through `@theme inline`.

| Mockup token | Theme token | Light | Dark | Used for |
| --- | --- | --- | --- | --- |
| paper | `--color-body` | `#faf7f2` | `#171412` | The page background, and the text of a filled button |
| ink | `--color-text` | `#1c1917` | `#ece6de` | Body text, headlines |
| muted | new: `--color-muted` | `#534c46` | `#b2aaa0` | Kickers, dates, meta lines, decks, quotes, the bio note, footer |
| accent | `--color-primary` | `#8c2f1f` | `#ee9370` | Links, the kicker's kind word, the citation rule, the submit button |
| accent-2 | `--color-secondary` | `#2b5580` | `#86b8e2` | Tag links, focus outlines |
| rule | new: `--color-rule` | `#e4dccf` | `#3a332e` | Decorative hairlines only: between entries, above the footer, beside nested comments |
| edge | new: `--color-edge` | `#8a867e` | `#706a67` | Borders a reader relies on: form fields, the previous/next cards, code blocks |
| surface | `--color-base` | `#f3eee5` | `#221d1a` | Inline code, code blocks, form fields, the empty avatar |

`--color-base-2`, `--color-base-3`, `--color-code-background`, `--color-code-text`, `--color-error` and the `--color-code-*` highlighter tokens keep their role and can keep their values; the code tokens must still meet 4.5:1 on `--color-code-background` in both schemes. **Contrast targets**, per the Colour contrast rule of https://specification.website/checklist.md (WCAG 2.2 1.4.3, 1.4.6 and 1.4.11): every run of text, including the small sans kickers, dates and meta lines, meets **7:1** (AAA) on whatever it sits on, paper or surface; every border a reader relies on to find a control or a boundary (form fields, the previous/next cards, the focus outline, the citation and blockquote rules) meets **3:1** against its adjacent colours. Only decorative hairlines (the `rule` token) are exempt, and nothing a reader needs is drawn with them. No text or meaningful border is drawn at reduced opacity; the citation and blockquote rules are solid accent. The mockup's `check-contrast.mjs` reads the tokens out of `src/paper.css` and checks every pair in both schemes; it passes with zero failures at these values, and the theme's `theme-colors.test.ts` table gains the same pairs at the same minimums.

Ratios at these values, light / dark: ink on paper 16.4 / 14.8; muted on paper 7.9 / 8.0 and on surface 7.3 / 7.3; accent on paper 7.7 / 7.9 (and paper on the accent button the same); accent-2 on paper 7.2 / 8.7; ink on surface 15.1 / 13.5; edge on surface 3.1 / 3.1 and on paper 3.4 / 3.5.

## Type

- **Root** 18px. **Body** serif: `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`, line-height 1.625, antialiased. **Labels** sans: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`. **Code** `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`.
- **Headings are serif and bold**, tracking tight. Site title 2.25rem, 3rem on wide screens, line-height 1. Feed article title 1.875rem, line-height 1.25. Post title 2.25rem, 2.75rem on wide screens, line-height 1.08. Prose h2 1.5rem, h3 1.25rem.
- **The kicker** is sans, 0.72rem, uppercase, letter-spacing 0.14em, muted; its kind word is the accent colour and semibold. Site menu and footer menu are the same style at 0.78rem / 0.12em.
- **Prose** 1.08rem, line-height 1.65. A note's words on its own page are 1.3rem, line-height 1.55. A note in the feed is 1.12rem, line-height 1.6. A deck (the article's summary under its title) is 1.25rem italic muted. A blockquote is 1.25rem italic muted with a 2px accent rule on the start side.
- **Meta lines** (Published, Updated, comment dates, the small print) are sans 0.875rem muted. Tags are sans 0.875rem in the secondary colour, prefixed with `#`.
- Headings `text-wrap: balance`, prose `text-wrap: pretty`, as TASK-145 requires.

## Layout and the page shell

- **Wrapper** `max-width: 42rem`, centred, 1.25rem side gutters (1.5rem from 640px), 2rem top, 4rem bottom padding. Every page uses the same wrapper; nothing is full-bleed.
- **Header, two shapes**, as now. At the root: the site title as `h1`, the tagline in italic muted 1.125rem under it, then the site menu as a row under a hairline with 1.5rem above. Everywhere else: the site title as a bold serif link home, the menu on the same line beside it, 3rem below before the content.
- **Site menu** is a wrapping row of small-caps sans links in muted, underlined at rest (`quiet-link`), accent with a heavier underline on hover, gap 1.25rem.
- **Links in prose** are the accent colour, underlined with a 40% accent underline that goes solid on hover, offset 3px (the underline is decoration; the link text itself is at 7:1). Focus is a 2px secondary-colour outline, offset 2px, at 7:1 on paper. Standalone links carry the `target` utility so their hit box is 24px tall whatever their type size.
- **Links outside prose** (the site and footer menus, kicker dates and categories, the Published link, tags, comment authors and dates, the bio's links) carry the `quiet-link` utility: underlined at rest with a 1px underline in their own colour at 50%, offset 4px, so they read as links without shouting; on hover and focus the underline becomes 2px accent and the text turns accent, a change of weight as well as hue. Continue reading and the front links keep their arrow as the resting cue, underlined in 40% accent, and thicken to 2px on hover.
- **Headline links** (a feed item's title, the site title, the link home) are ink with no underline at rest, which is what a heading that is a link looks like everywhere, and gain a 2px accent underline on hover and on focus, offset 6px, beside the colour change. The previous/next cards thicken their border to 2px on hover as well as turning it accent. Selection is 20% accent.
- **Rules** are 1px in the rule colour, 2.5rem vertical margin; between feed entries 2.25rem. They are decorative; any border a reader relies on (fields, cards, code blocks) uses the edge token at 3:1.
- **Footer**: hairline above, 5rem gap, sans 0.875rem muted, the copyright and Published with Geekity line on the left and the footer menu on the right, wrapping on narrow screens.
- **Skip link** as now: `screen-reader-text`, visible on focus.

## The kicker

`<p class="kicker">` above every entry, in the feed and on the entry's page. Parts separated by a middle dot at 50% opacity, 0.5rem gaps:

1. The **kind**: Article, Note, Reply on a post; Page on a page; Photo, Like, Repost, Bookmark once those kinds exist (TASK-166, TASK-169). In the feed it is derived from what the context already carries: `named` and `inReplyTo` on the entry, or `postType`.
2. The **date**, `dt-published`, long form (29 September 2026). In the feed it is the permalink (`u-url`) for an unnamed post; on an article the title is the link and the date is plain.
3. The **categories** as `p-category` links, on articles only in the feed.

On a post page the kicker carries the kind and the categories; the date moves to the meta line under the words.

## The feed (home, posts page, tag, category, author and search listings, the front page's recent posts)

`div.feed.h-feed` of `article.h-entry` separated by `hr`. No per-entry author. What each kind prints, top to bottom:

| Kind | In the feed |
| --- | --- |
| **Article** | Kicker (ARTICLE · date · categories). `h2.p-name` headline linking to the post, serif bold 1.875rem, ink, accent on hover. `p.p-summary` at 1.05rem, ink at 85%. "Continue reading →" as a sans 0.875rem accent link with the aria-label the theme already prints. |
| **Note** | Kicker (NOTE · date as `u-url`). The whole `e-content` at 1.12rem. Nothing else. |
| **Reply** | Kicker (REPLY · date). The citation block (below). Then the `e-content`. |
| **Photo** (future) | Kicker (PHOTO · date). The `u-photo` full width of the column, slightly outdented on wide screens (`-1rem` each side from 640px), rounded 0.375rem with a small shadow, then the `e-content` as a caption. |
| **Like** (future) | Kicker (LIKE · date). The citation line only: "Liked *Title* by *Name*". One compact entry. |
| **Repost** (future) | Kicker (REPOST · date). The citation block with the quoted text. |
| **Bookmark** (future) | Kicker (BOOKMARK · date). The citation line, then the `e-content` note. |

Pagination follows the feed as now, in the sans meta style. The front page prints the page's words in the prose style, then "Recent Posts" as an `h2`, then this feed with `feedHeading` 3, then the front links (sans 0.875rem, no underline until hover, 1.5rem gap), then a rule and the bio led by "This is the site of".

## The citation block

Used by a reply's `u-in-reply-to h-cite` now and by like, repost and bookmark later. `div.cite`: 2px solid accent rule on the start side, 1rem padding-inline-start, 0.75rem vertical margin.

- `p.cite-line`: sans 0.875rem muted. The verb (In reply to / Liked / Reposted / Bookmarked), then the target's `p-name` as a `u-url` link in ink and medium weight, then "by" and the author as a `p-author h-card` link, then ", " and the target's `dt-published` in short form (24 Sep 2026) when known. With no name, the author alone; with neither, the bare URL.
- `blockquote.cite-quote`: the target's excerpt in italic muted 0.98rem, line-height 1.375, 0.25rem below. Printed through autoescaping, never `safe`.

## One post

`article.blog-post.h-entry` (the class names stay) with:

- **Article**: `header` with the kicker (ARTICLE · categories) and `h1.p-name` at 2.25/2.75rem, then `p.post-deck.p-summary` in italic muted 1.25rem, 1rem below. 2rem gap. The `e-content` in the prose style. Then `p.entry-meta`: "Published 27 September 2026" as the `u-url` link around `dt-published`, " · Updated 28 September 2026" as `dt-updated` when it differs by day. Then the tags line. Then a rule and the bio. The IndieNews `u-category` link stays at the start of the meta line.
- **Note** (untitled): the sr-only `h1` TASK-144 added, the kicker (NOTE), the `e-content` at 1.3rem, then meta, tags, rule, bio.
- **Reply** (untitled): the sr-only `h1`, the kicker (REPLY), the citation block, the `e-content` at 1.3rem, then meta, tags, rule, bio. A titled reply is drawn as an article whose header is preceded by the citation block.
- **Previous / next**: `nav.blog-post-nav` as two bordered cards (1px edge colour, 0.375rem radius, 1rem padding) side by side from 640px, the next card right-aligned; a sans 0.7rem uppercase PREVIOUS / NEXT label over the neighbour's title or label; accent border and text on hover. 3rem vertical margin.

## A page

The same `article.blog-post.h-entry`: kicker (PAGE), `h1.p-name`, prose, a meta line with Updated when the page has a date, a rule, the bio credited to `siteAuthor`. The archive page's month list and the contact form follow in the same type.

## The bio

`div.bio.p-author.h-card`: a 3.5rem round `u-photo` avatar and a column beside it, 1rem gap. First line in body serif: "Written by **Name**, a job title from location." with the name bold and linked `rel="author me"`. Then `p.bio-note.p-note` in muted 0.95rem. Then `ul.bio-links` as a sans 0.875rem row of `rel="me"` links, 1rem gaps. On the front page and an author archive the lead changes ("This is the site of", "Posts by") as now.

## The conversation

- **Reactions**: a row of groups, 2.5rem apart, 2.5rem below. Each group is a sans 0.72rem uppercase label (LIKES, BOOSTS, MENTIONS) with the count in ink semibold beside it, then the facepile: 2rem round avatars overlapping by 0.5rem with a 2px paper ring, lifting and scaling to 1.1 on hover. A face with no avatar keeps the emoji-and-name fallback the partial has.
- **Replies**: an `h2` "2 replies" at 1.25rem bold, then `ol.comment-list` unbulleted, 2rem apart. A comment: a sans 0.875rem meta row (2rem avatar or a surface-coloured initial, the author's name bold, the date short form as the permalink, "via webmention" in italic muted when it came that way), the `e-content` at 1.02rem, then a sans "Reply" link. Children are indented 1.5rem (3rem from 640px) behind a hairline on the start side, 1.5rem apart.
- **Comment form**: hairline and 2.5rem above, "Leave a reply" `h2`, the "Or reply from your own site and send a webmention" line in muted, then sans 0.875rem labels over fields. Name and Email side by side from 640px. Fields: full width, 1px edge border, 0.375rem radius, surface background, serif 1rem, secondary-colour focus outline. Submit: accent background, paper text, sans semibold 0.875rem, 1.25rem × 0.625rem padding, 0.375rem radius. The refused-submission summary, the honeypot and the signed-in variant keep their markup and take the same type. The contact form is the same form.

## Prose

`.prose` (the theme's `e-content` and `page-body`): 1.08rem / 1.65, 1.25rem between blocks. h2 1.5rem bold with 2.5rem above, h3 1.25rem. Lists disc/decimal with 1.5rem indent and 0.5rem between items. Blockquote as above. Inline code 0.85em on the surface colour with 0.375rem × 0.125rem padding and a 0.125rem radius. A fenced block: surface background, 1px edge border, 0.375rem radius, 1rem padding, 0.85rem, horizontal scroll, `tabindex="0"` as now. Images rounded 0.375rem. Tables, footnotes, figures and definition lists keep the current rules restyled in the same tokens.

## Everything else the theme draws

The mockup covers the front page, the home listing, an article, a note, a reply and a page. The rest of the theme follows the same rules: search (the form in the comment-form field style, results as feed items with the snippet's `mark` on a 20% accent background), tag, category and author archives (the archive header as a page header with the kicker naming it, TAG / CATEGORY / AUTHOR, and the bio led by "Posts by" on an author archive), the archive page's month headings as prose h2s, 404 / 500 / 503 as a page with a kicker, the pagination as sans links, the admin bar unchanged. Mail templates are untouched.

## Accessibility

Checked against the Accessibility section of https://specification.website/checklist.md. The mockup carries three scripts beside it, run in the Chromium set up under `libs/`: `check-contrast.mjs` (every colour pair, both schemes), `targets.mjs` (every link and control measured at 390px) and `axe.mjs` (axe-core with the WCAG 2.x A, AA, AAA and best-practice rule sets over every page in both schemes, with the mockup bar removed first). All three pass; axe reports no violations and leaves only aria-hidden dots and arrows and the identical "Reply" links, which all go to the same form, for review.

| Rule | How Paper meets it |
| --- | --- |
| Colour contrast (required) | Text at 7:1 and relied-on borders at 3:1 in both schemes; see Tokens. |
| Forced colours mode | An `@media (forced-colors: active)` block borders what a background alone drew (buttons, fields, code, rules, the cards, the citation and blockquote rules) and outlines facepile avatars; focus is left to the system, which redraws outlines. |
| Image alt text | The photo carries its caption as `alt`; avatars beside a printed name are `alt=""`; facepile avatars, whose name is not printed, carry the name. |
| Form labels | Every field is inside its `label`; hints ("never shown", "optional") are part of the label text. Fields carry `autocomplete` (name, email, url) and the right `type`, and are 18px so iOS does not zoom. A field left invalid gets a 2px error-colour border through `:user-invalid`, with no JavaScript. |
| Keyboard navigation | No JavaScript, no custom widgets; every control is native. Code blocks are `tabindex="0"` so their horizontal scroll is reachable, as the CMS renders them. |
| Visible focus indicators | A 2px secondary-colour outline, offset 2px, on every link, button, field and focusable block; nothing removes an outline. |
| Focus not obscured | The theme has no sticky or fixed elements. (The mockup's own bar at the top is sticky and is not part of the theme.) |
| Skip links | The first focusable element, visible on focus. |
| Semantic HTML and landmarks | `header`, `nav` with an `aria-label` for each menu, `main`, `footer`; `article` per entry; `time` for every date; headings step by one (site title or entry at `h1`, feed titles and reaction and reply headings at `h2`, feed titles at `h3` under the front page's Recent Posts). |
| Descriptive link text | Continue reading carries the post's title in its `aria-label`; dates link permalinks; facepile links carry the person's name. |
| Empty links and buttons | None: every link has text, an image with alt, or a screen-reader-only label. |
| Document language | `lang` on `html`. |
| Reduced motion | The cross-document view transition and the two hover transitions run only under `prefers-reduced-motion: no-preference` (`motion-safe:`). |
| Touch target size | 24px minimum on every standalone link and control; see Principles. |
| Text wrapping and scrollbar | Headings `text-wrap: balance`, prose `pretty`, `scrollbar-gutter: stable` on `html`, as TASK-145 requires. |
| Logical properties | Every inline-axis margin, padding, border and alignment is logical (`ps-`, `ms-`, `border-s-`, `text-end`), so the stylesheet mirrors under `dir="rtl"` and the appendix compiles with no physical side property. |

Accessible form errors and status messages are the CMS's, not the mockup's: the refused-submission summary with `role="alert"` and the per-field messages the comment and contact forms already print take the same type as the form.

## Appendix A: the mockup stylesheet

Tailwind v4, `@theme inline` mapping utilities onto custom properties that flip under `prefers-color-scheme: dark`, and `@apply` under `@layer components`. The token names are the mockup's; the theme keeps its own (see Tokens). The token values are the ones the Tokens section lists, checked by `check-contrast.mjs` beside it. Every inline-axis utility is logical, the forced-colours block, `text-wrap` and `scrollbar-gutter` are in, and the compiled output contains no physical side property, so it is written to pass `theme-stylesheet.test.ts` as it stands.

```css
/* Paper: Tailwind tokens. Colours are checked by check-contrast.mjs: every run
   of text at 7:1 (WCAG AAA), every border a reader relies on at 3:1 (1.4.11).
   Paper: Tailwind tokens, semantic class names, @apply. The templates stay
   readable and the stylesheet is the one place the look lives. */
@import "tailwindcss" source(none);
@source "../dist/paper";

:root {
  color-scheme: light dark;
  --paper: #faf7f2;
  --ink: #1c1917;
  --muted: #534c46;
  --accent: #8c2f1f;
  --accent-2: #2b5580;
  --rule: #e4dccf;
  --surface: #f3eee5;
  --edge: #8a867e;
  --error: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #171412;
    --ink: #ece6de;
    --muted: #b2aaa0;
    --accent: #ee9370;
    --accent-2: #86b8e2;
    --rule: #3a332e;
    --surface: #221d1a;
    --edge: #706a67;
    --error: #ff8093;
  }
}

@theme inline {
  --color-paper: var(--paper);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-2: var(--accent-2);
  --color-rule: var(--rule);
  --color-surface: var(--surface);
  --color-edge: var(--edge);
  --color-error: var(--error);
  --font-serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

/* A standalone link or control: 24x24 minimum (WCAG 2.5.8). */
@utility target {
  @apply inline-flex items-center min-h-6 min-w-6;
}

/* A link outside prose still says it is a link at rest, with a thin underline
   in its own colour; hover and focus thicken it and turn it accent, so the
   change is never colour alone (WCAG 1.4.1). */
@utility quiet-link {
  @apply underline decoration-1 decoration-current/50 underline-offset-4 hover:text-accent hover:decoration-accent hover:decoration-2 focus-visible:decoration-2;
}

@layer base {
  html { font-size: 18px; text-size-adjust: 100%; scrollbar-gutter: stable; }
  h1, h2, h3, h4, h5, h6 { text-wrap: balance; }
  p, li, dd, blockquote { text-wrap: pretty; }
  body { @apply antialiased leading-relaxed; }
  a { @apply text-accent underline decoration-accent/40 underline-offset-[3px] motion-safe:transition-colors; }
  a:hover { @apply decoration-accent; }
  a:focus-visible { @apply outline-2 outline-offset-2 outline-accent-2 rounded-xs no-underline; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { @apply outline-2 outline-offset-2 outline-accent-2; }
  hr { @apply border-0 border-t border-rule my-10; }
  ::selection { @apply bg-accent/20; }
}

@layer components {
  .wrapper { @apply mx-auto max-w-2xl px-5 sm:px-6 pt-8 pb-16; }

  /* Header */
  .site-header { @apply flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-12; }
  .site-header-root { @apply block mb-14; }
  .site-title { @apply font-bold text-4xl sm:text-5xl tracking-tight leading-none; }
  .site-title a { @apply text-ink no-underline hover:text-accent hover:underline hover:decoration-[3px] hover:underline-offset-8; }
  .site-tagline { @apply mt-3 text-muted text-lg italic; }
  .home-link { @apply font-bold text-ink no-underline text-lg hover:text-accent hover:underline hover:decoration-2 hover:underline-offset-[5px]; }
  .site-nav ul { @apply flex flex-wrap gap-x-5 gap-y-1 font-sans text-[0.78rem] uppercase tracking-[0.12em]; }
  .site-header-root .site-nav { @apply mt-6 pt-4 border-t border-rule; }
  /* Standalone links are 24x24 minimum (WCAG 2.5.8), as TASK-145 did: inline-flex
     grows the hit box and keeps the words on their baseline. Links inside a
     sentence are left alone under the inline exception. */
  .site-nav a { @apply target quiet-link text-muted; }

  /* The kicker: what a thing is, said once, small, above it */
  .kicker { @apply font-sans text-[0.72rem] uppercase tracking-[0.14em] text-muted flex flex-wrap items-center gap-x-2 mb-2; }
  .kicker a { @apply target quiet-link text-muted; }
  .kicker-kind { @apply text-accent font-semibold; }
  .kicker-dot { @apply opacity-50; }

  /* Feed */
  .feed { @apply mt-2; }
  .entry-rule { @apply my-9; }
  .entry-title { @apply text-3xl font-bold leading-tight tracking-tight mt-1 mb-3; }
  .entry-title a { @apply text-ink no-underline hover:text-accent hover:underline hover:decoration-2 hover:underline-offset-[6px] focus-visible:underline focus-visible:decoration-2; }
  .entry-summary { @apply text-[1.05rem] text-ink/85; }
  .entry-more { @apply mt-3 font-sans text-sm; }
  .entry-more a { @apply target gap-1 underline decoration-accent/40 hover:decoration-accent hover:decoration-2; }
  .entry-body { @apply text-[1.12rem] leading-[1.6]; }
  .entry-body > * + * { @apply mt-4; }
  .entry-compact .cite { @apply mt-0; }
  .entry-photo { @apply my-3 -mx-1 sm:-mx-4; }
  .entry-photo img { @apply w-full h-auto rounded-md shadow-sm; }

  /* A citation: the thing a reply, like, repost or bookmark points at */
  .cite { @apply my-3 ps-4 border-s-2 border-accent; }
  .cite-line { @apply font-sans text-sm text-muted; }
  .cite-line a { @apply target text-ink font-medium; }
  .cite-quote { @apply mt-1 italic text-muted text-[0.98rem] leading-snug; }

  /* One post or page */
  .post-header { @apply mb-8; }
  .post-title { @apply text-4xl sm:text-[2.75rem] font-bold leading-[1.08] tracking-tight mt-1; }
  .post-deck { @apply mt-4 text-xl text-muted italic leading-snug; }
  .post-note .prose-note { @apply text-[1.3rem] leading-[1.55]; }
  .entry-meta { @apply mt-8 font-sans text-sm text-muted; }
  .entry-meta a { @apply target quiet-link text-muted; }
  .tags { @apply mt-2 font-sans text-sm flex flex-wrap gap-x-3; }
  .tags a { @apply target quiet-link text-accent-2; }

  .post-nav { @apply grid sm:grid-cols-2 gap-4 my-12 font-sans text-sm; }
  .post-nav a { @apply block rounded-md border border-edge p-4 no-underline text-ink hover:border-accent hover:border-2 hover:p-[calc(1rem-1px)] hover:text-accent; }
  .post-nav a[rel="next"] { @apply sm:text-end; }
  .post-nav-label { @apply block text-[0.7rem] uppercase tracking-[0.14em] text-muted mb-1; }

  /* Bio */
  .bio { @apply flex gap-4 items-start; }
  .bio-avatar { @apply rounded-full size-14 shrink-0; }
  .bio p { @apply m-0; }
  .bio .p-name { @apply font-bold text-ink; }
  .bio-note { @apply text-muted text-[0.95rem] mt-1; }
  .bio-links { @apply flex flex-wrap gap-x-4 mt-1 font-sans text-sm; }
  .bio-links a { @apply target; }
  .front-links { @apply mt-10 font-sans text-sm flex gap-6; }
  .front-links a { @apply target gap-1 underline decoration-accent/40 hover:decoration-accent hover:decoration-2; }

  /* Conversation */
  .conversation { @apply mt-14; }
  .reactions { @apply flex flex-wrap gap-x-10 gap-y-4 mb-10; }
  .reaction-title { @apply font-sans text-[0.72rem] uppercase tracking-[0.14em] text-muted mb-2; }
  .reaction-count { @apply text-ink font-semibold ms-1; }
  .facepile { @apply flex; }
  .facepile a { @apply -ms-2 first:ms-0 rounded-full ring-2 ring-paper hover:z-10 motion-safe:hover:scale-110 motion-safe:transition-transform; }
  .facepile img { @apply rounded-full size-8; }
  .conversation-title { @apply text-xl font-bold mb-5; }
  .comment-list { @apply list-none p-0 m-0 space-y-8; }
  .comment-children { @apply list-none ps-6 sm:ps-12 mt-6 space-y-6 border-s border-rule; }
  .comment-meta { @apply flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-sm; }
  .comment-meta .h-card { @apply flex items-center gap-2; }
  .comment-meta b a { @apply target quiet-link text-ink; }
  .comment-avatar { @apply rounded-full size-8; }
  .comment-avatar-empty { @apply inline-flex items-center justify-center bg-surface text-muted font-semibold; }
  .comment-date { @apply target quiet-link text-muted; }
  .comment-source { @apply text-muted italic; }
  .comment-content { @apply mt-2 text-[1.02rem]; }
  .comment-reply { @apply mt-0.5 font-sans text-sm; }
  .comment-reply a { @apply target; }
  .comment-help { @apply text-muted text-[0.95rem] -mt-3 mb-5; }
  .comment-form { @apply mt-12 pt-10 border-t border-rule; }
  .comment-form label { @apply block font-sans text-sm mb-4; }
  .field-row { @apply grid sm:grid-cols-2 gap-x-4; }
  .field-hint { @apply text-muted; }
  .comment-form input, .comment-form textarea { @apply block w-full mt-1 rounded-md border border-edge bg-surface px-3 py-2 font-serif text-base text-ink; }
  .comment-form input:focus, .comment-form textarea:focus { @apply outline-2 outline-offset-1 outline-accent-2; }
  /* A field the reader has left invalid says so without JavaScript. */
  .comment-form input:user-invalid, .comment-form textarea:user-invalid { @apply border-error border-2; }
  .comment-form button { @apply rounded-md bg-accent text-paper font-sans font-semibold text-sm px-5 py-2.5 hover:opacity-90 cursor-pointer; }

  /* Footer */
  .site-footer { @apply mt-20 pt-6 border-t border-rule font-sans text-sm text-muted flex flex-wrap justify-between gap-4; }
  .site-footer ul { @apply flex flex-wrap gap-x-4; }
  .site-footer a { @apply target quiet-link text-muted; }

  /* Prose */
  .prose { @apply text-[1.08rem] leading-[1.65]; }
  .prose > * + * { @apply mt-5; }
  .prose h2 { @apply text-2xl font-bold tracking-tight mt-10 mb-3; }
  .prose h3 { @apply text-xl font-bold mt-8 mb-2; }
  .prose ul { @apply list-disc ps-6 space-y-2; }
  .prose ol { @apply list-decimal ps-6 space-y-2; }
  .prose blockquote { @apply border-s-2 border-accent ps-5 italic text-muted text-xl leading-snug my-8; }
  .prose code { @apply font-mono text-[0.85em] bg-surface px-1.5 py-0.5 rounded-sm; }
  .prose pre { @apply bg-surface border border-edge/60 rounded-md p-4 overflow-x-auto text-[0.85rem] leading-relaxed; }
  .prose pre code { @apply bg-transparent p-0; }
  .prose img { @apply rounded-md; }
}

/* Forced colours (Windows High Contrast): the palette flattens every
   background, so what a background alone drew gets an edge, and what an
   outline draws is left to the system, which redraws outlines itself. */
@media (forced-colors: active) {
  .comment-form button, .comment-form input, .comment-form textarea, .prose pre, .prose code, hr, .entry-rule, .post-nav a, .cite, .prose blockquote {
    border: 1px solid CanvasText;
  }
  .facepile a { outline: 1px solid CanvasText; }
  .comment-form button { forced-color-adjust: none; background: ButtonFace; color: ButtonText; border-color: ButtonText; }
}
```

## Appendix B: the mockup's markup

The home feed with one entry of every kind. Links point at mockup files; the kinds marked future in the table above are drawn so the citation block and kicker have a home for them.

```html
<div class="h-feed">
  <span class="sr-only p-name">Joe Blog</span>
  <div class="feed"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Note</span><span class="kicker-dot" aria-hidden="true">·</span><a class="u-url" href="note.html"><time class="dt-published" datetime="2026-09-29T14:12:00Z">29 September 2026</time></a></p>
  
  
  <div class="entry-body e-content"><p>Moved the comment form to plain HTML today: a form, a hidden field for the parent id, and nothing else. It works with the network tab closed, which is the only test I trust.</p></div>
</article><hr class="entry-rule"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Article</span><span class="kicker-dot" aria-hidden="true">·</span><time class="dt-published" datetime="2026-09-27T09:30:00Z">27 September 2026</time><span class="kicker-dot" aria-hidden="true">·</span><a class="p-category " href="index.html">web</a></p>
  <h2 class="entry-title p-name"><a class="u-url" href="article.html">One URL, many representations</a></h2>
  <p class="entry-summary p-summary">A post is one file. The HTML page, the Atom entry, the JSON Feed item and the ActivityStreams object are four readings of it, negotiated at the same address.</p>
  <p class="entry-more"><a href="article.html" aria-label="Continue reading: One URL, many representations">Continue reading<span aria-hidden="true"> &rarr;</span></a></p>
</article><hr class="entry-rule"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Reply</span><span class="kicker-dot" aria-hidden="true">·</span><a class="u-url" href="reply.html"><time class="dt-published" datetime="2026-09-26T21:05:00Z">26 September 2026</time></a></p>
  <div class="cite u-in-reply-to h-cite">
  <p class="cite-line">In reply to <a class="u-url p-name" href="https://adalin.example/2026/09/24/webmentions">Webmentions are the comments section you own</a> by <span class="p-author h-card"><a class="u-url p-name" href="https://adalin.example">Ada Lin</a></span>, <time class="dt-published" datetime="2026-09-24T10:00:00Z">24 Sep 2026</time></p>
  <blockquote class="cite-quote p-content">A webmention is a POST with two URLs in it. Everything else, the verification, the display, the moderation, is your choice to make, on your own server.</blockquote>
</div>
  
  <div class="entry-body e-content"><p>Agreed on the ownership point, though I would go further: the receiving side is the part people underestimate. Verifying that the source really links back is where most of the code lives, and where most of the spam is stopped.</p></div>
</article><hr class="entry-rule"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Photo</span><span class="kicker-dot" aria-hidden="true">·</span><a class="u-url" href="note.html"><time class="dt-published" datetime="2026-09-24T17:40:00Z">24 September 2026</time></a></p>
  
  <figure class="entry-photo"><img class="u-photo" src="assets/photo-lake.svg" alt="A lake at dusk, hills fading into haze" width="1600" height="1000" loading="lazy"></figure>
  <div class="entry-body e-content"><p>Last light on the lake. No filter, no phone signal, no notifications.</p></div>
</article><hr class="entry-rule"><article class="entry entry-compact h-entry">
  <p class="kicker"><span class="kicker-kind">Like</span><span class="kicker-dot" aria-hidden="true">·</span><a class="u-url" href="note.html"><time class="dt-published" datetime="2026-09-23T08:15:00Z">23 September 2026</time></a></p>
  <div class="cite u-like-of h-cite">
  <p class="cite-line">Liked <a class="u-url p-name" href="https://mira.example/notes/1042">Small sites, small servers</a> by <span class="p-author h-card"><a class="u-url p-name" href="https://mira.example">Mira Okafor</a></span></p>
  
</div>
</article><hr class="entry-rule"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Bookmark</span><span class="kicker-dot" aria-hidden="true">·</span><a class="u-url" href="note.html"><time class="dt-published" datetime="2026-09-22T12:00:00Z">22 September 2026</time></a></p>
  <div class="cite u-bookmark-of h-cite">
  <p class="cite-line">Bookmarked <a class="u-url p-name" href="https://ptd.spec.indieweb.org/">Post Type Discovery</a> by <span class="p-author h-card"><a class="u-url p-name" href="https://indieweb.org">IndieWeb</a></span></p>
  
</div>
  
  <div class="entry-body e-content"><p>The algorithm this site uses to tell a note from an article: it reads the properties a post has, not a type field somebody set.</p></div>
</article><hr class="entry-rule"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Article</span><span class="kicker-dot" aria-hidden="true">·</span><time class="dt-published" datetime="2026-09-20T10:00:00Z">20 September 2026</time><span class="kicker-dot" aria-hidden="true">·</span><a class="p-category " href="index.html">general</a></p>
  <h2 class="entry-title p-name"><a class="u-url" href="article.html">Markdown on disk</a></h2>
  <p class="entry-summary p-summary">Why the file is the record and the database is a cache that may be deleted at rest, and what that buys you the day the server dies.</p>
  <p class="entry-more"><a href="article.html" aria-label="Continue reading: Markdown on disk">Continue reading<span aria-hidden="true"> &rarr;</span></a></p>
</article><hr class="entry-rule"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Repost</span><span class="kicker-dot" aria-hidden="true">·</span><a class="u-url" href="note.html"><time class="dt-published" datetime="2026-09-19T19:30:00Z">19 September 2026</time></a></p>
  <div class="cite u-repost-of h-cite">
  <p class="cite-line">Reposted <span class="p-author h-card"><a class="u-url p-name" href="https://sam.example">Sam Reyes</a></span>, <time class="dt-published" datetime="2026-09-19T18:02:00Z">19 Sep 2026</time></p><a class="u-url" href="https://sam.example/2026/09/19/shipped"><span class="sr-only">https://sam.example/2026/09/19/shipped</span></a>
  <blockquote class="cite-quote p-content">Shipped the redesign. It is 11 KB of CSS and no JavaScript, and it feels faster than anything I have built in a decade.</blockquote>
</div>
  
  
</article><hr class="entry-rule"><article class="entry h-entry">
  <p class="kicker"><span class="kicker-kind">Note</span><span class="kicker-dot" aria-hidden="true">·</span><a class="u-url" href="note.html"><time class="dt-published" datetime="2026-09-18T07:50:00Z">18 September 2026</time></a></p>
  
  
  <div class="entry-body e-content"><p>Reading the IndieWeb wiki on reply contexts. The consensus is to quote sparingly: a name, an author, one line and a link. Anything more and you are republishing.</p></div>
</article></div>
</div>
```

An article on its own page, followed by the previous/next cards and the conversation:

```html
<article class="post h-entry">
  <header class="post-header">
    <p class="kicker"><span class="kicker-kind">Article</span><span class="kicker-dot" aria-hidden="true">·</span><a class="p-category " href="index.html">web</a></p>
    <h1 class="post-title p-name">One URL, many representations</h1>
    <p class="post-deck p-summary">A post is one file. The HTML page, the Atom entry, the JSON Feed item and the ActivityStreams object are four readings of it, negotiated at the same address.</p>
  </header>
  <div class="prose e-content"><p>Every post on this site has exactly one address. Ask for it with a browser and you get a page. Ask for it with <code>Accept: application/activity+json</code> and you get the ActivityStreams object a Mastodon server wants. The feed reader gets the Atom entry from the feed, and that entry's <code>id</code> is the same URL again.</p>
<p>This sounds obvious until you look at how most systems do it: a page at one URL, a feed with its own ids, a federation id under <code>/ap/objects/…</code>, and a table that maps them together. Three names for one thing, and a join to prove they are the same.</p>
<h2>The file is the record</h2>
<p>Here the post is a Markdown file, and the permalink in its front matter is the only identity it has. Everything else is derived at request time:</p>
<pre tabindex="0"><code class="language-yaml">---
title: One URL, many representations
date: 2026-09-27T09:30:00Z
permalink: /2026/09/one-url-many-representations/
categories: [web]
---</code></pre>
<p>Content negotiation on that one path is what makes the rest fall out. The HTML representation carries microformats2, so an IndieWeb reader parses it directly. The JSON representation carries the same properties as an <code>Article</code>. Neither is the canonical one; the file is.</p>
<blockquote><p>A URL that means one thing in every client is worth more than a faster database.</p></blockquote>
<h2>What it costs</h2>
<ul>
<li>A negotiation step on every request, which is one <code>Accept</code> header parse.</li>
<li>An <code>ETag</code> per representation, because the bytes differ even though the resource does not.</li>
<li>The discipline to never mint a second id for convenience.</li>
</ul>
<p>The discipline is the hard part. The code is short.</p></div>
  <p class="entry-meta">
  <a class="u-url" href="article.html"><time class="dt-published" datetime="2026-09-27T09:30:00Z">Published 27 September 2026</time></a>
  <span aria-hidden="true">·</span> <time class="dt-updated" datetime="2026-09-28T16:10:00Z">Updated 28 September 2026</time>
</p>
  <p class="tags"><a class="p-category" rel="tag" href="index.html">#http</a> <a class="p-category" rel="tag" href="index.html">#feeds</a> <a class="p-category" rel="tag" href="index.html">#activitypub</a></p>
  <hr>
  <div class="bio p-author h-card">
  <img class="u-photo bio-avatar" src="assets/avatar-joe.svg" alt="" width="56" height="56">
  <div>
    <p>Written by <a class="u-url p-name" rel="author me" href="/author/joe/">Joe Blog</a>, a <span class="p-job-title">web developer</span> from <span class="p-locality">Chicago</span>.</p>
    <p class="bio-note p-note">I build small tools for the web and write about what breaks. This site is a folder of Markdown files and one Node process.</p>
    <ul class="bio-links"><li><a class="u-url" rel="me" href="https://indieweb.social/@joe">Mastodon</a></li><li><a class="u-url" rel="me" href="https://github.com/joeblog">GitHub</a></li><li><a class="u-url" rel="me" href="mailto:joe@joeblog.example">Email</a></li></ul>
  </div>
</div>
</article>
<nav class="post-nav" aria-label="Neighbouring posts">
  <a rel="prev" href="reply.html"><span class="post-nav-label">Previous</span>Agreed on the ownership point, though I would go further …</a>
  <a rel="next" href="note.html"><span class="post-nav-label">Next</span>Moved the comment form to plain HTML today: a form, …</a>
</nav>
<section class="conversation">
  <div class="reactions"><div class="reaction-group">
  <h2 class="reaction-title">Likes <span class="reaction-count">4</span></h2>
  <div class="facepile"><a class="u-url" href="https://mira.example" title="Mira Okafor" rel="nofollow noopener"><img class="u-photo" src="assets/avatar-mira.svg" alt="Mira Okafor" width="32" height="32" loading="lazy"></a><a class="u-url" href="https://sam.example" title="Sam Reyes" rel="nofollow noopener"><img class="u-photo" src="assets/avatar-sam.svg" alt="Sam Reyes" width="32" height="32" loading="lazy"></a><a class="u-url" href="https://adalin.example" title="Ada Lin" rel="nofollow noopener"><img class="u-photo" src="assets/avatar-ada.svg" alt="Ada Lin" width="32" height="32" loading="lazy"></a><a class="u-url" href="https://priya.example" title="Priya Nair" rel="nofollow noopener"><img class="u-photo" src="assets/avatar-priya.svg" alt="Priya Nair" width="32" height="32" loading="lazy"></a></div>
</div><div class="reaction-group">
  <h2 class="reaction-title">Boosts <span class="reaction-count">2</span></h2>
  <div class="facepile"><a class="u-url" href="https://sam.example" title="Sam Reyes" rel="nofollow noopener"><img class="u-photo" src="assets/avatar-sam.svg" alt="Sam Reyes" width="32" height="32" loading="lazy"></a><a class="u-url" href="https://priya.example" title="Priya Nair" rel="nofollow noopener"><img class="u-photo" src="assets/avatar-priya.svg" alt="Priya Nair" width="32" height="32" loading="lazy"></a></div>
</div><div class="reaction-group">
  <h2 class="reaction-title">Mentions <span class="reaction-count">1</span></h2>
  <div class="facepile"><a class="u-url" href="https://adalin.example/2026/09/28/one-url" title="Ada Lin" rel="nofollow noopener"><img class="u-photo" src="assets/avatar-ada.svg" alt="Ada Lin" width="32" height="32" loading="lazy"></a></div>
</div></div>
  <h2 class="conversation-title">2 replies</h2><ol class="comment-list"><li id="comment-1" class="comment h-entry">
  <article>
    <footer class="comment-meta">
      <span class="p-author h-card"><img class="u-photo comment-avatar" src="assets/avatar-mira.svg" alt="" width="40" height="40" loading="lazy"><b><a class="u-url p-name" href="https://mira.example" rel="nofollow ugc">Mira Okafor</a></b></span>
      <a class="u-url comment-date" href="https://mira.example/replies/77"><time class="dt-published" datetime="2026-09-27T13:20:00Z">27 Sep 2026</time></a>
      <span class="comment-source">via webmention</span>
    </footer>
    <div class="comment-content e-content"><p>Content negotiation on the same URL is the part that convinced me. One address in the feed reader, one in the browser, one in Mastodon, and they are all the same address.</p></div>
    <p class="comment-reply"><a href="#respond">Reply</a></p>
  </article>
  <ol class="comment-children"><li id="comment-2" class="comment h-entry">
  <article>
    <footer class="comment-meta">
      <span class="p-author h-card"><img class="u-photo comment-avatar" src="assets/avatar-joe.svg" alt="" width="40" height="40" loading="lazy"><b><a class="u-url p-name" href="/author/joe/" rel="nofollow ugc">Joe Blog</a></b></span>
      <a class="u-url comment-date" href="#comment-2"><time class="dt-published" datetime="2026-09-27T14:02:00Z">27 Sep 2026</time></a>
      <span class="comment-source"></span>
    </footer>
    <div class="comment-content e-content"><p>Exactly. The permalink is the id; everything else is a representation of it.</p></div>
    <p class="comment-reply"><a href="#respond">Reply</a></p>
  </article>
  
</li></ol>
</li><li id="comment-3" class="comment h-entry">
  <article>
    <footer class="comment-meta">
      <span class="p-author h-card"><span class="comment-avatar comment-avatar-empty" aria-hidden="true">D</span><b><span class="p-name">Devon Park</span></b></span>
      <a class="u-url comment-date" href="#comment-3"><time class="dt-published" datetime="2026-09-28T09:11:00Z">28 Sep 2026</time></a>
      <span class="comment-source"></span>
    </footer>
    <div class="comment-content e-content"><p>How do you handle a client that sends <code>Accept: */*</code>? Does it get HTML?</p></div>
    <p class="comment-reply"><a href="#respond">Reply</a></p>
  </article>
  
</li></ol>
  <form id="respond" class="comment-form" method="post" action="#">
    <h2 class="conversation-title">Leave a reply</h2>
    <p class="comment-help">Or reply from your own site and send a <a href="https://indieweb.org/Webmention">webmention</a>.</p>
    <div class="field-row">
      <label>Name <input name="name" autocomplete="name" required></label>
      <label>Email <span class="field-hint">(never shown)</span> <input type="email" name="email" autocomplete="email" required></label>
    </div>
    <label>Website <span class="field-hint">(optional)</span> <input type="url" name="url" autocomplete="url"></label>
    <label>Reply <textarea name="content" rows="5" required></textarea></label>
    <button type="submit">Post reply</button>
  </form>
</section>
```

A note on its own page:

```html
<article class="post post-note h-entry">
  <h1 class="sr-only">Note by Joe Blog, 29 September 2026</h1>
  <p class="kicker"><span class="kicker-kind">Note</span></p>
  <div class="prose prose-note e-content"><p>Moved the comment form to plain HTML today: a form, a hidden field for the parent id, and nothing else. It works with the network tab closed, which is the only test I trust.</p></div>
  <p class="entry-meta">
  <a class="u-url" href="note.html"><time class="dt-published" datetime="2026-09-29T14:12:00Z">Published 29 September 2026</time></a>
  
</p>
  <p class="tags"><a class="p-category" rel="tag" href="index.html">#indieweb</a> <a class="p-category" rel="tag" href="index.html">#comments</a></p>
  <hr>
  <div class="bio p-author h-card">
  <img class="u-photo bio-avatar" src="assets/avatar-joe.svg" alt="" width="56" height="56">
  <div>
    <p>Written by <a class="u-url p-name" rel="author me" href="/author/joe/">Joe Blog</a>, a <span class="p-job-title">web developer</span> from <span class="p-locality">Chicago</span>.</p>
    <p class="bio-note p-note">I build small tools for the web and write about what breaks. This site is a folder of Markdown files and one Node process.</p>
    <ul class="bio-links"><li><a class="u-url" rel="me" href="https://indieweb.social/@joe">Mastodon</a></li><li><a class="u-url" rel="me" href="https://github.com/joeblog">GitHub</a></li><li><a class="u-url" rel="me" href="mailto:joe@joeblog.example">Email</a></li></ul>
  </div>
</div>
</article>
```

A reply on its own page:

```html
<article class="post post-note h-entry">
  <h1 class="sr-only">Reply by Joe Blog, 26 September 2026</h1>
  <p class="kicker"><span class="kicker-kind">Reply</span></p>
  <div class="cite u-in-reply-to h-cite">
  <p class="cite-line">In reply to <a class="u-url p-name" href="https://adalin.example/2026/09/24/webmentions">Webmentions are the comments section you own</a> by <span class="p-author h-card"><a class="u-url p-name" href="https://adalin.example">Ada Lin</a></span>, <time class="dt-published" datetime="2026-09-24T10:00:00Z">24 Sep 2026</time></p>
  <blockquote class="cite-quote p-content">A webmention is a POST with two URLs in it. Everything else, the verification, the display, the moderation, is your choice to make, on your own server.</blockquote>
</div>
  <div class="prose prose-note e-content"><p>Agreed on the ownership point, though I would go further: the receiving side is the part people underestimate. Verifying that the source really links back is where most of the code lives, and where most of the spam is stopped.</p></div>
  <p class="entry-meta">
  <a class="u-url" href="reply.html"><time class="dt-published" datetime="2026-09-26T21:05:00Z">Published 26 September 2026</time></a>
  
</p>
  <p class="tags"><a class="p-category" rel="tag" href="index.html">#webmention</a></p>
  <hr>
  <div class="bio p-author h-card">
  <img class="u-photo bio-avatar" src="assets/avatar-joe.svg" alt="" width="56" height="56">
  <div>
    <p>Written by <a class="u-url p-name" rel="author me" href="/author/joe/">Joe Blog</a>, a <span class="p-job-title">web developer</span> from <span class="p-locality">Chicago</span>.</p>
    <p class="bio-note p-note">I build small tools for the web and write about what breaks. This site is a folder of Markdown files and one Node process.</p>
    <ul class="bio-links"><li><a class="u-url" rel="me" href="https://indieweb.social/@joe">Mastodon</a></li><li><a class="u-url" rel="me" href="https://github.com/joeblog">GitHub</a></li><li><a class="u-url" rel="me" href="mailto:joe@joeblog.example">Email</a></li></ul>
  </div>
</div>
</article>
```
