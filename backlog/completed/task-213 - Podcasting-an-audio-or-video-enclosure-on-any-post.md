---
id: TASK-213
title: 'Podcasting: an audio or video enclosure on any post'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 11:41'
updated_date: '2026-10-02 14:38'
labels:
  - feeds
  - media
  - editor
  - theme
dependencies: []
references:
  - 'https://www.rssboard.org/rss-specification'
  - >-
    https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/alternate-enclosure.md
  - >-
    https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/transcript.md
  - >-
    https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/medium.md
  - packages/cms/src/content/media.ts
  - packages/cms/src/web/feed-rss.ts
  - packages/cms/src/web/feed-item.ts
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/src/federation/article.ts
priority: medium
type: feature
ordinal: 229800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post cannot carry a recording, so a site cannot publish a spoken version of an article or an occasional episode. Let any post have one main media file, written to the RSS `<enclosure>`, plus any number of other versions written as Podcasting 2.0 `<podcast:alternateEnclosure>` elements (for example a video version when the main file is audio, or a low-bandwidth version). The site is a blog that sometimes has audio, not a podcast host, so the feed carries what podcast apps need to play, describe and caption an item, and not the Apple Podcasts directory tags.

**The main enclosure** is always a file uploaded to the media library. RSS 2.0 requires `url`, `length` in bytes and `type`, and an upload is the only way the site knows all three.

**An alternate version** is either an upload or a link to a file hosted elsewhere, such as a video on a CDN. A linked version needs its MIME type from the author, because `type` is required. `length` is only recommended for a link, so it may be left out. Each alternate version has a `podcast:source` with its URI and may have a `title` of up to 32 characters, plus `height` for video and `lang`.

**Elements and when to print them.** A post with no enclosure prints none of these, and a feed with no such post declares neither namespace.
- Item `<enclosure>`: the post has a main file.
- Item `<podcast:alternateEnclosure>` with `<podcast:source>`: once per alternate version.
- Item `<podcast:transcript>`: the post has a transcript or captions file (`text/vtt`, `application/x-subrip`, `text/html` or `text/plain`), with `rel="captions"` for a timed file. A transcript also makes the recording accessible on the page.
- Item `<itunes:duration>`: the duration is known. Players show it, and it is the one iTunes element worth printing outside a podcast directory.
- Channel `<podcast:medium>blog</podcast:medium>`: the feed has at least one item with an enclosure. Without it, apps assume `podcast`. The spec defines `blog` for informally written articles that sometimes have a spoken version attached.

**Left out on purpose:** the Apple directory tags (`itunes:image`, `itunes:category`, `itunes:explicit`, `itunes:owner`), plus `podcast:guid`, `podcast:locked`, `podcast:person`, `podcast:season`, `podcast:episode`, `podcast:value` and `podcast:chapters`. Each one only matters to a podcast directory or a dedicated show. Adding them is a follow-up if a site wants to be listed in Apple Podcasts. `podcast:license` could reuse the TASK-206 license, but that is also a follow-up.

**Other places.**
- Atom carries the main file as `link rel="enclosure"` with `length`.
- JSON Feed carries the main file and the alternate versions as `attachments`, with `mime_type`, `size_in_bytes`, `title` and `duration_in_seconds`.
- The default theme plays the main file on the post page with `<audio>` or `<video controls>`, offers the alternate versions as links, and links the transcript.

**Uploads.** Uploads accept only images, PDF, text and Markdown today, capped at 10 MiB (`DEFAULT_UPLOAD_MAX_BYTES`). Common audio and video formats (MP3, M4A/AAC, Ogg/Opus, MP4, WebM) need to be allowed, with byte-signature checks like the existing types. They also need a size limit large enough for an episode. A reverse proxy in front of the site (see the Docker deploy docs) may cap request bodies too.

