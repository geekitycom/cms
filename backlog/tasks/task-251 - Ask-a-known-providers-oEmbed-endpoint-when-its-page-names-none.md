---
id: TASK-251
title: Ask a known provider's oEmbed endpoint when its page names none
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 23:44'
updated_date: '2026-10-03 23:56'
labels:
  - webmention
  - indieweb
dependencies: []
priority: medium
type: bug
ordinal: 266800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A YouTube like on shll.me (0.19.0) printed 'Liked - YouTube'. Run from the server, the watch page is YouTube's 'confirm you're not a bot' page: <title> - YouTube</title>, no og:title and no oEmbed link. The same server gets the full answer from https://www.youtube.com/oembed?format=json&url=… (title, author_name Matt Talks Tech, author_url). A laptop gets the full page, so the block is by address.

In packages/cms/src/webmention/reply-context.ts, keep a small table of providers whose JSON oEmbed endpoint is known (YouTube: youtube.com and m.youtube.com watch and shorts URLs, and youtu.be), and ask that endpoint when the page names none, through the same guarded fetch, deadline and limits as a discovered one. The page's own link still wins when it has one. Also prefer og:title over <title> (og:title rarely carries the ' - Site' suffix), and treat a title that is nothing but a site suffix such as '- YouTube' as no title.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A YouTube target whose page is a bot check with no oEmbed link gets the oEmbed title and author, tested with stubbed hosts for watch, shorts and youtu.be URLs
- [x] #2 A page's own oEmbed link is used ahead of the table; a provider not in the table is unchanged
- [x] #3 og:title is preferred over <title>, and a title that is only a site suffix counts as none
- [x] #4 decision-19 records the table
- [x] #5 TikTok (tiktok.com/oembed) and Reddit (reddit.com/oembed) are in the table: their pages give only 'TikTok - Make Your Day' and 'Reddit' with no oEmbed link, and their endpoints answer with the real title and author (checked 2026-10-03)
- [x] #6 A known provider's endpoint is asked even when the page fetch fails (Reddit answers the server's page request with 403 but its oEmbed endpoint works), so a refused page still gets a title
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. In reply-context.ts add a KNOWN_OEMBED_PROVIDERS table: hosts + path pattern (tested against pathname+search) -> JSON endpoint. YouTube (youtube.com, www., m. /watch?v= and /shorts/; youtu.be), TikTok (/@user/video/id -> www.tiktok.com/oembed), Reddit (/r/x/comments/ -> www.reddit.com/oembed). The endpoint is asked with format=json&url=<target>.
2. fetchReplyContext: the page's own oEmbed link wins; with none, or when the page fetch fails, ask the table's endpoint through fetchOembed (same fetchPublic guards, byte limit and the one deadline). An h-entry still skips oEmbed. A failed page with no oEmbed answer keeps the page's refusal reason.
3. describe: og:title before <title>; a page title that starts with a separator ("- YouTube", "| Site") counts as none. Bidi stripping stays.
4. TDD: failing tests first in reply-context.test.ts with stubbed hosts for watch, shorts, youtu.be, TikTok, Reddit, a refused page (403), own-link precedence, an unlisted provider unchanged, og:title order and suffix-only titles.
5. Append a TASK-251 amendment to decision-19; update the theme README line on where a citation's name comes from.
6. Live check from a scratch script; run build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-03 probe with the site's user agent from a home connection: page alone is fine for SoundCloud, Flickr, Spotify, WordPress, X, Mastodon (h-entry), Vimeo, GitHub, Wikipedia, Giphy. TikTok and Reddit pages are generic with no oEmbed link; their endpoints work. Instagram oEmbed needs a Facebook app token: left out. Bluesky and Dailymotion not checked (sample URLs did not resolve).

2026-10-03 probe from the shll.me server (web06): Reddit page 403, reddit.com/oembed works. TikTok page generic, tiktok.com/oembed works. YouTube's dQw4w9WgXcQ page came through in full this time (the bot check is intermittent and per video). Everything else matched the home probe.

Built KNOWN_OEMBED_PROVIDERS in reply-context.ts (hosts + path/query regex -> endpoint, asked with format=json&url=<target>) and knownEndpoint(). fetchReplyContext no longer returns early on a failed page: with no h-entry it asks the page's own oEmbed link, else the table's endpoint, through fetchOembed (same fetchPublic guards, byte limit, one deadline). A failed page with no oEmbed answer keeps its own refusal reason. describe() takes og:title before <title> through pageTitle(), which treats a title starting with a separator and a space as none.

Tests (reply-context.test.ts, stubbed hosts): YouTube watch (www, bare, m., v not first, with t=), shorts, youtu.be (with and without ?si=) bot-check pages; TikTok and Reddit generic pages; Reddit 403 page still named from its endpoint; 403 plus failed endpoint keeps 'answered 403'; page's own link wins over the table; h-entry skips the table; unlisted URLs (plain host, channel page, watch without v, TikTok profile, subreddit) ask nothing more; the endpoint gets only what is left of the deadline; og:title over <title>; suffix-only titles are none; a title with an inner ' - ' is kept.

Live check 2026-10-03 from a laptop (scratch script, real DNS and network): YouTube watch, youtu.be and shorts, TikTok video, Reddit comments and Vimeo all came back named, with author where the endpoint gives one. Note: at the 3 s save-time timeout, youtu.be (303 to a ~1 MB watch page) once came back without the oEmbed author because reading the page used the deadline; with 10 s it gets the author. The page's own link must still be read before the table is asked, so a slow page can starve the endpoint at save time; the background fetch after the save has the full timeout.

Validation: pnpm build, pnpm test (3848 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. decision-19 amended with the table; theme README updated where it says where a citation's name comes from.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A cited YouTube, TikTok or Reddit page that names no oEmbed endpoint, or refuses the server outright, is now named from that provider's known JSON oEmbed endpoint, held in one table in reply-context.ts and fetched with the same guards, byte limit and single deadline as a discovered endpoint. A page's own oEmbed link still wins and an h-entry still wins over both. Page titles now prefer og:title to <title>, and a title that is only a site suffix such as '- YouTube' counts as none. Verified with stubbed-host tests for every criterion, a live scratch-script run against the real providers, and the full build/test/typecheck/lint/format suite. decision-19 and the theme README record the change.
<!-- SECTION:FINAL_SUMMARY:END -->
