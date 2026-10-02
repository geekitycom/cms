---
id: TASK-213
title: 'Podcasting: an audio or video enclosure on any post'
status: To Do
assignee: []
created_date: '2026-10-02 11:41'
updated_date: '2026-10-02 11:43'
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
- [ ] #1 The post editor can attach one uploaded audio or video file to a post as its main enclosure, and remove it; the choice is saved in the post's front matter
- [ ] #2 The post editor can add, edit and remove alternate versions, each either an uploaded file or a linked URL with a MIME type; a linked version without an http(s) URL or a MIME type is refused with a message and nothing is saved
- [ ] #3 The media library and editor upload accept MP3, M4A/AAC, Ogg/Opus, MP4 and WebM files, checked by extension, declared type and first bytes, and the upload size limit for them is configurable and documented, including the reverse-proxy note
- [ ] #4 The RSS item for a post with a main file has an enclosure whose url is absolute and whose length and type match the uploaded file
- [ ] #5 Each alternate version prints as a podcast:alternateEnclosure with type, a podcast:source uri, and length, title, height and lang when known; the podcast namespace is declared only when a feed prints a podcast element
- [ ] #6 A post with a transcript or captions file prints podcast:transcript with its type, and rel="captions" for VTT or SRT
- [ ] #7 A post with a known duration prints itunes:duration in RSS and duration_in_seconds in JSON Feed; with no duration neither appears and the itunes namespace is not declared
- [ ] #8 An RSS feed with at least one enclosure declares podcast:medium blog on the channel; a feed with none prints no podcast or itunes namespace or element and its ETag is unchanged
- [ ] #9 Atom prints the main file as link rel="enclosure" with type and length, and JSON Feed lists the main file and alternate versions as attachments
- [ ] #10 The default theme plays the main file on the post page with a native audio or video element, links the alternate versions and the transcript, and prints nothing on a post without one
- [ ] #11 The RSS feed with an enclosure, alternate versions and a transcript validates with xmllint and is read correctly by a Podcasting 2.0 validator or app, or the notes record what was checked
- [ ] #12 The README documents the front matter, the feed elements and when each is printed, and the elements deliberately left out
- [ ] #13 The ActivityPub object of a post with a main file carries it as an Audio or Video attachment with an absolute url, mediaType and name, beside its Image attachments; a post without one is unchanged
- [ ] #14 A post with an audio main file, federated to a real Mastodon account, plays in the timeline, or the notes record what Mastodon showed and why
<!-- AC:END -->
