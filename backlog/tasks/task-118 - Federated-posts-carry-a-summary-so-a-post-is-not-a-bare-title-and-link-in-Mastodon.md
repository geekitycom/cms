---
id: TASK-118
title: >-
  Federated posts carry a summary, so a post is not a bare title and link in
  Mastodon
status: To Do
assignee: []
created_date: '2026-09-20 20:59'
updated_date: '2026-09-20 21:06'
labels: []
milestone: m-17
dependencies: []
references:
  - 'https://www.w3.org/TR/activitypub/'
  - 'https://codeberg.org/fediverse/fep/src/branch/main/fep/b2b8/fep-b2b8.md'
modified_files:
  - packages/cms/src/federation/article.ts
type: bug
ordinal: 142800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A published post federates as an ActivityStreams `Article` whose `name` and `content` are set but whose `summary` is not. Mastodon discards an `Article`'s `content` entirely and synthesises the status body from `name` + `summary` + the linkified `url`, so a post from this site currently shows in a Mastodon timeline as a bare title and link with no text at all.

Verified in Mastodon's source (`app/lib/activitypub/parser/status_parser.rb`, checked on `main`, `v4.7.2` and `v4.5.0`):

```ruby
def processed_text
  return text || '' unless converted_object_type?

  [
    title.presence && "<h2>#{title}</h2>",
    spoiler_text.presence,
    linkify(url || uri),
  ].compact.join("\n\n")
end
```

`spoiler_text` is `summary`. `converted_object_type?` is true for `CONVERTED_TYPES = %w(Image Audio Video Article Page Event)`; only `Note` and `Question` take the `content` path.

Two things follow. First, adding `summary` is the whole fix for the reported symptom: Mastodon then renders title + excerpt + link, which is the right shape for a long-form post in a timeline. Second, `processed_spoiler_text` returns `''` for a converted type, so the summary is NOT treated as a content warning on an `Article` and displays uncollapsed. Every other consumer surveyed (GoToSocial, Lemmy, Friendica, Hubzilla, Misskey, Sharkey, Pleroma, Akkoma, Ghost, Mobilizon, Bonfire) renders the full `content` regardless, so one object serves both audiences with no compromise.

Note that Mastodon's own documentation contradicts its source here and says `content` is used and `summary` is a CW. The source is authoritative; the docs are stale.

FEP-b2b8 (Long-form Text) recommends a summary of roughly 500 characters or less, teaser-shaped, with no trailing "Read more" link.

The site already has one summary rule: `feedExcerpt()` in `packages/cms/src/web/feed-item.ts`, which RSS, Atom and JSON Feed all share (TASK-63, TASK-64). The ActivityStreams summary should be the same rule rather than a second one, so a post reads the same way in a feed reader and in a timeline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A published post's ActivityStreams `Article` carries a `summary`
- [ ] #2 The summary comes from the same rule the feeds use (`feedExcerpt`), not a second excerpt implementation
- [ ] #3 A post whose summary would be empty omits the `summary` property rather than emitting an empty string
- [ ] #4 The summary is plain text and carries no trailing "Read more" link
- [ ] #5 Tests cover a post with an author-written `description`, a post with none, and a post whose body is too short to excerpt
<!-- AC:END -->
