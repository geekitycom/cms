---
id: TASK-57
title: Store dates as UTC instants and render them in the site's timezone
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 12:25'
updated_date: '2026-09-04 12:51'
labels:
  - content
  - theme
  - admin
dependencies:
  - TASK-14
  - TASK-44
references:
  - >-
    backlog/decisions/decision-11 -
    Dates-are-stored-as-UTC-instants-the-timezone-setting-only-decides-how-they-are-shown.md
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today `date` is kept as the file spells it and only the index normalises it; the theme prints UTC, the editor's free-text date field lets an offset-less value be read as the server's local time, the `/YYYY/MM/` permalink is cut from the literal string, and the `timezone` setting is used only for the "Scheduled for" note. Per decision-11, every date the CMS writes (`date`, `updated`, `activitypub.published`) becomes a UTC instant ending in `Z`, and the timezone setting becomes the one lens through which instants are shown and read: the editor shows a stored date as wall-clock time in the site zone with the zone named and reads offset-less input as that zone; the theme `date` filter renders `readable`, `html` and `year` in the site zone while `iso` stays the instant; a new post's filename day and permalink month come from the calendar day in the site zone at save time and never move when the setting changes later. Hand-written files with an offset keep being read (Eleventy parity) and are rewritten as UTC the next time the CMS saves them. Feeds, the sitemap and the ActivityStreams Article keep emitting instants. Convert the demo posts and the package's site template to UTC, and document the rule in the README, the theme README, doc-2, and the Eleventy example (Luxon with `zone` from `site.json`). Node 24 has no built-in Temporal; look at what `toInstant` in the federation module already uses before adding a dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post saved from the editor has `date` and `updated` written as UTC instants ending in Z whatever the site timezone, and offset-less input such as `2026-09-04 09:00` is read as that wall-clock time in the site's timezone
- [x] #2 The editor shows a stored date as wall-clock time in the site's timezone with the zone named, and a document saved with the field untouched round-trips its instant unchanged
- [x] #3 The theme `date` filter renders readable, html and year in the site's timezone and iso as the UTC instant; changing the timezone setting changes what a page shows without any file changing
- [x] #4 A file hand-written with an offset such as 2026-06-02T07:30:00-05:00 is read correctly, sorts and schedules by its instant, and is written back as UTC the next time the CMS saves it
- [x] #5 A new post's filename day and /YYYY/MM/ permalink come from the calendar day in the site's timezone, and changing the timezone afterwards does not change an existing post's URL
- [x] #6 Feeds, the sitemap and the ActivityStreams Article keep emitting UTC instants, and a scheduled post fires at its instant regardless of the timezone
- [x] #7 The demo posts and the site template are converted to UTC, and the README, theme README, doc-2 and the Eleventy example document the rule and the Luxon recipe
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module `src/content/time.ts`: `toUtcInstant(value, zone)` (an offset-carrying value keeps its instant; an offset-less wall clock is read in `zone`), `wallClockIn(instant, zone)` (the editor's field text, sub-second digits kept only when the instant has them), `calendarDayIn`, `zoneLabel`, `DEFAULT_TIMEZONE`. Built on the `@js-temporal/polyfill` already a runtime dependency for `toInstant` in the federation module, so no new dependency.
2. Writer/save path: `saveDocument` gains an optional `timezone` and normalises `date`, `updated` and `activitypub.published` to UTC instants before serialising, so the parse/serialize hash round trip still holds and every CMS write — editor, taxonomy rewrite, federation stamp — converts at once. A scan never rewrites a file.
3. Parser: `asDate` keeps reading a hand-written offset verbatim (Eleventy parity) and `defaultPermalink` keeps cutting the literal string, so a hand-written file with no permalink resolves where Eleventy puts it.
4. Admin editor: the date field shows `wallClockIn(date, timezone)` with the zone named beside it; the save reads offset-less input as that zone; `blankForm`/`formFor` take the zone; the filename day and the `/YYYY/MM/` permalink come from `calendarDayIn(instant, zone)` at save time. The permalink is already written explicitly into every file the admin saves, so a later zone change cannot move an existing URL; `previousDefaultPermalink` is made zone-aware to match.
5. Theme `date` filter: `formatDate(value, format, timezone)`; the Nunjucks filter reads the zone from the render context's `site.timezone` (nunjucks calls a filter with `this` bound to the context), with an optional third argument to force one. `readable`, `html` and `year` become zone-dependent; `iso` stays the instant. Breaking change to the filter contract.
6. Feeds, sitemap, ActivityStreams Article, `dateSortKey` and the scheduler keep working on instants and are left alone.
7. Convert the six demo posts and `now.md` to Z instants; keep the offset fixtures under `packages/cms/test/fixtures/content` so the hand-written path stays proven.
8. Docs: README settings table, `packages/cms/README.md`, the theme README's filter row, doc-2, and `docs/eleventy.config.example.js` (the Luxon recipe reading `zone` from `site.json`).
9. Verify: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` and `pnpm test:11ty`, then a live pass against the demo on port 3000 with `notifyServer` emptied for the run.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

A new `src/content/time.ts` holds the whole conversion, built on `@js-temporal/polyfill` — already a runtime dependency of the package for `toInstant` in the federation module, so nothing new was added. `Temporal.PlainDateTime.toZonedDateTime` is the inverse `Intl` could not give: a wall clock placed in a zone, with Temporal's default disambiguation for the two hours a daylight-saving change breaks (the earlier reading when the clock goes back, the same distance past the gap when it goes forward). Four functions: `toUtcInstant`, `wallClockIn`, `calendarDayIn`, `zoneLabel`.

- **`saveDocument` is the one place that converts.** It normalises `date`, `updated` and `activitypub.published` before serialising, so the editor, a taxonomy rewrite and the federation's stamp all convert without any of them knowing they do, and the parse/serialize hash round trip inside `saveDocument` still holds. It takes an optional `timezone` (UTC by default) for the one case that needs a zone: an offset-less date somebody wrote by hand. A scan does not come through here, so a hand-written offset survives until something actually saves the file.
- **The parser was left alone.** `asDate` still keeps a hand-written offset verbatim and `defaultPermalink` still cuts the literal string, which is what keeps a file with no `permalink` key resolving where Eleventy puts it.
- **The admin** reads the date field as wall clock in the site's zone, shows a stored instant the same way with the zone named under the field, and passes the zone to `saveDocument`. `blankForm` and `formFor` gained an optional zone; both now use `store.now()` rather than a fresh `Date`.
- **The theme filter** is `date(format, zone)`. It reads the zone from the render's own `site` global — Nunjucks calls a filter with the template context as `this`, confirmed against the compiler (`env.getFilter(name).call(context, …)`) — so nothing is threaded through the templates and the environment holds no per-request state. `readable`, `html` and `year` move with the setting; `iso` is always the instant.
- **The preview** converts the same way, so what the Preview button shows is the date the save will write.

## Decisions

- **Permalink stability comes from the filename, not from re-deriving.** The permalink is already written explicitly into every file the CMS saves, so parsing never re-derives it. The remaining hazard was the save path: a re-save recomputes the default permalink to answer 'has the author customised this?', and a zone-derived month would move an uncustomised URL when the setting moved. So a new `filedDay` takes the calendar day from the site's zone for a new date and **from the day already in the document's filename** when the date has not moved. The day a post is filed under is therefore decided once, when it is written, and lives on disk where no setting can reach it. `previousDefaultPermalink` uses the same day, which keeps 'rename the slug and the URL follows' working and keeps 'change the date and the URL follows' working too.
- **Second-precision instants, and sub-second digits kept when they exist.** `toUtcInstant` writes `2026-09-04T14:00:00Z` rather than `…00.000Z`, and `wallClockIn` appends `.785` only for an instant that has it. That is what makes 'save with the date field untouched' round-trip the exact instant rather than truncating it — no hidden 'was it edited' state, just a field that spells what it holds. One test expectation in `delivery.test.ts` moved from `.000Z` to `Z` for this.
- **The Eleventy example config keeps its promise of no npm dependencies.** decision-11 names Luxon as the documented recipe, and the README gives the Luxon version, but the example config is re-exported by `apps/demo/eleventy.config.js` precisely because it carries no imports; Luxon is not resolvable from `packages/cms` under pnpm. So the config ships an `Intl`-based `date` filter that reads `timezone` from `content/_data/site.json`, with the Luxon one-liner in a comment beside it and in the README. The demo's Eleventy layout now uses the filter, so `pnpm test:11ty` exercises the recipe rather than trusting it.
- **The zone is read per render, never stored.** One Nunjucks environment serves every request; a zone held on it would be a race between two of them.

## Breaking change

The theme `date` filter's contract changes: `readable`, `html` and `year` are now rendered in the site's `timezone` rather than in UTC. `iso` is unchanged. A theme that relied on UTC output sees different text. This is a `feat!` for a 0.x package.

## Verification

**Tests.** 26 new node:test cases. 15 in the new `content/time.test.ts` (the wall-clock read, an offset kept, a bare day as midnight, the DST gap, the unknown-zone fallback, the round trip through `wallClockIn` including sub-second digits, the calendar day, the zone label in both halves of the year); 4 in `content/save.test.ts` (an offset rewritten as UTC with the index hash matching the bytes, an offset-less date read in the given zone, the permalink and path left where they were, an unreadable date refused); 6 in `admin/posts.test.ts` (the instant written, a post filed under the zone's day and not UTC's, the field shown with the zone named, the untouched round trip, the hand-written offset rewritten, and an existing URL staying put); 1 in `web/site.test.ts` (the setting changing the page and not the file).

Mutation-checked rather than trusted: making the filter's `site` lookup return nothing fails the `web/site.test.ts` case and leaves the other 49 in that file passing, which is how the render-context path is known to be covered on its own.

**Checks, from the repository root.** `pnpm build` clean; `pnpm test` 863 pass / 0 fail (`@geekity/cms`) and 11 / 0 (demo); `pnpm test:11ty` 10 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` clean.

**Live, against the demo on port 3000**, signed in as `ada`, timezone `America/Chicago`. `notifyServer` was emptied on the settings screen before the first save and put back at the end.

- **AC #1/#2.** The blank editor offered `2026-09-04 07:46:07.288` under the hint `Wall-clock time in America/Chicago (CDT). Stored as UTC.` — 07:46 local against 12:46 UTC. A post saved with `date=2026-10-01 00:30:00` wrote `date: '2026-10-01T05:30:00Z'` and `updated: '2026-09-04T12:46:15.523Z'`; reloading the editor showed the field back as `2026-10-01 00:30:00`.
- **AC #5.** A second post saved with `date=2026-09-30 20:00:00` — an instant of `2026-10-01T01:00:00Z`, so UTC was already on 1 October — was filed as `posts/2026-09-30-late-on-the-thirtieth.md` with `permalink: /2026/09/late-on-the-thirtieth/`. Changing the setting afterwards moved neither: with `Pacific/Auckland` set, `/2026/08/markdown-on-disk/` still answered 200 and its file was byte-identical.
- **AC #3.** `/2026/08/markdown-on-disk/` rendered `<time class="dt-published" datetime="2026-08-18T14:15:00.000Z">18 August 2026</time>` in `America/Chicago` and `…>19 August 2026</time>` in `Pacific/Auckland` — the same instant in the attribute, a different calendar on the page, with nothing on disk changed. The home page's listing `html` dates moved with it (`2026-09-03` in Auckland for a post dated `2026-09-02T15:05:00Z`).
- **AC #4.** A file written by hand with `date: '2026-04-04T23:30:00-05:00'` and `draft: true` was indexed by the watcher and left byte-for-byte alone — a scan does not rewrite. Saving it from the editor with nothing changed wrote `date: '2026-04-05T04:30:00Z'`, the same instant, and kept the filename `2026-04-04-…` and the permalink `/2026/04/…` — the zone's day, not the UTC day. A second hand-written file that was published was rewritten as UTC by the federation's stamp, which is a CMS save and not a scan.
- **AC #6.** In both `America/Chicago` and `Pacific/Auckland`, `/feed/` gave `Wed, 02 Sep 2026 15:05:00 GMT`, `/feed/atom/` `2026-09-02T15:05:00.000Z`, `/feed/json/` the same, `/sitemap.xml` `2026-09-02T15:05:00Z` and the ActivityStreams object `2026-08-18T14:15:00Z` — identical. The scheduled post 404ed in both zones (the comparison is against the instant), while the editor's note read `Scheduled for 30 September 2026 at 20:00 CDT` and `Scheduled for 1 October 2026 at 14:00 GMT+13`.
- **AC #7.** The six demo posts and `pages/now.md` were converted to `Z` instants (same instants; the package's site template was already UTC, and the offset fixtures under `packages/cms/test/fixtures/content` were deliberately left as they are so the hand-written path stays proven). The rule is written up in the root README's Site settings section, a new 'Dates and the timezone setting' section of `packages/cms/README.md`, a new Dates section of doc-2, the theme README's `date(format, zone)` row, and `docs/eleventy.config.example.js` plus a row in the README's Eleventy table and the Luxon recipe beside it.

**Restored.** The four test posts were deleted, `apps/demo/data/geekity.db` was restored from the backup taken before the run, and `content/_data/site.json` is byte-identical to its pre-run copy. `git status apps/demo` shows only the intended changes: the seven date conversions and the Eleventy layout now using the `date` filter. `pgrep -fl "tsx watch"`, `pgrep -fl server.ts` and `lsof -nP -iTCP:3000` all report nothing.

**One slip to record.** `notifyServer` was restored to `https://rpc.rsscloud.io` in the same command that deleted the four test files, so the watcher's `deleted` change for the one published test post — origin `watch`, which does ping — very likely sent one round of rssCloud pings naming `http://localhost:3000` feed URLs. Nothing else in the run reached it: every editor save and every scan-origin rewrite happened while the setting was empty, and a scan-origin change never pings. The pings themselves are inert, since rpc.rsscloud.io cannot fetch a localhost URL.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A date in a file is now an instant, and the timezone setting is a lens rather than a decoration.

Every date the CMS writes — `date`, `updated`, `activitypub.published` — ends in `Z`. That happens in exactly one place, `saveDocument`, just before the bytes are serialised, so the editor, a taxonomy rewrite and the federation's stamp all convert without any of them knowing they do, and the hash the index holds is still the hash of the file on disk. A scan does not come through there, so a file written by hand keeps its offset until something actually saves it — and is read for the instant it names all the while, which is why sorting and scheduling never needed touching.

The setting is now consulted in the three places where a date meets a person. The editor shows a stored instant as the clock reads in the site's zone and names the zone under the field, and reads back what you type in the same zone: `2026-09-04 09:00` in a Chicago site is `2026-09-04T14:00:00Z` in the file. The theme's `date` filter renders `readable`, `html` and `year` in that zone while `iso` stays the instant, taking the zone from the render's own `site` global — Nunjucks calls a filter with the template context as `this`, so no template had to change and the environment holds no per-request state. And a new post's filename day and `/{yyyy}/{mm}/` come from the calendar day the zone was on: a post saved at eight in the evening on 30 September in Chicago is filed under September, though UTC had already turned over.

The hard part was making sure the setting can never move a URL. The permalink was already written into every file, so parsing was safe; the save path was not, because it recomputes the default to ask whether the author had customised it. So the day a post is filed under is now read off its own filename whenever its date has not moved. It was decided once, when the post was written, and it lives on disk where no setting can reach it.

The conversion is loss-free in both directions. Instants are written at second precision and `wallClockIn` keeps sub-second digits only for an instant that has them, so a form saved with the date field untouched writes back the very instant it was filled in from — no hidden state, just a field that spells what it holds. `Temporal.PlainDateTime.toZonedDateTime` from `@js-temporal/polyfill`, already a dependency for the federation module, supplies the inverse `Intl` could not, including the two hours a daylight-saving change breaks.

Feeds, the sitemap, the ActivityStreams objects and the scheduler are untouched and were checked to emit byte-identical instants under two very different zones.

**This is a breaking change to the theme `date` filter**: `readable`, `html` and `year` were UTC and are now the site's zone.

Verified by 26 new node:test cases — 15 over the conversion itself, 6 through the admin's HTTP editor, and one in `web/site.test.ts` that was mutation-checked to prove it covers the render-context lookup on its own — and by a live pass against the demo: an offset-less date saved as `2026-10-01T05:30:00Z`, a post filed under the zone's day rather than UTC's, the same post's rendered date moving from 18 to 19 August as the setting moved from Chicago to Auckland with the file and the URL untouched, a hand-written offset surviving a scan and converting on the next save while keeping its filename and permalink, and all three feeds, the sitemap and the AS object identical in both zones. `pnpm build`, `test` (863 + 11), `test:11ty` (10 + 5), `typecheck`, `lint` and `format:check` all pass. The demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