**The fediverse.** The post's ActivityPub object gets the main file as an `Audio` or `Video` attachment, with its absolute URL, `mediaType` and the post title as `name`. It is added beside the `Image` attachments that `imageAttachments` in `federation/article.ts` builds (TASK-141), so Mastodon shows a player in the timeline. Mastodon strips media out of `content` and shows only attachments, which is why this matters. Alternate versions and linked files stay out: a remote server fetches and re-encodes attachments, and a link to another host is a type this site cannot check. Mastodon caps remote media size and may not mix audio or video with images in one status, so check what it does with a real post rather than assume.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The post editor can attach one uploaded audio or video file to a post as its main enclosure, and remove it; the choice is saved in the post's front matter
- [x] #2 The post editor can add, edit and remove alternate versions, each either an uploaded file or a linked URL with a MIME type; a linked version without an http(s) URL or a MIME type is refused with a message and nothing is saved
- [x] #3 The media library and editor upload accept MP3, M4A/AAC, Ogg/Opus, MP4 and WebM files, checked by extension, declared type and first bytes, and the upload size limit for them is configurable and documented, including the reverse-proxy note
- [x] #4 The RSS item for a post with a main file has an enclosure whose url is absolute and whose length and type match the uploaded file
- [x] #5 Each alternate version prints as a podcast:alternateEnclosure with type, a podcast:source uri, and length, title, height and lang when known; the podcast namespace is declared only when a feed prints a podcast element
- [x] #6 A post with a transcript or captions file prints podcast:transcript with its type, and rel="captions" for VTT or SRT
- [x] #7 A post with a known duration prints itunes:duration in RSS and duration_in_seconds in JSON Feed; with no duration neither appears and the itunes namespace is not declared
- [x] #8 An RSS feed with at least one enclosure declares podcast:medium blog on the channel; a feed with none prints no podcast or itunes namespace or element and its ETag is unchanged
- [x] #9 Atom prints the main file as link rel="enclosure" with type and length, and JSON Feed lists the main file and alternate versions as attachments
- [x] #10 The default theme plays the main file on the post page with a native audio or video element, links the alternate versions and the transcript, and prints nothing on a post without one
- [x] #11 The RSS feed with an enclosure, alternate versions and a transcript validates with xmllint and is read correctly by a Podcasting 2.0 validator or app, or the notes record what was checked
- [x] #12 The README documents the front matter, the feed elements and when each is printed, and the elements deliberately left out
- [x] #13 The ActivityPub object of a post with a main file carries it as an Audio or Video attachment with an absolute url, mediaType and name, beside its Image attachments; a post without one is unchanged
- [x] #14 A post with an audio main file, federated to a real Mastodon account, plays in the timeline, or the notes record what Mastodon showed and why
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Model the enclosure once: content/enclosure.ts parses the 'enclosure' front matter (url, type, length, duration, transcript, alternates[]) into a typed Enclosure at the boundary; incomplete data is dropped.
2. Media table: replace UploadMediaType.image with a kind (image/audio/video/text/document), add MP3, M4A, AAC, Ogg/Opus, MP4, WebM with byte signatures, plus VTT and SRT for transcripts. Add a separate configurable size limit for audio and video (uploadMediaMaxBytes / GEEKITY_UPLOAD_MEDIA_MAX_BYTES).
3. Editor: main file select of uploaded audio/video, duration, transcript, alternate rows (upload or link + MIME, title, height, lang); save writes type and length from the file on disk; refuse bad links.
4. Feeds: FeedItem.enclosure with absolute URLs; RSS enclosure, podcast:alternateEnclosure/source, podcast:transcript, itunes:duration, channel podcast:medium blog, namespaces only when used; Atom rel=enclosure; JSON Feed attachments. FEED_ITEM_REVISION unchanged so feeds without enclosures keep their ETag.
5. Default theme: audio/video player, alternate links, transcript link.
6. Federation: Audio or Video attachment beside the Image attachments.
7. README docs; xmllint and parser checks on a real feed; Mastodon check after deploy.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation (branch task-213-podcast-enclosures, 7 commits): upload table gains kind + MP3/M4A/AAC/Ogg/Opus/MP4/M4V/WebM/VTT/SRT with signatures; uploadMediaMaxBytes (GEEKITY_UPLOAD_MEDIA_MAX_BYTES, 200 MiB); uploads now served with media types and single-range 206 support (Safari needs it to play). content/enclosure.ts parses the front matter; editor Recording fieldset on posts; RSS/Atom/JSON Feed elements with conditional podcast/itunes namespaces, FEED_ITEM_REVISION unchanged and a test pins no-recording feed bytes+ETag; default theme partials/recording.njk; federation Audio/Video attachment placed before images. AC#11 check: a feed built through the real editor save and /feed/ route (main mp3 upload, mp4 upload alternate, CDN link alternate, VTT transcript, duration 30:34) passes xmllint --noout; Atom passes xmllint; JSON Feed parses; no-recording feeds print neither namespace. Not yet run through a Podcasting 2.0 validator or app (needs a public URL). AC#14 (real Mastodon) not done: needs a deploy.

