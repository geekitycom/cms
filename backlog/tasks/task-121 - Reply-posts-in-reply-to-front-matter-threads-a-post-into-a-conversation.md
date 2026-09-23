---
id: TASK-121
title: 'Reply posts: in-reply-to front matter threads a post into a conversation'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 21:00'
updated_date: '2026-09-23 13:08'
labels: []
milestone: m-17
dependencies:
  - TASK-120
references:
  - 'https://www.w3.org/TR/post-type-discovery/'
  - 'https://www.w3.org/TR/webmention/'
  - 'https://indieweb.org/IndieMark'
type: feature
ordinal: 145800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site can receive replies (TASK-49 shows replies, likes and boosts on the post page) but cannot publish one. A reply post is the next branch of the Post Type Algorithm and the IndieMark level-3 bar on the posts axis.

From the W3C Post Type Algorithm, verbatim:

> - If the post has an "in-reply-to" property with a valid URL, Then it is a **reply** post.

It sits after event, rsvp, repost and like, and before video, photo and the note/article tail. Order matters and the spec is explicit about why — from its FAQ, a reply that also contains a photo is a **reply**, because "a reply should primarily be displayed as a reply first". That precedence is the main reason this is derived rather than declared: a single `kind:` enum could not express a post that is both.

Front matter uses the microformats2 property name verbatim:

```yaml
---
title: ""
date: 2026-09-20T11:23:45Z
in-reply-to: https://example.com/post
---

Completely agree with this.
```

The hyphenated mf2 name is deliberate over a camelCase alternative. It keeps the front matter honest to the vocabulary the markup already uses, and it means a future Micropub endpoint — the natural way to post from a phone, and something IndieMark rewards — is close to a passthrough rather than a translation layer. It maps to a camelCase field inside the `Document` model as usual.

Three outputs, one property:

1. **Markup** — `u-in-reply-to` on the link, optionally wrapping an embedded `h-cite` for reply context. The theme already emits `h-entry`, `e-content`, `p-name`, `dt-published`, `p-author`, `h-card`, `u-url` and `p-category` from TASK-83, so this is one more property in an established pattern.
2. **ActivityStreams** — `inReplyTo` on the object. Post Type Discovery section 6 maps a reply to "`Note` with `inReplyTo`".
3. **Webmention** — the reply target is notified. The `webmentionsSend` setting and the sending machinery already exist; this should reuse them rather than add a second sender.

One open question for the implementer to settle and record: PTD maps a reply to a `Note`, but a long reply with a real title is arguably an `Article` with `inReplyTo`, and Mastodon threads both. Since Mastodon never reads `name` on a `Note`, a titled reply published as a `Note` silently loses its title. Following the spec (always `Note`) is the simpler and more predictable rule and is the recommended default; if the title case turns out to matter, the reasoning for diverging should be written down.

