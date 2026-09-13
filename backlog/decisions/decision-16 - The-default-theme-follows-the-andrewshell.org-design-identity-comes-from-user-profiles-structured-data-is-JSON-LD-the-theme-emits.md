---
id: decision-16
title: >-
  The default theme follows the andrewshell.org design; identity comes from user
  profiles; structured data is JSON-LD the theme emits
date: '2026-09-13 13:34'
status: accepted
---
## Context

The packaged default theme (decision-4) is a neutral system-font layout with a dark scheme, written to prove the override model rather than to be anyone's site. On 2026-09-13 the user asked for it to follow the design of their WordPress theme, asdo-theme at `/Users/andrewshell/code/wordpress/asdo-theme`, "obviously not a copy, but try to maintain the style/design as much as possible including the indieweb microformats".

What that theme is: a serif body (Iowan Old Style, Palatino) and sans headings at an 18px root on a minor-third scale, warm paper (`#fdfcfb`) with near-black text (`#240b00`), a rust primary (`#b33900`) and a blue secondary (`#007ab3`), one column at 42rem, links that invert to the primary colour on hover, a primary-coloured rule. A big site title and tagline on the front page, a small home link everywhere else, no header navigation. Feed items are `h-entry` inside `h-feed`: a linked `p-name`, a `p-summary` excerpt of about 280 characters, Continue reading, `dt-published`, `p-category` links, separated by rules. A post is `article.blog-post.h-entry` with `h1.p-name`, the body in `section.e-content` ending in a `u-url` link around a Published `dt-published` time and an Updated `dt-updated` when they differ, then a rule and a footer holding the bio: `p-author h-card` with `u-photo` avatar, "Written by" a `p-name u-url` linked with `rel="author me"`, job title and locality when present, and a horizontal list of site links. Previous and next post links follow. Reactions are facepiles grouped by type with counts, comments are `h-entry` items with a `p-author h-card`, `u-url`, `dt-published` and `e-content`. The head carries a description, Open Graph and Twitter card tags, and one JSON-LD `@graph` of `WebSite`, `Person`, `ProfilePage` on an author archive and `BlogPosting` or `Article` on an entry, with the Person built from the user profile so the visible h-card and the structured data cannot drift. Microdata was deliberately removed in favour of JSON-LD. The footer has the copyright, an RSS link and `rel="me"` social links.

The CMS has most of the data but not all of it: `author` on a post already resolves to a user profile (name, bio, avatar, links), the feeds already compute an excerpt, and the conversation already carries likes, boosts, mentions and replies with `h-card` and `h-cite` markup. It has no site-level author on every page, no summary on a listing entry, no previous and next post, no recent-posts list for a front page, no Open Graph tags and no JSON-LD anywhere.

## Decision

**The default theme is the andrewshell.org design**, rewritten as Nunjucks over the CMS context: its type, colour, measure, header behaviour, feed item, entry, bio, reactions, comments and footer. The source theme is light only; the default theme adds a dark scheme under `prefers-color-scheme: dark`, the same design on dark paper with the rust and blue lifted until every text and background pair meets WCAG 2.2 AA, 4.5:1 for body text and 3:1 for large text, focus outlines and rules, in both schemes. The pairs are checked by a test that reads the custom properties, so a colour change that breaks the ratio fails the build rather than a reader. The theme's contract stays: the blocks of `layouts/base.njk`, the partials a site replaces file by file, and the context keys the README documents. Class names follow the source theme (`blog-post`, `feed-item`, `bio`, `hlist`, `facepile`) so a site that has CSS for the WordPress theme can bring it.

**Identity comes from user profiles, never from the theme.** The bio, the footer's `rel="me"` links, the JSON-LD Person and the Open Graph image all read the same profile object. The context gains `siteAuthor`, the profile behind the site's `author` setting when it names a user, resolved the way a byline is; on a post the entry's author wins, on an author archive the archive's user. The user profile gains two optional fields the design prints, a job title and a location, beside the display name, bio, avatar and links it has.

**Structured data is JSON-LD the theme emits**, from `partials/jsonld.njk`, one `@graph` per page, built from the same context the visible markup uses. No Microdata. The CMS core does not know about schema.org; a site theme that wants different structured data overrides one partial.

**The CMS supplies what the design reads and the theme does not compute**: `summary` on every listing entry (the feed excerpt), `previous` and `next` on a post, `recentPosts` for the front page, and `siteAuthor`. These are context additions, documented in the README as part of the semver contract like every other key.

**Two page kinds the source theme has become front-matter switches**, the pattern `contact: true` set: a shipped `layouts/front-page.njk` that prints the page's words and then the recent posts, and `archive: true` on a page that lists every post grouped by month.

## Consequences

- `feat(cms)`, not breaking: the theme's blocks, partials and context keys are kept and extended; the markup and classes inside them change, which a site overriding a partial already owns. Tests that assert the packaged markup (`site.test.ts`, the demo's `site.test.ts`, the front-page tests) change with it.
- The demo's own theme overrides `layouts/post.njk` by extending the base layout; it keeps working because the blocks are kept, and it is the proof that the contract held.
- Webrings and other site-specific footer links are not in the package: they go in a site theme's `footer` block override, as the source theme's are hard-coded to one site.
- Search is TASK-22 and not part of this; the 404 and the front page link to it only once it exists. Code highlighting is highlight.js on the client, as the renderer's design anticipated. Both source sites used Prism with the Tomorrow palette, the Eleventy one at build time and the WordPress one on markup carried over from it, but Prism has had no release since 1.30.0 in March 2025 and takes only security fixes while an unfinished version 2 is worked on, so the user chose highlight.js (11.12.0, August 2026, maintained, dependency-free) and keeps the Tomorrow palette through its base16 themes, the light Tomorrow on light paper and Tomorrow Night on dark, to be judged on the demo once built. The default theme self-hosts a pinned bundle and loads it only on pages that have a code block, so a page without code ships no script and the core stays highlighter-free; a site theme swaps the bundle or drops it by overriding the scripts block.
- The IndieNews `u-category` link on a post tagged `indienews` is printed; whether a webmention is also sent there is a later question for the sender.
- Supplements decision-4 and decision-15; the theme README remains the contract document.
