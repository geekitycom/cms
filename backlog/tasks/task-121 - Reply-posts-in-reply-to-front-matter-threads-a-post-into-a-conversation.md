---
id: TASK-121
title: 'Reply posts: in-reply-to front matter threads a post into a conversation'
status: To Do
assignee: []
created_date: '2026-09-20 21:00'
updated_date: '2026-09-20 21:06'
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
- [ ] #1 An `in-reply-to` front matter property holding a valid URL makes the post a reply, ahead of the note/article tail
- [ ] #2 The rendered page carries `u-in-reply-to` on the reply target link
- [ ] #3 The federated object carries `inReplyTo` naming the target URL
- [ ] #4 Publishing a reply sends a webmention to the target, reusing the existing sender and honouring the `webmentionsSend` setting
- [ ] #5 An `in-reply-to` value that is not a valid URL does not make the post a reply, and is reported rather than silently ignored
- [ ] #6 A reply that also has a photo or a title is still discovered as a reply
- [ ] #7 The admin editor can set and clear the reply target
- [ ] #8 The choice of AS2 object type for a titled reply is recorded with its reasoning
- [ ] #9 Tests cover discovery precedence, the markup, the federated object and the webmention
<!-- AC:END -->
