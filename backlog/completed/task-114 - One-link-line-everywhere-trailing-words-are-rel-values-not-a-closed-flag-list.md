---
id: TASK-114
title: >-
  One link line everywhere: trailing words are rel values, not a closed flag
  list
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 17:56'
updated_date: '2026-09-20 18:14'
labels:
  - web
  - admin
dependencies: []
references:
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/admin/users.ts
  - packages/cms/admin/pages/users/edit.njk
  - packages/cms/admin/pages/navigation/menus.njk
  - packages/cms/themes/default/partials/menu.njk
  - packages/cms/themes/default/partials/bio.njk
type: feature
ordinal: 138800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-112 made `Mastodon | https://example.social/@me | me` an error in a profile's Links box, on the reasoning that a profile link already carries `rel="me"` so the word is redundant. The maintainer tried it on localhost and disagreed, and is right: every box that takes a link should take the same line, a redundant word breaks nothing, and `me` was never a flag in the first place — it is a `rel` value, and there are others somebody may want.

Make the trailing part of a link line a list of `rel` values, in every box that takes a link.

    Mastodon | https://example.social/@me | me
    A source | https://example.com/thing | nofollow noopener
    Their post | https://example.com/post | me nofollow author

The values are whatever HTML link types the person types, not a list this CMS keeps: the point is that all of them reach the rendered `rel`. A value is a word of letters and dashes; the rest of the line's rules stand.

**Where the flags end and the URL begins.** The existing parser takes flags off the right while the last bar-separated part names a flag it knows, which is what lets `Odd | /odd/?a=1|2` keep its bar. Keep that shape and change the test from 'is it in MENU_ITEM_FLAGS' to 'does it parse as a list of rel values' — `2` does not, so that case still works. `MENU_ITEM_FLAGS` as a closed list goes.

**What each box adds of its own.** A profile link is published with `rel="me"` whether or not it is typed, because that is what the box is for; typing it is then a no-op rather than an error. A menu link carries only what is typed. Either way the rendered `rel` holds every value, deduplicated, and a theme prints one `rel` attribute rather than two.

**Both hints say the same thing**, because the whole point is that somebody who learns one box has learned the other. The Links hint should stop saying a flag is not typed here, and should say instead that `me` is already added for them and what `rel` is for.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A trailing list of rel values is accepted in a menu line and in a profile link line, and every value reaches the rendered rel attribute, proven by a test for each box
- [x] #2 Several values on one line work — me nofollow author renders all three, in one rel attribute, proven by a test
- [x] #3 A profile link carries rel=me whether or not it is typed, and typing it does not duplicate it, proven by a test
- [x] #4 Odd | /odd/?a=1|2 still keeps its bar in the URL, proven by the existing test passing unedited
- [x] #5 A trailing part that is not a list of rel values is still part of the URL, and a URL holding whitespace is still refused, proven by a test
- [x] #6 MENU_ITEM_FLAGS as a closed list is gone from the codebase and from the package's exports
- [x] #7 Both hints describe the same line, and neither says a flag is refused
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. One line format, worded once, in `web/navigation.ts`. A rel value is a word of letters and dashes (`REL_VALUE_PATTERN`); `relValuesOf(text)` is the words of a bar-separated part when every one of them is a rel value and `undefined` when any is not (so `2` in `/odd/?a=1|2` is not one); `relText(values)` is them lower-cased, deduplicated in the order typed, joined by spaces; `splitLinkRel(line)` takes rel lists off the right while the last part parses, the shape `menuItemOf` already had with the closed-list test swapped out. `LINK_REL_RULE` is the sentence fragment both boxes' refusals word it with, beside `LINK_URL_RULE`. `MENU_ITEM_FLAGS` and `MenuItemFlag` go, from the module and from both barrels.

2. What an item carries. `NavigationItem.me?: true` becomes `rel?: string` — the values as one space-separated, deduplicated, lower-case string, present only when there are any, so a theme writes one `rel` attribute and never joins a list itself. `navigationItemsOf` reads a stored `rel` string through the same normaliser and still reads `me: true` as `rel: 'me'`, because a site.json written before this must not silently lose the only flag it had; the Navigation screen rewrites it as `rel` the next time that menu is saved. `menuItemsText` writes the third part back.

3. Both boxes parse alike. `menuItemOf` and `profileLinkFields` in `admin/users.ts` both go through `splitLinkRel` first, then split what is left at its first bar. `ProfileLink` gains `rel?: string`; `linksFrom` in `admin/accounts.ts` reads it; `formatProfileLinks` writes it back, so a line round-trips through the box unchanged. `withoutMenuItemFlag` and the 'take the flag off' message go — a trailing `| me` is a link now, not a mistake.

