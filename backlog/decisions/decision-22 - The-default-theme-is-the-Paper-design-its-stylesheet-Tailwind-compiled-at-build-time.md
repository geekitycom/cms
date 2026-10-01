---
id: decision-22
title: >-
  The default theme is the Paper design, its stylesheet Tailwind compiled at
  build time
date: '2026-09-30 23:13'
status: accepted
---
## Context

decision-16 ported the andrewshell.org design as the default theme in plain CSS with no build step: a serif body with sans headings, and no visible difference between a note and an article beyond whether a headline was there. The theme README promised "Plain Nunjucks and plain CSS. There is no build step", and the colour test held its palette to WCAG 2.2 AA.

On 2026-09-30 three Tailwind mockups of a redesign were drawn (Paper, Stream, Ledger) and Paper was chosen. doc-9 specifies it: one warm column, serif throughout, a small-caps kicker naming the kind of every entry, a citation block for what a reply answers, and a contrast bar raised to the specification.website checklist (text at 7:1, relied-on borders at 3:1). TASK-187 built it.

## Decision

**The default theme is the Paper design.** The page shell, the blocks of `layouts/base.njk`, every partial's name and the context keys are unchanged, and so is every microformats2 property the theme emitted. The markup gains classes (`kicker`, `cite`, `post-deck`, `field-row` and a few more) rather than renaming any.

**Its stylesheet is Tailwind v4, compiled at build time.** The source is `themes/default/src/style.css`. `pnpm build` compiles it with `@tailwindcss/cli --optimize` to `themes/default/static/style.css`, which is gitignored like the editor bundle and shipped by the `themes` entry in `files`; the package's `pretest` recompiles it so the suites always read the current source. Tailwind scans only the theme's `layouts/` and `partials/`. This supersedes the plain-CSS part of decision-16; the rest of decision-16 (the shell, the client-side highlighter, the source design's markup) stands.

Why a build step now: the design is written as semantic class names styled with `@apply` from a small token set, which is what made three mockups cheap to draw and is what keeps the stylesheet the one place the look lives. The cost falls on the machine that builds the package, once. A reader still gets one CSS file and nothing else: no runtime script, no web font, no CDN.

**The contract for site themes.**

- The `--color-*` custom properties on `:root`, redefined under `prefers-color-scheme: dark`, are the colour override contract: `body`, `text`, `muted`, `primary`, `secondary`, `rule`, `edge`, `base`, `base-2`, `base-3`, `error`, and the `code-*` tokens. `src/web/theme-colors.test.ts` holds every text pair at 7:1 and every relied-on border at 3:1 in both schemes; `rule` is decorative and in no pair.
- The class names the templates print are the styling contract, as before. A site theme's `static/style.css` still replaces the packaged one wholesale and needs no Tailwind; the demo theme's is plain CSS.
- Tailwind is an implementation detail of the packaged stylesheet, not something a site theme inherits or has to install.

## Consequences

- A fresh clone has no `static/style.css` until `pnpm install` (whose `prepare` builds) or `pnpm build` runs. Tests that read it from disk run after `pretest` has compiled it.
- `tailwindcss` and `@tailwindcss/cli` are devDependencies of `@geekity/cms`. The Docker build already installs devDependencies and runs `pnpm build`, so the image carries the compiled file.
- The compiled file is Tailwind's output, wrapped in `@layer` and `@supports` blocks, so `theme-stylesheet.test.ts` looks through those and matches the compiler's quoting and keyword case.
- Changing the design is now editing `src/style.css` and running `pnpm --filter @geekity/cms build:theme`, not editing `static/style.css`.
