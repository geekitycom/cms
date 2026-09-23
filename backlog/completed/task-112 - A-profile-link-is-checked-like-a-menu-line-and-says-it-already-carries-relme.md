---
id: TASK-112
title: 'A profile link is checked like a menu line, and says it already carries rel=me'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 17:06'
updated_date: '2026-09-20 17:49'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/src/admin/users.ts
  - packages/cms/src/web/navigation.ts
  - packages/cms/admin/pages/users/edit.njk
  - packages/cms/themes/default/partials/bio.njk
  - packages/cms/src/web/routes.ts
modified_files:
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/admin/users.ts
  - packages/cms/admin/pages/users/edit.njk
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/index.ts
  - packages/cms/src/web/index.ts
  - README.md
  - packages/cms/README.md
type: bug
ordinal: 137800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on shll.me. The maintainer typed a line they had learned from the Navigation screen into a user profile's Links box:

    Mastodon | https://shll.me/@a | me

`parseProfileLinks` (admin/users.ts:697) splits on the first `|` and validates nothing, so the link was stored with the href `https://shll.me/@a | me`. The page rendered it, the browser percent-encoded the space and the bar, the handle route took `/@a | me` and redirected, and the reader landed on `https://shll.me/author/a%20%7C%20me/`. Every layer did something defensible with nonsense it should have refused at the first one.

Three things to fix, in order of how much they matter:

**A profile link's URL is not checked.** The menu parser refuses a URL that is neither a path nor an absolute http(s) URL, and says which line is wrong. A profile link takes anything. The same rule and the same message belong here — the check already exists, so this is about using it rather than writing it.

**The two boxes disagree about what a line means.** A menu line is `Label | URL` with flags after further bars; a profile line is `Label | everything else`. Somebody who learns one is taught the wrong thing about the other, which is exactly what happened. Decide whether a profile link should take the flags too or whether the difference stays, and say on the screen which it is. Note that a profile link already renders `rel="me"` — `bio-links` in the packaged theme emits it — so a `me` flag would be either redundant or a way to turn it off, and today nothing on the screen says the links carry it at all.

**A handle route that redirects anything.** `/@a | me` redirected rather than answering 404, which is what turned a bad link into a confusing one. Check what the handle route does with a handle no user answers to, and make it say so.

The maintainer also asked whether rel=me matters at all: it is required by nothing in Geekity or ActivityPub, and exists for Mastodon's profile-field verification and IndieAuth. The Links hint should say what it is for, since somebody deciding what to type there has no other way to know.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A profile link whose URL is neither a path nor an absolute http(s) URL is refused, naming the line, the way a menu line is, proven by a test
- [x] #2 The line typed on shll.me — a label, a URL and a trailing | me — is refused rather than stored, proven by a test
- [x] #3 The Links box says that a profile link carries rel=me, and whether a flag is accepted there
- [x] #4 The handle route answers 404 for a handle no user answers to rather than redirecting, proven by a test
- [x] #5 A link already stored that would now be refused still renders and still round-trips through the form, so nobody's profile breaks on upgrade, proven by a test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. One URL rule, worded once. In `web/navigation.ts`, export `isLinkUrl(url)` — a site-root path, or an absolute http(s) URL, and no whitespace in it — and `LINK_URL_RULE`, the sentence fragment both boxes describe it with. `menuItemOf` and `menuItemLineProblem` use them, so there is one rule and one wording. The whitespace half is what the live bug turned on: `new URL('https://shll.me/@a | me')` parses and percent-encodes the space, so the URL check as it stands accepts it. A bar inside a URL stays legal (`/odd/?a=1|2` is an existing, deliberate menu case); a space does not.

2. Decide the flags question: a profile link takes no flags, and the screen says why. `bio-links` already renders every profile link with rel=me, so a `| me` there is either noise or a switch for turning off the only thing the box is for. AC #2 also asks for that line to be refused rather than stored. So the difference stays and the Links hint carries it.

3. `admin/users.ts`: add `profileLinkLineProblem(value)`, naming the first line that is not a profile link, the way `menuItemLineProblem` names the first that is not a menu item. A line is `Label | URL` or a bare URL that labels itself, and the URL goes through `isLinkUrl`. A line ending in a word from `MENU_ITEM_FLAGS` gets its own sentence — the box already carries rel=me, take the `| me` off — because that is the mistake that was actually made.

4. The profile POST refuses on that problem the way the Navigation screen does: 400, the edit screen re-rendered, the boxes holding exactly what was typed, the message beside the Links box. `parseProfileLinks` stays tolerant and unchanged: it is the read-back half, and the file's reader (`linksFrom`, `cleanProfile`) never validates, so a link stored before this still renders and still comes back in the box (AC #5). Refusing on save is not refusing on read.