Deduplication is worth thinking about: a reply that federates over ActivityPub *and* sends a webmention can reach the same recipient twice if they run both. This is a known friction of doing both protocols and does not need solving here, but it should not be made worse.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An `in-reply-to` front matter property holding a valid URL makes the post a reply, ahead of the note/article tail
- [x] #2 The rendered page carries `u-in-reply-to` on the reply target link
- [x] #3 The federated object carries `inReplyTo` naming the target URL
- [x] #4 Publishing a reply sends a webmention to the target, reusing the existing sender and honouring the `webmentionsSend` setting
- [x] #5 An `in-reply-to` value that is not a valid URL does not make the post a reply, and is reported rather than silently ignored
- [x] #6 A reply that also has a photo or a title is still discovered as a reply
- [x] #7 The admin editor can set and clear the reply target
- [x] #8 The choice of AS2 object type for a titled reply is recorded with its reasoning
- [x] #9 Tests cover discovery precedence, the markup, the federated object and the webmention
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: Document.inReplyTo (verbatim string from the in-reply-to front matter key, added to KNOWN_FRONT_MATTER_KEYS; parser reads it, writer writes it after author). PostType gains 'reply'. post-type.ts gets replyTarget(document) (the value when it is an absolute http(s) URL, else undefined) and PostProperties.inReplyTo; discoverPostType checks reply ahead of the note/article tail.
2. Name vs type: a reply can be titled or not, so the places that asked 'postType != note' to mean 'has a name of its own' (post.njk heading, post-list, search, feed-item title) move to a separate derived isNamed(document) test (the note/article tail's rule). Context gains named and inReplyTo (the valid target only).
3. Markup: default and demo themes draw a reply-context line with <a class="u-in-reply-to"> on the post page and in listings.
4. AS2: OBJECT_TYPE_OF.reply = Note; common object fields carry replyTarget (inReplyTo) for Note and Article alike, so an activitypub.type override keeps the thread. noteContent already puts a title into content, so a titled reply as a Note keeps its title. Record as decision-18.
5. Webmention: the sender's targetsOf adds the valid reply target (same external-only filter as body links), so webmentionsSend and the (post,target) records are reused unchanged.
6. Invalid value: content sync warns once per changed file; the admin editor refuses to save a non-URL with a form error.
7. Admin editor: 'In reply to' field (posts only) sets and clears in-reply-to; preview carries it.
8. Tests first per AC: post-type.test (precedence incl. photo/title), parser/writer round trip, notes/web test for u-in-reply-to, article.test for inReplyTo, send.test for the webmention, sync warning, admin posts.test set/clear/refuse. Update doc-2/doc-4/doc-7 where they describe these.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: Document.inReplyTo holds the in-reply-to front matter verbatim (a list of one is read as its URL, anything else non-string is kept as its JSON text so it is reported, not dropped). replyTarget() is the one validity rule: absolute http or https URL. The index gains an in_reply_to column in migration 5, which also empties the index so a file whose in-reply-to used to sit in extra is read again.

A reply can be titled or not, so the note/article test is now isNamed(), asked on its own. The default and demo themes, search and the feed title switch from postType != "note" to the new named context key; the context also carries inReplyTo only when it is a valid URL. Post Type Discovery puts reply ahead of the tail, so a titled reply with a photo is a reply.

AS2: OBJECT_TYPE_OF.reply = Note, and inReplyTo is on the common object fields so an activitypub.type: Article override keeps the thread. A titled reply's title goes into the Note's content via the existing noteContent. Recorded as decision-18.

Webmention: targetsOf in webmention/service.ts adds the reply target through a new externalTarget() in links.ts (the same external-only rule body links get), so the sender, its records and the webmentionsSend switch are reused unchanged. A reply that also links its target in the body is sent once. Dedup across ActivityPub and webmention is unchanged: one webmention per (post, target), as before.

Invalid in-reply-to: content sync logs one warning per changed file naming the path and value; the admin editor refuses to save one with a form error. The preview carries in-reply-to too.

Docs: doc-2 gains the in-reply-to key, doc-4 the reply row and paragraph, doc-7 the reply target in the sending order.

Validation: pnpm build && pnpm test (2212 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. Ran the demo server on a scratch copy of its content with an untitled reply and a bad one: the page carries <a class="u-in-reply-to" href="https://example.com/post">, the home listing carries it too, GET with Accept application/activity+json answers a Note with inReplyTo https://example.com/post, the bad file logs the warning at boot and renders no reply link. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posts with an http(s) in-reply-to in front matter are now replies: discovered ahead of the note/article tail, marked up with u-in-reply-to on the page and in listings, federated as a Note with inReplyTo (decision-18: titled replies stay Notes with the title at the top of content), and sent a webmention through the existing sender under webmentionsSend. An invalid value is logged at index time and refused by the admin editor, which can set and clear the field. Themes head a post by the new named key rather than by postType. Verified by new tests in post-type, parser, writer, store, sync, article, send, admin posts and web/replies, the full build/test/typecheck/lint/format chain, and curl against the demo server.
<!-- SECTION:FINAL_SUMMARY:END -->
