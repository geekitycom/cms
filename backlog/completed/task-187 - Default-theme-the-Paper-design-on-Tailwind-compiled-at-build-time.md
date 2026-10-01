---
id: TASK-187
title: 'Default theme: the Paper design, on Tailwind compiled at build time'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-30 21:01'
updated_date: '2026-09-30 23:44'
labels:
  - theme
  - design
  - tailwind
  - indieweb
dependencies: []
references:
  - backlog/docs/doc-9 - Paper-the-default-theme-design.md
  - _local/mockups/indieweb-themes/ (dev server
  - 'git-ignored: dist/paper'
  - src/paper.css
  - paper.mjs
  - shots/paper-*.png)
  - 'https://3000.code01.geekity.com/paper/'
  - 'https://tailwindcss.com/docs'
  - 'https://ptd.spec.indieweb.org/'
  - decision-16
  - TASK-144
  - TASK-145
  - TASK-86
  - 'https://specification.website/checklist.md (Accessibility section)'
  - 'https://specification.website/spec/accessibility/color-contrast/'
  - _local/mockups/indieweb-themes/check-contrast.mjs
  - >-
    _local/mockups/indieweb-themes/axe.mjs and targets.mjs (axe-core and
    touch-target checks over the mockup)
documentation:
  - doc-9
priority: high
type: feature
ordinal: 206800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme is the andrewshell.org port of decision-16: plain CSS, a serif body with sans headings, and no visible difference between a note and an article beyond whether a headline is there. On 2026-09-30 three Tailwind theme mockups were drawn (Paper, Stream, Ledger) and Paper was chosen. This task restyles the default theme as Paper.

**What Paper is.** One warm 42rem column, serif throughout, sans reserved for small labels. Only an article gets a headline; every other kind of post is its words under a small-caps *kicker* that names the kind and the date (NOTE · 29 September 2026). A reply cites its target in a left-ruled citation block. Dark mode follows the system. The same microformats, the same header shapes, the same page anatomy as now, with better typography, a kind that a reader can see, and a stylesheet compiled from Tailwind at build time. **doc-9 is the whole specification**: tokens, type, layout, what every kind prints in the feed and on its page, the conversation and forms, plus the mockup's stylesheet and rendered markup as appendices. Read it first. The mockup itself is on the dev server at `_local/mockups/indieweb-themes/` (git-ignored): `dist/paper/*.html` are the pages, `src/paper.css` the stylesheet, `paper.mjs` the renderer, and `shots/paper-*.png` full-page screenshots at 1280 and 390 wide in both schemes, which are what the built theme is compared against. `./serve.sh` there serves it at https://3000.code01.geekity.com/paper/ when running.

**Scope.** Every page the default theme renders, not only the six the mockup drew: the home and posts listings, the front page, a post (article, untitled note, untitled and titled reply), a page, search, the tag, category and author archives, the archive page, 404/500/503, pagination, the conversation (facepiles, thread, comment form) and the contact form. doc-9's "Everything else the theme draws" says how the unmocked pages follow. Mail templates are untouched. Photo, like, repost and bookmark are drawn in doc-9 so the kicker and the citation block are the seam they plug into, but they are TASK-166 and TASK-169 and are not built here.

**Constraints the codebase sets.**

