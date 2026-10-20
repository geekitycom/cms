# Micropub

The site has a [Micropub](https://www.w3.org/TR/micropub/) endpoint, so you
can write, edit and delete posts from any Micropub app instead of the admin
editor. The endpoint writes a post the same way the editor does, as the user
who connected the app. Publishing it sends webmentions, federates and updates
the feeds, as a publish from the editor does.

The endpoint is `/_geekity/micropub` and its media endpoint is
`/_geekity/micropub/media`. The site root and every author archive advertise
the endpoint with a `Link: <…>; rel="micropub"` header and a
`<link rel="micropub">` in the head, next to the IndieAuth metadata. The CMS
adds both to the response, so every theme has them. An app finds the endpoint
from the URL you sign in with. In maintenance mode, the endpoint and the media
endpoint answer 503.

## Connecting an app

1. In the app, sign in with your author URL, `https://example.com/author/{username}/`,
   or with the site URL. [Signing in with your own site](indieweb-sign-in.md)
   says which URL works for whom.
2. The app sends you to the site. Sign in to the admin if you are not signed in.
3. The consent screen names the app and lists what it asks for. A Micropub app
   asks for some of these scopes:

   | Scope     | The consent screen says   | What it allows                                       |
   | --------- | ------------------------- | ---------------------------------------------------- |
   | `create`  | Create posts as you       | A `POST` that creates a post, and an upload.         |
   | `update`  | Edit your posts           | `action=update`.                                     |
   | `delete`  | Delete your posts         | `action=delete` and `action=undelete`.               |
   | `media`   | Upload media to your site | An upload to the media endpoint, but no post.        |
   | `profile` | Your name, URL and photo  | Nothing on the endpoint. The app learns who you are. |

   Untick any scope you do not want the app to have. The screen does not show a
   scope the site does not offer, such as `draft`, and the site does not grant
   it. Quill still offers the legacy `post` scope at sign-in. The screen shows
   it as `create` and `update`, and the site grants those two.

4. Choose Approve. The app gets an access token for the scopes you left
   ticked. The token works for seven days. The app renews it with its refresh
   token, so the app stays connected while you use it.

A query works with a token of any scope. A request without the scope its
action needs gets 401 `insufficient_scope`, as the
[Micropub spec's error table](https://www.w3.org/TR/micropub/#error-response)
says. The response has a `WWW-Authenticate: Bearer` header that names the
scope.

When an app cannot sign in or the site refuses its post, open
Users > App activity. The screen lists the request, the properties it sent and
the reason the site gave.
[App activity](indieweb-sign-in.md#app-activity) describes the screen.

## Disconnecting an app

Open Users > Connected apps, at `/admin/users/apps`, and choose Revoke on the
app's row. Its access token and its refresh token stop working at once. Its
next request gets 401 `invalid_token`. To connect the app again, sign in from
the app again. [Connected apps](indieweb-sign-in.md#connected-apps) describes the screen.

Deleting a user also disconnects every app that user connected.

## Sending the token

An app sends its token in an `Authorization: Bearer` header, or in an
`access_token` field of a form-encoded or multipart body. Quill sends the same
token both ways, and the site accepts that.

| Request                                                                                          | Answer                |
| ------------------------------------------------------------------------------------------------ | --------------------- |
| Two different tokens                                                                             | 400 `invalid_request` |
| No token                                                                                         | 401 `unauthorized`    |
| An unknown, expired or revoked token, or one issued for another resource such as an MCP endpoint | 401 `invalid_token`   |

## Creating a post

A `POST` without an `action` creates a post and needs the create scope. The
body is one of:

- Form-encoded: `h=entry&content=…`.
- Multipart: the same fields, with files as parts.
- JSON: `{"type": ["h-entry"], "properties": {…}}`.

In a form, a property with several values is sent once per value, as
`category` or `category[]`. In JSON, each property is a list of values. The
site reads a bare value as a list of one, because Quill's event editor sends
some values that way. The site answers 201 with a `Location` header that names
the new post's URL, for a draft and for a published post.

The endpoint maps these properties onto the editor's fields. decision-27
records the mapping. Each property takes one value unless the table says
otherwise.

| Property               | Becomes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `h=entry`              | A post. In JSON, `"type": ["h-entry"]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `h=event`              | An event (decision-32). In JSON, `"type": ["h-event"]`. Needs `start` and `name`. Its `location` is the event's place, not where the post was written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `h=review`             | A review (TASK-432). In JSON, `"type": ["h-review"]`. Needs `item`. An `h=entry` with an `item` is a review too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `content`              | The body. Text is kept as the Markdown it is written in. `{"html": "…"}` is converted to Markdown. In both cases the HTML in it is cleaned first. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `name`                 | The title. A post without one is a note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `summary`              | The description.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `category`             | The tags, one tag per value. Several values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `published`            | The date. A date without an offset is in the site's time zone. Without it, the post is dated now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `post-status`          | `published` or `draft`. A draft is not published, federated or sent webmentions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `mp-slug`              | The slug in the file name and the URL. Without it, the slug comes from `name`, then from the content's first five words. A like, repost, bookmark or reply with neither takes the cited page's title, as `liked-scripting-news`, or else its address, as `liked-scripting-com`. A photo post with neither takes its first photo's alt text, or else `photo`.                                                                                                                                                                                                                                                                                                                    |
| `in-reply-to`          | Makes the post a reply to that URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `rsvp`                 | `yes`, `no`, `maybe` or `interested`. With an `in-reply-to` that names an event, makes the post an RSVP to that event. Refused without `in-reply-to`. Needs no content. Federates as a Note that replies to the event (decision-31).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `like-of`              | Makes the post a like of that URL. Needs no content. A like of a fediverse status federates as a `Like` of it (decision-28).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `repost-of`            | Makes the post a repost of that URL. Needs no content. A repost of a fediverse status federates as an `Announce` of it (decision-28).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bookmark-of`          | Makes the post a bookmark of that URL. Needs no content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `photo`                | A photo on the post. Several values. A value is a URL, `{"value": "…", "alt": "…"}` in JSON, or a file part in a multipart request. A post with a photo and no reply target is a photo post.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `item`                 | What a review reviews: an h-cite, an h-card for a place, an h-product or an h-item, or a string that is its name. Its `name`, `author`, `published` (the year), `uid`, `url`, `photo`, `category` (what it is), `street-address`, `locality`, `region` and `country-name` are kept, and so are `kind` (`book`, `movie`, `tv`, `album`, `place` or `other`), `date` (the day it was finished, watched, listened to or visited), `season` and `episode`. Without `kind`, an h-card or h-adr is a place and anything else is an other. Any other item property is refused. `uid` is a web address, or `isbn:…` or `doi:…`. `photo` is the item's picture, not a photo on the post. |
| `rating`               | A review's rating, a whole number from 1 to 5, as text or a number. Anything else is refused: `rating is a whole number from 1 to 5, not 4.5.` Refused without `item`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `start`                | When an event starts. A time without an offset is in the site's time zone. Sent only with `h=event`, and refused on an `h=entry`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `end`                  | When an event ends, with `h=event` only. An end before the start is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `location`             | Where the post was written: a `geo:` URI such as `geo:48.85837,2.29448;u=50`, which Quill sends, or an h-geo, h-adr or h-card object. Kept in `data/locations.json`, never in the post's file. [Settings > Privacy](settings.md#location-on-posts) decides what visitors see.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `location` (event)     | With `h=event`, where the event is. Written into the post as its place. The value is words, a web address for an online event, or an h-card or h-adr. An h-card or h-adr is written as its name and address joined by commas, or as its `url` when it has neither. Its coordinates are dropped. A `geo:` URI is refused.                                                                                                                                                                                                                                                                                                                                                        |
| `checkin`              | The venue of a checkin, as an h-card, as Swarm and micropub.rocks send it. Becomes the post's location, marked as a checkin. The name, coordinates, locality, region and country are kept. The URL, street address and postcode are dropped. Needs no content. A `location` sent with it fills in what it leaves out. Visitors see it as any other location.                                                                                                                                                                                                                                                                                                                    |
| `mp-syndicate-to`      | Selects a syndication target by its `uid`, as the editor's Syndicate to checkboxes do. Several values. The post is sent to the targets when it is published.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `slug`, `syndicate-to` | The same as `mp-slug` and `mp-syndicate-to`. Quill accounts created before Quill renamed them still send these names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `p3k-content-type`     | `text/plain` or `text/markdown`, which Quill sends from its content type selector. In both cases the content is kept as Markdown, and the type itself is not stored. Any other type is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `visibility`           | `public` or `unlisted`. Unlisted writes `visibility: unlisted`. The post keeps its page and federates. It is left off every listing and feed, the sitemap and search. `private` is refused, because the site has no private posts.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `access_token`         | The token, when it is not in the header. It is never stored on the post.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

The endpoint cleans content. A post's Markdown is rendered with its raw HTML,
as Eleventy renders it. Without cleaning, an app granted only the `create`
scope could put script on the site.

HTML content goes through an allow-list and is converted to Markdown. The
allow-list keeps headings, paragraphs, emphasis, links, lists, images, code,
quotations, tables, figures and details. The endpoint removes:

- Script, style, iframe, object, SVG and form elements.
- Event-handler and `style` attributes.
- Link addresses with a scheme other than `http`, `https` or `mailto`.
- Image addresses with a scheme other than `http` or `https`.

A table, figure, details or definition list stays as an HTML block, with no
indentation and no blank line inside it. Pretty-printed HTML therefore never
turns into a code block.

Text and Markdown content keeps its text as sent. Each piece of raw HTML in it,
as the renderer reads it, goes through the same allow-list. `q=source` answers
the stored Markdown. Posts written in the editor or as files belong to the site
owner and are not cleaned.

A like, repost or bookmark cites its URL on the post's page. When the post is
published, the site sends that URL a webmention, as it does for a reply.

A photo file part must be an image. The site stores it in the media library,
as the media endpoint stores a file. A photo URL that points at this site's own
uploads is written as the upload's path, so the theme serves its resized
versions. A photo URL on another site is shown from that site. A photo without
its own alt text takes the alt text from the media library.

A request whose `Content-Length` is over the larger of `uploadMaxBytes` and
`uploadMediaMaxBytes`, plus 8 KiB for the multipart envelope, gets 400
`invalid_request` before the site reads its body. The limit covers the whole
request, so several photo files in one create share it. It also applies to JSON
and form-encoded bodies. The media endpoint has the same check.

The site keeps a property that is not in the table, such as `itinerary`, as it
was sent, and publishes the rest of the post. It stores the property in
`data/kept-properties.json`, keyed by the post's URL, with mode 0600. It never
stores the property in the post's file. It shows the property nowhere: not on
the page, in its Markdown or JSON, in the feeds, on the fediverse, in search or
in `llms.txt`. `q=source` returns it, an update changes it, and it moves with
the post. A post keeps up to 16 KiB of these properties. decision-27 records
the rule.

The site answers each of these with 400 `invalid_request` and a description
that names the problem, and writes nothing:

- Another type, such as `h=card`.
- An `mp-` command the site does not carry out, such as `mp-channel`.
- A create whose only properties are ones the site does not understand, such
  as Quill's weight post, which would publish an empty post.
- A file sent as a property other than `photo`.
- A `location` that is not a `geo:` URI or an h-geo, h-adr or h-card.
- A `checkin` that is not an h-card naming a place.
- A second value for a property that takes one.
- A `uid` the site does not declare.
- Anything the editor itself refuses, such as an `in-reply-to` that is not a
  URL.

## Changing and deleting a post

A `POST` with an `action` changes a post that already exists. Its `url` is the
post's URL on this site. A URL that is not a post here gets 400
`invalid_request`. A post that another user wrote gets 403 `forbidden`.

- `action=update` needs the update scope and a JSON body, such as
  `{"action": "update", "url": "…", "replace": {"content": ["…"]}}`.
  - `replace` sets a property's values.
  - `add` adds values to a property, which need not exist yet.
  - `delete` takes away the values it lists, or, given a list of property
    names, the whole properties.

  Only the properties it names change. It accepts the properties a create
  accepts, except `mp-slug` and `slug`. It changes a kept property that the
  site does not understand in the same way as the others. It checks a
  `p3k-content-type` or `visibility` as a create does, and changes nothing with
  it. Adding or deleting an `mp-syndicate-to` value selects or deselects that
  target. The site tells a deselected target that the post no longer links to
  it.

  The site saves an update the same way as an editor save. It stamps the post
  updated, federates an `Update` and sends webmentions. If the post is open in
  the editor, the editor reports a conflict on its next save and does not
  overwrite the update. The site answers 204. It answers 201 with a `Location`
  header when the post's URL changed. Only a re-dated draft can change its URL.

  On an event, `start`, `end` and `location` change the event. Changing one
  keeps the other two. An end before the start is refused. Deleting `start` is
  refused, because the post would no longer be an event. The editor can do
  that. A `start` or `end` sent to a post that is not an event is refused.

  On a review, changing `item` or `rating` keeps the other. Deleting `item`
  makes the post an ordinary entry again.

- `action=delete` needs the delete scope. It moves the post to the trash, as
  the editor's Move to trash does. The post is removed from the site, its feeds
  and search, and the site federates a `Delete`. The body is form-encoded or JSON. The site
  answers 204.
- `action=undelete` needs the delete scope. It restores the post from the
  trash and answers 204.

## Queries

A `GET` with `q` queries the endpoint, which answers JSON. A query with
no `q`, or one the endpoint does not answer, gets 400 `invalid_request`.

- `?q=config` lists:
  - The media endpoint.
  - The syndication targets, under `syndicate-to`.
  - The post types the site accepts: note, article, reply, RSVP, photo, like,
    repost, bookmark, event and review.
  - The queries it answers.
  - The visibility values a post can take,
    `"visibility": ["public", "unlisted"]`.

  Each post type lists the `properties` a client should offer for it and the
  `required-properties` that make a post that type. A client that reads the
  list, such as Micropublish, offers no field the site refuses. The event type
  offers `start`, `end`, `name` and the common properties, and requires `start`
  and `name`. The review type offers `item`, `rating`, `name` and the common
  properties, and requires `item`.

- `?q=syndicate-to` lists the syndication targets on their own. Each is the
  `uid` and `name` of a target in `content/_data/syndicationTargets.json`, with
  its `id` as the `uid`. A site that declares none lists `[]`. The site reads
  the file on each query, so a target added by hand is offered at once.
- `?q=category` lists every tag and category on a published post, once each,
  in alphabetical order. Add `&filter=…` to keep only the terms that contain
  that text, ignoring case.
- `?q=source&url=…` answers a post's properties in the same mapping a create
  takes, so an app can edit them and send them back.
  - The selected syndication targets are under `mp-syndicate-to`. An id in the
    post's `syndicate-to` that names no declared target is left out of the
    answer and kept in the file.
  - A photo in the media library is given as its absolute URL.
  - The post's `location` is answered whatever Settings > Privacy shares,
    because the token's user is the author who sent it. Coordinates alone are
    a `geo:` URI, a place's words are an h-adr, and a named place is an h-card.
    Each has the coordinates and their accuracy nested as `geo`.
  - A checkin is answered as `checkin`, an h-card, instead of `location`.
  - An event is answered as an `h-event`, with its `start` and `end` as UTC
    instants and its place as `location`. The author's own location on an
    event is answered only when it is a checkin.
  - A review is answered as an `h-review`, with its `item` (an h-cite, or an
    h-card for a place, carrying `kind` and the fields above) and its `rating`
    as text.
  - A property the site does not understand is answered as it was sent.

  To get only some properties, without the type, add `&properties[]=content`
  once per property. The same ownership rules as an update apply.

- `?q=source` on the media endpoint answers
  `{"items": [{"url": "…", "published": "…"}]}`. The item is the most recent
  file the token's user uploaded through it, and when. The answer is
  `{"items": []}` when there is no upload or the file has since been deleted.
  `&limit=…` caps the list. The site keeps only the last upload, so the list
  never holds more than one. Quill uses this query to offer a photo uploaded in
  the last 15 minutes for the next note.
- `?q=last` on the media endpoint answers the same upload as `{"url": "…"}`, or
  `{}`. The site keeps each user's last upload and its time in
  `micropub-media.json` in the data directory.

## Uploading media

The media endpoint takes a file before an app names it in a post. It accepts a
token with the create scope or the media scope, because a create can already
carry a photo file part. A token with neither gets 401 `insufficient_scope`,
with a `WWW-Authenticate` header that names `scope="create media"`. A token
with media and without create can upload but cannot create a post.

The body is `multipart/form-data`, with the file in a part named `file`. The
file goes into the media library in the same way as an admin upload. The site
stores it under `content/uploads/{yyyy}/{mm}/`, derives its image variants and
lists it on the media screen. The site answers 201 with a `Location` header
that names the file's URL.

The site answers 400 `invalid_request` with the library's reason, and stores
nothing, for a file that:

- Is over the upload limit.
- Has a type the library does not accept.
- Has bytes that do not match its extension.

## Clients and conformance

Each [micropub.rocks](https://micropub.rocks/) server test request was replayed
with curl against a local site. The full suite was run against shll.me on
0.19.0 (2026-10-03). Every test passes except this one:

- 805 sends the same token in the header and the body and expects the site to
  refuse it, as RFC 6750 says. The site accepts it, because Quill sends its
  token that way. Refusing it would refuse every Quill post.

Test 204 sends a `checkin` h-card. The site publishes the post and keeps the
checkin as the post's location. Settings > Privacy decides how much of the
location is published. A test replays the request.

Test 700 uploads a jpg with the token that micropub.rocks signs in for. That
token has create, update, delete and undelete, and no media. It passes because the media
endpoint takes a create token.

The site supports these parts of [Quill](https://quill.p3k.io/):

- Its note, article, bookmark, like, repost and event editors.
- The location its note editor attaches.
- Its photo uploads through the media endpoint.
- Its last photo offer.

Tests replay the requests that Quill's source builds. On a site with
`requireAltText` on, a photo needs alt text, or the site refuses the post. Type
the alt text in Quill's photo dialog, which then sends
`{"value": "…", "alt": "…"}`. An event whose place Quill looked up keeps the
place's name and address and drops its coordinates. An event given a date and
no time starts at midnight in the site's time zone. Quill's code, review,
itinerary, exercise and weight posts are not supported yet.