4. What the profile box adds of its own. `profileContext` in `web/authors.ts` publishes each link with `relText(['me', ...typed])`, so `rel="me"` is there whether or not it was typed and typing it is a no-op rather than a duplicate. `partials/bio.njk` prints `rel="{{ link.rel }}"` — one attribute, already holding every value — and `partials/menu.njk` prints `{% if item.rel %} rel="{{ item.rel }}"{% endif %}`. The federation attachment keeps its own fixed `rel`, which is about the attachment rather than the link.

5. Both hints say the same line. `admin/pages/navigation/menus.njk` and `admin/pages/users/edit.njk` describe `Label | URL | rel values` in the same words, with the examples from the task; the Links hint stops saying a flag is refused here and says instead that `me` is added for every link on a profile whether or not it is typed, and what rel="me" is for. README.md, packages/cms/README.md, themes/default/README.md and the 11ty fixture (`_data/site.json`, `_includes/page.njk`) follow.

6. Tests first, with the tdd skill: `web/navigation.test.ts` for the several-value line, the `Odd | /odd/?a=1|2` case unedited, the whitespace URL still refused, the legacy `me: true` read; `admin/users.test.ts` for a profile line with rel values stored and rendered, for `| me` accepted and not duplicated, for the hints; the TASK-112 tests that asserted a refusal of `| me` are rewritten to assert it is now stored, keeping their sibling that a bad URL is still refused and that an already-stored bad link still renders and round-trips. Then `pnpm build && pnpm test && pnpm typecheck && pnpm lint`, `pnpm test:11ty`, prettier over the changed files, and both real boxes over HTTP with the rendered rel read off the page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The one line format, in a hint's words

`Label | URL`, one per line, and a line may **end with the `rel` values the link carries, a word each** — `Mastodon | https://example.social/@me | me`, `A source | https://example.com/thing | nofollow noopener`, `Their post | https://example.com/post | me nofollow author`. That sentence is now in both hints, word for word, because the two boxes take one line. The values are whatever HTML link types somebody types; this CMS keeps no list of them.

## Where a rel value ends and a URL begins

`splitLinkRel` in `web/navigation.ts` keeps the shape the flag parser had — take the last bar-separated part off the right, repeatedly — and swaps the test. It used to be 'is this word in MENU_ITEM_FLAGS'; it is now `relValuesOf`: split the part on whitespace and ask whether **every** word is letters and dashes (`REL_VALUE_PATTERN`, `/^[a-z-]+$/i`). So `| nofollow noopener` comes off, `Odd | /odd/?a=1|2` keeps its bar because `2` is not a word, and `Mastodon | https://shll.me/@a | 2 of them` leaves the whole tail in the URL, where `isLinkUrl`'s no-whitespace rule from TASK-112 refuses it. Values are lower-cased and deduplicated in the order typed (`relText`), so `| me | ME nofollow` is `me nofollow`.

## What each box adds of its own

A **menu item** carries only what was typed: `NavigationItem.rel?: string`, one space-separated string, absent when nothing was typed, written to `site.json` as `"rel": "me"`. `navigationItemsOf` still reads `me: true` as `rel: 'me'`, so a `site.json` written under TASK-107 does not lose its flag on upgrade and the Navigation box shows it back as `| me`, rewriting it as `rel` on the next save.

A **profile link** is published `rel="me"` whether or not it is typed — that is what the box is for. `ProfileLink.rel` stores what was typed; `profileContext` in `web/authors.ts` publishes each link as a `PublishedProfileLink` whose `rel` is `relText(['me', typed])`, so typing `me` is a no-op and `| me nofollow author` renders all three. `partials/bio.njk` prints `rel="{{ link.rel }}"` and `partials/menu.njk` prints `{% if item.rel %} rel="{{ item.rel }}"{% endif %}` — one attribute either way, no joining in a template.

## What TASK-112 keeps

The URL rule and its whitespace half, the refusal on save with the panel redrawn around what was typed, the tolerant read, and the handle route. What goes is only the part this task reverses: `withoutMenuItemFlag` and the 'take the flag off' sentence, because `| me` is a link now.

## Tests that changed, and why