Verification (2026-10-02, branch task-213-podcast-enclosures):
- cms suite 3211/3211 pass; typecheck, lint, format:check clean.
- Demo site, real Chrome: published a post through the editor with an uploaded MP3 main file, duration 0:08, an uploaded VTT transcript and an uploaded MP4 alternate (title Video, height 240). The front matter got type audio/mpeg, length 64617 and 105548 (the true file sizes) and duration 8.
- The post page renders the audio player, the Captions link and the Video link. The tab was hidden, so Chrome deferred loading the media element itself. Instead, in-page fetches with Range bytes=0- and bytes=60000- got 206 with 64617 and 4617 bytes, Web Audio decoded 8.0 s, and the VTT is served as text/vtt.
- AC#11: xmllint --noout passes on the live RSS. podcast-partytime (Podcast Index's parser) reads medium=blog, the enclosure (url, length 64617, audio/mpeg), duration 8, the alternateEnclosure (video/mp4, 105548, title Video, height 240, its source) and the transcript (text/vtt, rel captions). No public URL, so the podba.se web validator was not run.
- AC#8: feed-enclosure.test.ts pins the sha256 and ETag of RSS, Atom and JSON Feed for a site with no recording, and asserts FEED_ITEM_REVISION is 6.
- Beyond the brief: /uploads/ now answers single byte ranges (206, If-Range, 416), because Safari will not play media without them, and serves audio, video and text/vtt with their real types.
- Known gap: a site that already had hand-written enclosure keys before upgrading gets new feed bytes under its old ETag until that post changes.
- Open: AC#14, a real Mastodon check, waits on a deploy.

AC#14 verified 2026-10-02 after 0.15.0 deployed to shll.me: a post with monster-mash.m4a (audio/mp4, 6508495 bytes) as its main file plays on the post page and in the me.dm timeline, and seeking works there. The podba.se validator, run on https://shll.me/feed/, flagged: no cover art; no byte-range support; channel missing itunes:category, itunes:explicit and itunes:image. The byte-range flag looks like a false positive: through Caddy, HEAD returns Accept-Ranges: bytes, and Range bytes=0-1, 0-, 1000-2000, -100 and 0-0 all return 206 with the right lengths over HTTP/2 and HTTP/1.1, as does HEAD with Range. The cover art and itunes flags are the Apple directory tags the README lists as left out on purpose; adding them is a follow-up, not filed yet.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posts can carry an audio or video main file, alternate versions and a transcript, set in the editor and stored in front matter. RSS prints enclosure, podcast:alternateEnclosure, podcast:transcript, itunes:duration and podcast:medium blog, with namespaces only when used; Atom and JSON Feed carry the same files; the default theme plays it; federation sends it as an Audio or Video attachment; /uploads/ answers byte ranges. Verified by the cms suite and gates, an editor-to-feed run checked with xmllint and podcast-partytime, and after the 0.15.0 deploy a real post on shll.me that played and seeked in the me.dm timeline. podba.se flags the Apple directory tags left out on purpose and a byte-range warning that curl does not reproduce.
<!-- SECTION:FINAL_SUMMARY:END -->
