---
id: TASK-251
title: Ask a known provider's oEmbed endpoint when its page names none
status: To Do
assignee: []
created_date: '2026-10-03 23:44'
updated_date: '2026-10-03 23:51'
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
- [ ] #1 A YouTube target whose page is a bot check with no oEmbed link gets the oEmbed title and author, tested with stubbed hosts for watch, shorts and youtu.be URLs
- [ ] #2 A page's own oEmbed link is used ahead of the table; a provider not in the table is unchanged
- [ ] #3 og:title is preferred over <title>, and a title that is only a site suffix counts as none
- [ ] #4 decision-19 records the table
- [ ] #5 TikTok (tiktok.com/oembed) and Reddit (reddit.com/oembed) are in the table: their pages give only 'TikTok - Make Your Day' and 'Reddit' with no oEmbed link, and their endpoints answer with the real title and author (checked 2026-10-03)
- [ ] #6 A known provider's endpoint is asked even when the page fetch fails (Reddit answers the server's page request with 403 but its oEmbed endpoint works), so a refused page still gets a title
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-03 probe with the site's user agent from a home connection: page alone is fine for SoundCloud, Flickr, Spotify, WordPress, X, Mastodon (h-entry), Vimeo, GitHub, Wikipedia, Giphy. TikTok and Reddit pages are generic with no oEmbed link; their endpoints work. Instagram oEmbed needs a Facebook app token: left out. Bluesky and Dailymotion not checked (sample URLs did not resolve).

2026-10-03 probe from the shll.me server (web06): Reddit page 403, reddit.com/oembed works. TikTok page generic, tiktok.com/oembed works. YouTube's dQw4w9WgXcQ page came through in full this time (the bot check is intermittent and per video). Everything else matched the home probe.
<!-- SECTION:NOTES:END -->