- `web/navigation.test.ts`: the flag test became 'reads the trailing rel values, however many were typed', plus a dedup case; the `navigationItemsOf` flag test became one that reads `rel` in every spelling a file may hold, including the old `me: true`; the TASK-112 whitespace test now uses `Mastodon | https://shll.me/@a | 2 of them`, because `| elsewhere` is a rel value now and the rule it proves is about a tail that is **not** one; the refusal message assertion matches 'rel values' rather than 'rel="me"'. The `Odd | /odd/?a=1|2` assertions are untouched.
- `admin/users.test.ts`: the TASK-112 test 'refuses the "| me" a menu item takes' is gone — it asserted exactly what this task reverses — replaced by 'takes the line the menu box takes, rel values and all', which posts the shll.me line and `| me nofollow author` and checks both the file and the round-trip through the box. The AC #5 test about a link stored before the check now uses `Odd | /some where/`, a stored href the box still refuses, because the old `https://shll.me/@a | me` href is now **repaired** on save rather than refused; a new test covers that repair. The hint test asserts the shared sentence and that the word 'flag' is gone from the screen.
- `admin/navigation.test.ts`: the save test stores `rel` and a second, multi-value line and reads both attributes off the public page; 'the me flag (AC #6)' became 'what the Items box says about itself', asserting the same sentence the Links box uses and no 'flag'.
- `web/page-shell.test.ts`, `web/entry.test.ts`, `web/authors.test.ts`: rendered-rel tests for the menu and the bio, including a link that typed `me` and one that typed nothing.
- `test/fixtures/content/_data/site.json` + `_includes/page.njk` + `docs/eleventy.config.example.js`: the 11ty compatibility path reads `rel` (and `me: true` as `rel: 'me'`), so a static build renders what the CMS renders.

## Verified

- `pnpm build && pnpm test && pnpm typecheck && pnpm lint`: 2118 + 30 tests, 0 failures; tsc and eslint clean. `pnpm test:11ty`: 16 + 5, 0 failures. `prettier --check` over every changed file that has a parser (the two .njk admin pages and the two theme partials have none).
- A real server (`tsx`, a site from `geekity init`, port 3141), stopped afterwards. Saved a footer menu of five lines: `site.json` stored `rel: "me"`, `rel: "nofollow noopener"`, `rel: "me nofollow author"` and `Odd | /odd/?a=1|2` with no rel, and the home page printed `rel="me"`, `rel="nofollow noopener"`, `rel="me nofollow author"` and `href="/odd/?a=1|2"` with none. Saved a profile of four links: the author archive printed `rel="me"` for the typed `| me` (once), `rel="me nofollow author"`, `rel="me"` for a link that typed nothing and `rel="me nofollow"` for a bare URL that typed `| nofollow`; the Links box showed all four lines back exactly as typed. `Odd | https://shll.me/@a | 2 of them` was a 400 in both boxes with the same sentence. A hand-written `"me": true` in `site.json` still rendered `rel="me"` and came back in the box as `| me`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every box that takes a link now takes one line: `Label | URL`, ending in the `rel` values the link carries, a word each.

`splitLinkRel` in `web/navigation.ts` is the one place a link line is split, and both boxes call it. It keeps the parser's old shape — values off the right, one bar-separated part at a time — and swaps the closed-list test for `relValuesOf`: every word of the part has to be letters and dashes. So `| nofollow noopener` comes off, `Odd | /odd/?a=1|2` keeps its query string, and a tail that is not a list of values stays in the URL where TASK-112's no-whitespace rule still refuses it. `MENU_ITEM_FLAGS` and `MenuItemFlag` are gone, from the module and from both barrels.

An item and a profile link each carry `rel` as one lower-case, deduplicated string, so a theme prints one attribute and joins nothing: `partials/menu.njk` prints what the item says, `partials/bio.njk` prints what the CMS published, which is `me` plus whatever was typed. That is the difference between the boxes and the whole of it — a profile link is `rel="me"` whether or not somebody types it, so `| me` there is a no-op rather than the error TASK-112 made it. A `site.json` still spelling the old `me: true` is read as `rel: "me"` so nobody loses a flag on upgrade. Both hints, and both refusal messages, now say the same sentence about the trailing part, and neither says a flag is refused.

Verified by `pnpm build && pnpm test && pnpm typecheck && pnpm lint` (2148 tests, none failing), `pnpm test:11ty` (21, none failing), and by driving a real server over curl: five menu lines stored and rendered with `rel="me"`, `rel="nofollow noopener"`, `rel="me nofollow author"` and a bar-holding URL with none; four profile links rendered `rel="me"` once for a typed `me`, `rel="me nofollow author"` for three typed values and `rel="me"` for a link that typed nothing, all four coming back in the box exactly as typed; and the same refusal sentence in both boxes for a tail that is not a rel list.
<!-- SECTION:FINAL_SUMMARY:END -->
