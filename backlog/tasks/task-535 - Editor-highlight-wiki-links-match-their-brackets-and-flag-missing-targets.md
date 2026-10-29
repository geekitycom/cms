---
id: TASK-535
title: >-
  Editor: highlight [[wiki links]], match their brackets and flag missing
  targets
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T20:49:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-531
  - TASK-532
references:
  - decision-66
ordinal: 437800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: the operator wants the editor to show wiki links as they type and to see at a glance which ones point to a page that does not exist yet. The editor is CodeMirror 6 over a textarea (packages/cms/editor/main.ts, built by scripts/build-editor.js); it takes its URLs from #editor-enhance and has no completion today. Autocomplete was considered and not chosen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 In the post, page and wiki editors a `[[...]]` span is highlighted and its brackets are matched
- [x] #2 A wiki link whose target slug has no wiki page is underlined as missing, updating as you type; a draft counts as present and a trashed page as missing
- [x] #3 The editor slugifies with the same function as the server, so the hint agrees with the rendered link
- [x] #4 With JavaScript off the textarea still works
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the [[...]] syntax (regex, target/heading/text split, slugify) out of wiki-links.ts into src/content/wiki-link-syntax.ts, which imports only slug.ts, and have the markdown-it rule use it. Add wikiLinksIn(text): every wiki link in a run of text with its range and target slug, honouring an escaped \[[ and a target that slugifies to nothing, the way the server rule does.
2. Test it in node, including that every link it finds has the slug the server renders into the href (same slugify).
3. The editor model embeds the slugs of the live wiki pages (drafts included, trash excluded) as data-wiki-slugs on #editor-enhance, read fresh on every editor load; admin test covers post, page and wiki editors, draft present, trashed absent.
4. editor/wiki-links.ts: a CodeMirror ViewPlugin that decorates each [[...]] in the visible ranges outside code nodes (cm-wiki-link), marks the missing ones (cm-wiki-link-missing, dashed underline plus a title), and marks both [[ and ]] with cm-matchingBracket when the cursor touches either. Styles in admin/src/admin.css for light and dark.
5. Verify in Chromium with Playwright: highlight, bracket match, the missing underline changing as you type, and the textarea with JavaScript off. Then the full build/test/typecheck/lint/format run.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- The [[...]] syntax (regex, target/heading/text split, slugify) moved from wiki-links.ts to src/content/wiki-link-syntax.ts, which imports only slug.ts. The markdown-it rule and the editor bundle both use it. wikiLinksIn(text) finds every link in a line with its range and slug. An escaped \[[ (odd backslash run) and a target that slugifies to nothing are not links, as on the server.
- The editor gets the slugs of live wiki pages (drafts in, trash out, via store.listAll({type:'wiki'})) as data-wiki-slugs on #editor-enhance. They are read on every editor load, so a page created in another tab shows up on reload. I chose this over a JSON endpoint because the editor already takes all its data from that element.
- editor/wiki-links.ts is a ViewPlugin over the visible ranges. It skips code nodes (InlineCode, FencedCode, CodeBlock, CodeText, HTMLBlock) and adds cm-wiki-link to each link, cm-md-mark to the brackets, and cm-wiki-link-missing to a missing target, with a title and aria-description saying no wiki page exists yet. When the cursor touches either end, it puts cm-matchingBracket on both [[ and ]]. CSS in admin/src/admin.css: primary colour with a solid underline, and a 2px dashed error-colour underline for a missing target. The inner md-link underline is turned off so only one underline is drawn.
- Verification: unit tests in src/content/wiki-link-syntax.test.ts (including slug agreement with renderMarkdown hrefs for accented, transliterated and punctuated targets) and src/admin/editor-wiki-slugs.test.ts (post, page and wiki editors carry the slugs; a draft is present, a trashed page is absent; a new page appears on the next load). Playwright with Chromium against a local server on port 3477 (since stopped), in light and dark colour schemes: links highlighted, code and escaped links left alone, both bracket pairs matched at the cursor, the missing underline added and removed as you type, and the same behaviour in the post, page and wiki editors. With JavaScript off, the textarea is visible and saves.
- pnpm build, test, test:11ty, typecheck, lint and format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The admin editor (post, page and wiki) now highlights [[wiki links]], matches their [[ and ]] when the cursor is at either, and gives a link whose target has no wiki page a dashed error-colour underline and a title hint. The hint updates as you type. The editor parses and slugifies with the same module the server renders with (new src/content/wiki-link-syntax.ts, now used by wiki-links.ts), so the hint agrees with the rendered href. The editor reads the existing slugs (drafts count, trash does not) from data-wiki-slugs on #editor-enhance, which is fresh on each load. With JavaScript off the plain textarea works as before. Tested with node tests plus a Playwright check in light and dark themes, and the full build/test/typecheck/lint/format run passes. One limit: the set of existing pages is fixed for the life of an editor tab, so a page created in another tab is seen only after a reload.
<!-- SECTION:FINAL_SUMMARY:END -->