5. `admin/pages/users/edit.njk`: the Links hint says what a URL may be, that every link here is published with rel=me and what that is for (Mastodon's profile-field verification, IndieAuth), and that a profile link therefore takes no `| me` flag the way a menu item does. The Links box shows the refusal.

6. `federation/mount.ts`: `/@handle` looks the handle up among the usernames, exactly spelled, the way WebFinger does. A handle nobody answers to falls through to the site's own not-found handler — the theme's 404 — rather than redirecting anything at all to `/author/<nonsense>/`.

7. Tests, written first: `web/navigation.test.ts` for the whitespace URL; `admin/users.test.ts` for the refused line, the shll.me line by name, the hint, and the already-stored bad link rendering and coming back in the box; `federation/federation.test.ts` for the 404. Then `pnpm build && pnpm test && pnpm typecheck && pnpm lint`, prettier over the changed files, and the real form and the real handle route over HTTP.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What a profile line may hold

`Label | URL`, or a bare URL that labels itself, one per line; blank lines are skipped. The URL is a site-root path or an absolute http(s) URL with no whitespace in it — `isLinkUrl` in `web/navigation.ts`, the rule the menu box already applied. It may not hold a flag, a second bar with a word after it, or a label with nothing to link to.

## The flags decision

**The difference stays, and the screen says so.** A profile link takes no flags. `partials/bio.njk` renders every one of them `rel="me"` already, so a `| me` here would be either noise or a switch for turning off the only thing the box is for — and AC #2 asks for exactly that line to be refused. The Links hint now says what the box takes, that every link in it is published with `rel="me"`, what that buys (Mastodon's profile-field verification, IndieAuth) and that a menu line's `| me` is not typed here because it is already there. A line that ends in a flag and would otherwise be a link gets its own message rather than the generic one, read off `MENU_ITEM_FLAGS` so a second flag on the Navigation screen is one this box knows to refuse without anybody remembering to come back.

## The URL rule had to be tightened, not just reused

`new URL('https://shll.me/@a | me')` does not throw: it reads the space and the bar as path characters and percent-encodes them, so the check as it stood said yes. Reusing it unchanged would have left AC #2 unmet. `isLinkUrl` therefore refuses whitespace, which also makes true what `menuItemOf`'s comment already claimed — that a trailing `| elsewhere` is refused rather than swallowed into the URL. A bar with no space around it is still a URL character, so the existing `Odd | /odd/?a=1|2` menu case is untouched.

## Refused on save, tolerant on read (AC #5)

The profile POST answers 400 and redraws the panel around what was typed, the way the Navigation screen does, so the line to fix is still there and nobody loses the bio they typed beside it. Nothing else changed: `parseProfileLinks`, `cleanProfile` and `linksFrom` still take anything, so a link stored before this check renders on the page and comes back in the box. Refusing a save is not refusing a read.

## The handle route

`/@{handle}` now looks the handle up among the usernames, spelled exactly, the way WebFinger matches. A handle nobody answers to falls through to the site's own not-found handler, so it gets the theme's 404 page. `/@ada` still 301s to `/author/ada/`.

## Verified

- `pnpm build && pnpm test && pnpm typecheck && pnpm lint`: 2114 + 30 tests, 0 failures; typecheck and eslint clean. prettier --check over every changed .ts and .md file.
- A real server (`tsx`, a site made by `geekity init`, port 3123) over curl: `/@ada` → 301 `/author/ada/`; `/@a%20%7C%20me`, `/@nobody`, `/@ADA` → 404 with the theme's "Not found" page. Signed in to the admin, posted `Mastodon | https://shll.me/@a | me` to `/admin/users/profile` → 400, the flag message under the Links box, "Nothing was saved" above the panel, every box still holding what was typed, and no `profile` key in `data/users.json`. The same line with the flag taken off → 303 and stored. Then hand-wrote the bad href into `data/users.json` and reloaded: the author archive prints `<a class="u-url" rel="me" href="https://shll.me/@a | me">Mastodon</a>` and the form shows the line back. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A profile link is now held to the menu box's URL rule, and the Links box says what it is for.

`isLinkUrl`/`LINK_URL_RULE` in `web/navigation.ts` are the one rule and the one wording both boxes use; the rule also refuses whitespace, because `new URL` happily reads `https://shll.me/@a | me` as a path and that is what turned a typo into a redirect. `profileLinkLineProblem` in `admin/users.ts` names the first line that is not a profile link, and says something more useful for a line that ends in a menu item's flag. The profile POST refuses with a 400 and the panel redrawn around what was typed, the way the Navigation screen does; the read side is untouched, so a link stored before the check still renders and still comes back in the box. The Links hint says a profile link carries `rel="me"`, what Mastodon and IndieAuth do with it, and that no `| me` is typed here. `/@{handle}` answers only for a username a user has, exactly spelled, and otherwise falls through to the theme's 404.

Verified by `pnpm build && pnpm test && pnpm typecheck && pnpm lint` (2144 tests, none failing) and by driving a real server over curl: the refused save, the stored-and-still-rendering bad link, `/@ada` → 301, and `/@a%20%7C%20me` → 404.
<!-- SECTION:FINAL_SUMMARY:END -->
