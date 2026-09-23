---
id: TASK-118
title: >-
  Federated posts carry a summary, so a post is not a bare title and link in
  Mastodon
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 20:59'
updated_date: '2026-09-23 12:31'
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
- [x] #1 A published post's ActivityStreams `Article` carries a `summary`
- [x] #2 The summary comes from the same rule the feeds use (`feedExcerpt`), not a second excerpt implementation
- [x] #3 A post whose summary would be empty omits the `summary` property rather than emitting an empty string
- [x] #4 The summary is plain text and carries no trailing "Read more" link
- [x] #5 Tests cover a post with an author-written `description`, a post with none, and a post whose body is too short to excerpt
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add failing tests in packages/cms/src/federation/article.test.ts: a post with a description federates that as summary; a post without one federates the feedExcerpt of its body as plain text (no markup, no Read more); a long body is cut at EXCERPT_WORDS; an empty body and an empty description omit summary.
2. In postArticle (packages/cms/src/federation/article.ts) set summary from feedExcerpt(document), passing null when it is empty so Fedify leaves the property out.
3. Run pnpm build, test, typecheck, lint, format:check; curl the demo post as activity+json to see the summary.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
postArticle now sets summary from feedExcerpt(document), the rule RSS, Atom and JSON Feed share, and passes null when it is empty so Fedify omits the property. No second excerpt implementation.

An empty description is not an empty summary: the parser (asString in content/parser.ts) treats description: '' as absent, so such a post falls back to the body excerpt like the feeds do. The empty-summary cases that exist are an empty body and a body whose first paragraph has no text (an image-only post); the test covers both.

Tests (article.test.ts, 'the post summary'): description used verbatim; no description gives plain text of the first paragraph with markup stripped and entities decoded; an 80-word paragraph cut at 55 words with ' …' and no link; empty body and image-only body have no summary key. Mutation check: emitting summary unconditionally makes the omission test fail.

Validation: pnpm build, pnpm test (2140 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all exit 0. HTTP: served a scratch copy of the demo content (apps/demo untouched) and curled with accept: application/activity+json. /2026/08/markdown-on-disk/ returned summary 'Why the files are the source of truth and the database is only an index.'; an added post without a description returned 'A post with no description & a link.' Server stopped. Not verified against a live Mastodon instance.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Federated Articles now carry a summary, so Mastodon (which drops an Article's content and builds the status from name, summary and url) shows title, excerpt and link instead of a bare title and link. The summary is feedExcerpt, the same rule the feeds use, and is omitted when empty. Verified with new tests in article.test.ts, a mutation check on the omission, the full build/test/typecheck/lint/format run, and curl of the ActivityStreams representation on a locally served copy of the demo site.
<!-- SECTION:FINAL_SUMMARY:END -->
