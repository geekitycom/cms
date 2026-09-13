---
id: TASK-78
title: >-
  Demo, scaffold and docs for named themes: the demo theme moves to
  themes/<name>/ and is chosen in its site.json, and every README describes the
  themes directory
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 12:49'
updated_date: '2026-09-13 16:16'
labels:
  - infra
  - docs
milestone: m-13
dependencies:
  - TASK-77
references:
  - apps/demo/theme/layouts/post.njk
  - apps/demo/test/site.test.ts
  - packages/cms/README.md
  - README.md
  - packages/cms/themes/default/README.md
  - packages/cms/templates/site/geekity.config.ts
  - >-
    backlog/decisions/decision-15 -
    Themes-are-named-and-site.json-chooses-one.md
type: chore
ordinal: 103800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With named themes in place (TASK-76, TASK-77), make the demo and the documentation match. The demo theme at apps/demo/theme/ (a post layout with a byline and reading time, and a stylesheet) moves to apps/demo/themes/<name>/ with a theme.json, its geekity.config.ts names themesDir, and its content/_data/site.json chooses that theme, so the demo proves the choice rather than the default; the demo site test asserts the override is visible when chosen and that the packaged default comes back when the setting is cleared. The init scaffold writes no themes directory, as it wrote no theme/, but its config and README say where one goes. The root README, the package README and themes/default/README.md describe the themes directory, the manifest, the setting, the Appearance screen and the search order, say that the admin is not themed, and stop describing theme/ and themeDir; the package README carries a short migration note for a site with a theme/ directory. decision-4 is annotated: its single theme/ directory is superseded by decision-15, its non-overridable admin stands. The pack-install smoke still boots a scratch site and gets 200s.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/demo/themes/<name>/theme.json, layouts/post.njk and static/style.css exist, apps/demo/theme/ is gone, the demo config names themesDir and the demo site.json chooses the theme
- [x] #2 apps/demo/test/site.test.ts proves the chosen theme renders the byline, reading time and demo stylesheet and that the packaged default serves when the setting is absent
- [x] #3 The root README, the package README and themes/default/README.md describe themes/, theme.json, the theme setting, the Appearance screen and the search order, say the admin is not themed, and no longer present theme/ or themeDir as current behaviour; the package README carries a migration note
- [x] #4 The init template config names themesDir and geekity init still produces a site the pack-install smoke boots with 200s
- [x] #5 decision-4 carries a note that decision-15 supersedes its single theme/ directory and that its non-overridable admin still stands
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm what TASK-76 already moved: apps/demo/themes/demo/{theme.json,layouts/post.njk,static/style.css} exist, apps/demo/theme/ is gone, geekity.config.ts names themesDir, site.json has "theme": "demo". Fix anything the move left stale (the demo theme's own comments still say theme/).
2. TDD the demo test (AC#2): add a failing test that boots a SECOND Cms against a temp copy of apps/demo/content with the "theme" key removed, and asserts the packaged post layout and the packaged /theme/style.css come back. Never write into apps/demo/content. Keep the existing chosen-theme assertions and tighten them so byline, reading time and the demo stylesheet are all proven.
3. Docs (AC#3), one pass per file:
   - README.md 'The theme': themes/ + theme.json + the theme setting + Appearance > Themes + the search order + the admin is not themed; the demo paragraph names apps/demo/themes/demo/ and the choice in site.json.
   - packages/cms/README.md: add the Appearance route row and fix the menu paragraph's section count and list; 'Theme overrides' gains the Appearance screen, the admin-is-not-themed sentence and a short migration note for a site that has a theme/ directory.
   - packages/cms/themes/default/README.md: 'Overriding a template' and the mail and conversation paragraphs stop writing theme/<file> and write themes/<name>/<file>; say the choice is made on Appearance > Themes and that the admin is not a theme.
4. Scaffold (AC#4): packages/cms/templates/site/geekity.config.ts keeps themesDir and gains a comment saying a theme goes in themes/<name>/ with a theme.json and is chosen on Appearance > Themes; nothing new is scaffolded. Confirm the package README's 'What it writes' block still tells the truth.
5. decision-4 (AC#5): backlog decision has only create and list, so append a dated note to its Consequences by hand and record in the notes that the CLI offers no edit command.
6. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, pnpm test:11ty, scripts/pack-install-smoke.sh. Check each AC only with its evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**What TASK-76 had already done, confirmed rather than redone.** `apps/demo/themes/demo/` holds `theme.json` (name "Geekity Demo", kind site, a description), `layouts/post.njk` and `static/style.css`; `apps/demo/theme/` is gone; `geekity.config.ts` names `themesDir: 'themes'`; `content/_data/site.json` carries `"theme": "demo"`. Verified by ls and grep, not by moving anything again.

**The demo test (AC#2).** `apps/demo/test/site.test.ts` gained a second describe, 'the demo with its theme unchosen', that boots a second `Cms` against a **copy** of `apps/demo/content/` in a temp directory with the `theme` key deleted from `site.json`, pointed at the demo's real `themesDir`. That is the shape the Appearance screen writes when the packaged theme is activated, and it proves the other half of the mechanism: `themes/demo/` is still on disk and still on `themesDir`, and the site serves the packaged post layout (`<p class="post-meta"> Published`, no `post-byline`, no 'minute read') and a `/theme/style.css` byte-identical to `PACKAGED_THEME_DIR/static/style.css`. The demo's own content directory is never written to — not even to put it back — because a crashed run would otherwise leave a working demo wearing no theme. The existing describe was renamed 'the theme the demo chose' and keeps the byline, reading-time and demo-stylesheet assertions.

**Red first.** The three new tests were proved to fail before they passed: removing the `delete settings['theme']` line (so the copy still chooses the theme) turned 'serves a post through the packaged post layout' and 'serves the packaged stylesheet' red, and restoring it turned them green. The 'serves the rest of the site' test stays green either way, by design — it is the control.

**decision-4 (AC#5).** `backlog decision --help` offers only `create` and `list`; there is no edit command, so — as the task allows for exactly this case — the decision file's body was edited directly to append a dated '## Note, 2026-09-13' section after Consequences. It says decision-15 supersedes the single `theme/` directory (named themes under `themesDir`, a `theme.json` per folder, the `theme` setting, Appearance > Themes, `themeDir` and `GEEKITY_THEME_DIR` gone rather than aliased), that the override model itself is unchanged, and that 'admin templates are internal and not overridable' stands. No frontmatter was touched.

**The docs (AC#3).** TASK-76 had already corrected the paragraphs the code made outright false; what was left was the long-form narrative.

- `README.md` 'The theme': the themes directory with `themesDir`/`GEEKITY_THEMES_DIR`, the manifest's three fields, the directory name as the id, the search order, and two new paragraphs — Appearance > Themes (what it lists, that Activate on the packaged theme removes the key rather than writing an empty one, that a change lands on the next request with no restart, that a broken manifest is listed under 'Not themes' with the reason, that a missing theme falls back with a logged warning, that nothing scaffolds `themes/`) and 'The admin is not themed'. The demo paragraph now names `apps/demo/themes/demo/` and the `"theme": "demo"` setting, and says what the site test proves on each side of the choice.
- `packages/cms/README.md`: the manifest fields explained under the JSON sample; an Appearance > Themes paragraph in 'Theme overrides'; an 'The admin is not themed' paragraph; a new '### Moving a `theme/` directory' at the end of that section — the `git mv`, the manifest, the choice, dropping `themeDir` and `GEEKITY_THEME_DIR`, and the warning that the move and the choice belong in one deploy. Also `/admin/appearance/themes` in the admin route table and 'ten sections … Appearance …' in the menu paragraph, which TASK-77 had left at nine. The 'What it writes' block after `geekity init` now says where a theme goes and points at both the section and the config comment.
- `packages/cms/themes/default/README.md`: 'Overriding a template' rewritten around the themes directory, the setting, the Appearance screen, the fallback and the admin, and the four places that still wrote `theme/<file>` (front-page, mail test, mail welcome, conversation) now write the file relative to the theme the site wears.

**Prose the code had also made false, outside the three READMEs.** The demo's own `themes/demo/layouts/post.njk` and `static/style.css` header comments, the demo pages `about.md` and `colophon.md`, the demo post 'The theme is just templates', `content/_includes/post.njk`, the packaged `static/style.css` and the three packaged partials' comments, and the doc comment on `src/admin/templates.ts`. All of them told a reader to write `theme/…`; none of them is a behaviour change.

**The scaffold (AC#4).** `packages/cms/templates/site/geekity.config.ts` still names `themesDir` and still scaffolds no themes directory; it gained a comment beside that key saying a theme is `themes/<name>/` with a `theme.json`, that the directory is not scaffolded, that the choice is a setting rather than a path, and that with nothing chosen every page comes from the package.

**Not done, and deliberately.** `backlog/docs/doc-1 - Architecture-Overview.md` still says a template is looked up in the site `theme/` first. It is outside every criterion here, so it is left for whoever next touches that document.

**Verification.** `pnpm build`, `pnpm test` (1671 package tests, 18 demo tests, 0 failures), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:11ty` (16 + 5) and `scripts/pack-install-smoke.sh` all green. The smoke packed the tarball, ran `geekity init` into a scratch directory, installed it, booted it on 3456, got 200 for `/`, `/2026/01/hello-world/` and `/hello/`, type checked the scratch site against the published declarations and stopped the server. Working tree holds no stray demo state and `apps/demo/content/_data/federation/` was not touched.

**Commit type: `docs`.** Everything that changed is prose or test: four READMEs and a set of file comments, one decision annotation, a comment in the init template, and three new assertions in the demo's site test. No shipped behaviour changes, and `packages/cms/templates/site/geekity.config.ts` gains only a comment, so nothing a site runs is different.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the demo, the scaffold and the documentation match named themes. The demo's theme was already at apps/demo/themes/demo/ with a theme.json chosen by "theme": "demo" in its site.json (TASK-76); this task confirmed that and finished the proof: apps/demo/test/site.test.ts now boots a second site against a copy of the demo's content with the theme key deleted and asserts the packaged post layout and a byte-identical packaged stylesheet come back, beside the existing assertions that the chosen theme renders the byline, the reading time and the demo stylesheet. Both new assertions were proved red first by leaving the key in place. The root README, the package README and themes/default/README.md now describe themes/, the manifest, the theme setting, Appearance > Themes, the search order, the fallback with a logged warning and the fact that the admin is not themed; the package README carries a migration note for a site with a theme/ directory, the /admin/appearance/themes route and a menu of ten sections. The init template still scaffolds no themes directory and its config comment now says where a theme goes. Every other place that still told a reader to write theme/<file> — the demo's own theme comments, three demo pages and posts, the packaged stylesheet and partials, and src/admin/templates.ts — was corrected too. decision-4 carries a dated note that decision-15 supersedes its single theme/ directory and that its non-overridable admin stands; the backlog CLI has no decision edit command, so that one file's body was edited directly. Verified with pnpm build, test (1671 + 18), typecheck, lint, format:check, test:11ty (16 + 5) and scripts/pack-install-smoke.sh, which booted a freshly scaffolded site and got 200s.
<!-- SECTION:FINAL_SUMMARY:END -->