- *Tailwind at build time, nothing at run time.* Tailwind v4 (`tailwindcss` + `@tailwindcss/cli`, https://tailwindcss.com/docs) compiles a source stylesheet in the theme to `themes/default/static/style.css`. Follow the admin editor's precedent (`packages/cms/scripts/build-editor.js`): devDependency, a step in `pnpm build` (which the root `prepare` runs, so it exists after install and before publish), the output gitignored like `admin/static/editor.js`, shipped by the `themes` entry in `files`. Scan only the theme directory (`@import "tailwindcss" source(none)` plus `@source`). No CDN, no runtime script, no web fonts. Tests that read `static/style.css` from disk (`theme-colors.test.ts`, `theme-stylesheet.test.ts`, the page-shell, entry, site and demo tests) must find the compiled file when `pnpm test` runs.
- *The colour contract stays, and the bar rises.* `src/web/theme-colors.test.ts` reads the `--color-*` custom properties out of the `:root` block and the `@media (prefers-color-scheme: dark)` block and computes WCAG 2.2 ratios for every pair in its table. Keep those token names with Paper's values (the mapping is in doc-9's Tokens section), add the new tokens (muted, rule, edge) and the new pairs to the table, and map Tailwind utilities onto them with `@theme inline`. The thresholds follow the Colour contrast rule of https://specification.website/checklist.md: every run of text, the small sans kickers, dates and meta lines included, at 7:1 (AAA) on paper and on surface; every border a reader relies on (form fields, the previous/next cards, code blocks, the focus outline, the citation and blockquote rules) at 3:1 against its adjacent colours (1.4.11). Only the decorative hairlines (`rule`) are exempt, and nothing a reader needs is drawn with them or at reduced opacity. The mockup's `check-contrast.mjs` is the pair list and passes at doc-9's values; the test's table should end up equivalent. The README's "Colours" section documents the tokens as the override contract for sites.
- *`src/web/theme-stylesheet.test.ts` must pass on the compiled output*: no physical inline-axis property or asymmetric four-value shorthand anywhere (use `ms-`/`ps-`/`border-s` utilities, never `ml-`/`pl-`/`border-l`, and audit what Tailwind's preflight emits), `scrollbar-gutter: stable`, `text-wrap` balance on headings and pretty on prose, 24px minimum targets on standalone links and controls, a `forced-colors` block, no focus rule that removes an outline. These are the TASK-145 guarantees.
- *Code highlighting stays.* The `.hljs-*` rules and the `--color-code-*` Tomorrow palettes (TASK-86) move into the new stylesheet unchanged, and highlight.js still loads only on a page with a code block.
- *The markup contract stays.* The blocks of `layouts/base.njk`, every partial's name and the context keys are the semver contract; keep them. Keep the class names the tests and the demo theme depend on (`blog-post`, `feed`, `feed-item`, `feed-title`, `feed-meta`, `entry-meta`, `page-meta`, `bio`, `bio-links`, `hlist`, `facepile`, `reaction-group`, `comment-*`, `blog-post-nav`, `pagination`, `global-header`, `main-heading`, `header-link-home`, `screen-reader-text`) and add classes (`kicker`, `cite`, `post-deck`) rather than renaming. Tests that assert markup: `src/web/site.test.ts`, `page-shell.test.ts`, `entry.test.ts`, `listings.test.ts`, `notes.test.ts`, `replies.test.ts`, `conversation-markup.test.ts`, `page-kinds.test.ts`, `headings.test.ts`, `comments/site.test.ts`, `apps/demo/test/site.test.ts`. Change them where the design changes what they assert, deliberately, not by loosening them. The sr-only `h1` on an untitled post (TASK-144) stays; `p-name` never appears on an unnamed post.
- *The demo keeps working.* `apps/demo/themes/demo/static/style.css` replaces the packaged stylesheet wholesale and styles the packaged markup, and `apps/demo/themes/demo/layouts/post.njk` extends `layouts/base.njk`; both must still render coherently (style any class the packaged templates gain, fix the comment that says the packaged stylesheet is plain CSS with no build step). `apps/demo/test/site.test.ts` and `test/eleventy.test.ts` pass.
- *Docs and the decision.* Update the theme README (the intro that says "Plain Nunjucks and plain CSS. There is no build step", "The page shell", "An entry", "A listing", "Colours"), the package README's theme section, the root README's workspace layout and commands, and `packages/cms/themes/default/README.md`'s file tree for the new source file. Record a decision that supersedes the plain-CSS part of decision-16: the default theme is the Paper design and its stylesheet is Tailwind compiled at build time, why, and what the token and class-name contract for site themes is now.
- *Commit as `feat(cms)`*, not breaking: blocks, partials and context keys are kept.

**How to prove it.** As TASK-145 did: a throwaway Playwright script (not committed) that boots the demo content on the default theme with a kitchen-sink post (code block, blockquote, list, footnote, open comments with a nested reply, likes and boosts), an untitled note, a reply with a reply context, and the contact page, and screenshots each at 1280 and 390 wide in light and dark, compared by eye against `_local/mockups/indieweb-themes/shots/paper-*.png`. Run an automated checker (axe or Lighthouse in that Chromium) over the same pages for the rest of the checklist's Accessibility section: contrast, alt text, form labels, focus indicators, skip link, landmarks, link text, document language, reduced motion, touch targets. The server has no sudo; Playwright's Chromium runs with `LD_LIBRARY_PATH=$PWD/_local/mockups/indieweb-themes/libs/usr/lib/x86_64-linux-gnu` (the missing system libraries were extracted there). Then `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.

Related but separate: TASK-186 (the comments heading quoting an empty title on an untitled post) can be fixed in passing if the conversation heading is rewritten anyway; TASK-146 (theme-color and color-scheme meta) is not part of this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every page the default theme renders (home and posts listings, front page, article, untitled note, untitled and titled reply, page, search, tag/category/author archives, archive page, 404/500/503, pagination, conversation, comment and contact forms) is drawn in the Paper design as doc-9 specifies, and the six mocked pages match `shots/paper-*.png` at 1280 and 390 wide in light and dark
- [x] #2 A feed item and a post page say their kind: an article has the only headline, a note or reply opens on its words under a kicker naming the kind and date, a reply cites its target in the citation block with `u-in-reply-to h-cite`, and an untitled post keeps its screen-reader-only h1 and carries no `p-name`
- [x] #3 Every mf2 property the theme emits today (h-feed, h-entry, p-name, p-summary, e-content, dt-published, dt-updated, u-url, p-category, p-author h-card, rel=me, h-cite) is still emitted on the same elements, proven by the existing markup tests passing or being changed deliberately
- [x] #4 `static/style.css` is compiled from a Tailwind v4 source in the theme by `pnpm build`, is gitignored, ships in the package, and no page loads a script, a web font or a CDN resource it did not load before
- [x] #5 The .hljs-* rules and Tomorrow palettes are carried over and highlight.js still loads only on a page with a code block
- [x] #6 The demo site on its own theme (`apps/demo/themes/demo`) still renders coherently, including any class the packaged templates gained, and its tests and the Eleventy build test pass
- [x] #7 The theme README, the package README, the root README and the theme file tree describe the source stylesheet, the build step and the token contract; a decision is recorded superseding the plain-CSS part of decision-16
- [x] #8 `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass
- [x] #9 `theme-colors.test.ts` passes with the `--color-*` token names kept, Paper values, and the new tokens and pairs added, at the checklist thresholds: every text pair at 7:1 (AAA) in both schemes, every relied-on border (fields, cards, code blocks, focus outline, citation and blockquote rules) at 3:1, no text or meaningful border drawn at reduced opacity
- [x] #10 `theme-stylesheet.test.ts` passes on the compiled stylesheet: logical properties only, scrollbar-gutter, text-wrap, 24px targets, a forced-colors block, no focus outline removed
- [x] #11 An automated accessibility checker (axe or Lighthouse) over the demo pages on the default theme reports no failures in the Accessibility section of https://specification.website/checklist.md that the theme controls: contrast, alt text, form labels, focus indicators, skip link, landmarks, link text, document language, reduced motion, touch targets
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add tailwindcss + @tailwindcss/cli as devDependencies of @geekity/cms; add build:theme (tailwindcss --optimize, unminified so tests can read it) to pnpm build and as pretest; gitignore and prettierignore themes/default/static/style.css.
2. Write themes/default/src/style.css: --color-* tokens on :root and the dark query with doc-9 values plus muted/rule/edge; @theme inline mapping paper/ink/muted/accent/accent-2/rule/edge/surface; target and quiet-link utilities (target in literal 24px logical sizes); base, components on the existing class names plus kicker/cite/post-deck; hljs rules and Tomorrow palettes carried over; forced-colors block.
3. Templates: kicker on feed items and entries, citation block in reply-context.njk, post-deck, previous/next cards, conversation and forms restyled with classes added not renamed; listing entries gain replyContext so a feed reply cites its target.
4. Tests: theme-colors reads the token :root, AAA/3:1 pairs table; theme-stylesheet parser walks @layer/@supports; markup tests changed deliberately where the design changes them.
5. Demo stylesheet styles new classes; docs (theme README, package README, root README) and a decision superseding decision-16's plain-CSS part.
6. Prove: Playwright screenshots 1280/390 light/dark vs shots/paper-*.png, axe over demo pages; pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions and deviations from doc-9:
- Tailwind theme is `@theme inline reference` with the default palette cleared: plain `inline` emitted `--color-muted: var(--color-muted)` in the theme layer, a self-reference that only worked because the unlayered token won.
- Compiled with `--optimize`, not `--minify`: markup tests read declarations textually. `build:theme` also runs as `pretest`/`pretest:coverage`.
- Highlighter tokens raised to 7:1 (doc-9 said 4.5): axe's AAA rule flagged them, and the task's bar is every run of text at 7:1. Light palette darkened along each hue, four dark colours lightened toward white.
- `--color-error` darkened to #9c1f18 / lifted to #ff8f9f to reach 7:1.
- Feed categories are printed in the kicker for articles only, as doc-9 says; a note's categories stay on its page.
- Short dates (24 Sep 2026) not added: the date filter has no such format and adding one widens the filter contract and the Eleventy plugin. Citations and comments use the long form.
- Listing entries now carry `replyContext` (render.ts entryContext) so a feed reply cites its target; tested in reply-context.test.ts, mutation-checked.
- Published line stays inside e-content (decision-16 rationale); the Updated line follows a middle dot instead of <br>.
- Thread title is "N replies" with no quoted title, which fixes TASK-186 in passing.
- TASK-111 page-shell link tests rewritten to Paper's contract (underlined at rest, 24px, hover changes thickness, secondary focus ring).
- Demo theme: its stylesheet targeted .site-header/.skip-link, which the packaged shell no longer prints, and never hid the honeypot; retargeted at the packaged class names and added conversation/form rules.
- Scanning layouts/partials emits a few stray utilities from words in template comments (.block, .hidden, .static, .fixed...). Harmless; kept because the task asked for @source on the theme.
Verification: Playwright screenshots of 14 pages at 1280/390 light/dark, compared by eye with shots/paper-*.png; axe (wcag2a/aa/21/22aa/2aaa/best-practice) reports 0 violations; target sweep at 390 leaves only in-sentence links; typecheck, lint, test:11ty pass; tarball ships src/ and static/style.css.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Restyled the default theme as Paper (doc-9) on a Tailwind v4 stylesheet compiled at build time (decision-22). src/style.css compiles to the gitignored static/style.css in pnpm build and pretest; templates gain kicker, citation, deck, card and form-row markup with every block, partial, context key and mf2 property kept; listing entries carry replyContext so a feed reply cites its target. Colour tokens keep their names with Paper values plus muted/rule/edge, every text pair at 7:1 (highlighter included) and relied-on borders at 3:1. Verified: pnpm test 2671+31 pass, test:11ty, typecheck, lint, format:check (only the git-ignored _local mockups warn); Playwright screenshots of 14 pages at 1280/390 light/dark compared with shots/paper-*.png; axe 0 violations; tarball ships both stylesheets; demo theme screenshots coherent.
<!-- SECTION:FINAL_SUMMARY:END -->
