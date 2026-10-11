# Micropub

The site has a [Micropub](https://www.w3.org/TR/micropub/) endpoint, so you
can write, edit and delete posts from any Micropub app instead of the admin
editor. A post made this way is written exactly as the editor writes it, by the
user who connected the app. Publishing it sends webmentions, federates and
updates the feeds as an editor publish does.

The endpoint is `/_geekity/micropub` and its media endpoint is
`/_geekity/micropub/media`. The site root and every author archive advertise
the endpoint with a `Link: <…>; rel="micropub"` header and a
`<link rel="micropub">` in the head, beside the IndieAuth metadata. The CMS adds
both to the response, so every theme carries them and an app finds the
endpoint from the URL you sign in with. The endpoint and the media endpoint
answer 503 in maintenance mode.

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

   Untick any scope you do not want the app to have. A scope the site does not
   offer, such as `draft`, is left off the screen and is not granted. The
   legacy `post` scope, which Quill still offers at sign-in, is shown and
   granted as `create` and `update`.

4. Choose Approve. The app gets an access token for the scopes you left
   ticked. The token works for seven days, and the app renews it with its
   refresh token, so it stays connected while you use it.

A query works with a token of any scope. A request without the scope its
action needs gets 401 `insufficient_scope`, as the
[Micropub spec's error table](https://www.w3.org/TR/micropub/#error-response)
says, with a `WWW-Authenticate: Bearer` header naming the scope.

When an app cannot sign in or its post is refused, open Users > App activity.
It lists the request, the properties it sent and the reason the site gave.
[App activity](indieweb-sign-in.md#app-activity) describes the screen.

## Disconnecting an app

Open Users > Connected apps, at `/admin/users/apps`, and choose Revoke on the
app's row. Its access token and its refresh token stop working at once, and its
next request gets 401 `invalid_token`. To connect it again, sign in from the app
again. [Connected apps](indieweb-sign-in.md#connected-apps) describes the screen.

Deleting a user also disconnects every app that user connected.

## Sending the token

An app sends its token in an `Authorization: Bearer` header, or in an
`access_token` field of a form-encoded or multipart body. Quill sends the same
token both ways, which the site accepts. A request that sends two different
tokens gets 400 `invalid_request`. A request with no
token gets 401 `unauthorized`. An unknown, expired or revoked token, or one
issued for another resource such as an MCP endpoint, gets 401 `invalid_token`.

## Creating a post

A `POST` without an `action` creates a post and needs the create scope. The
body is form-encoded (`h=entry&content=…`), multipart (the same fields, with
files as parts), or JSON (`{"type": ["h-entry"], "properties": {…}}`). In a
form, a property with several values is sent once per value, as `category` or
`category[]`. In JSON, each property is a list of values, and a bare value is
read as a list of one, as Quill's event editor sends some. The site answers 201 with a `Location` header naming the new
post's URL, draft or not.

The endpoint maps these properties onto the editor's fields, and decision-27
records the mapping. Each property takes one value unless the table says
otherwise.

| Property               | Becomes                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `h=entry`              | A post. In JSON, `"type": ["h-entry"]`.                                                                                                                                                                                                                                                                                                                         |
| `h=event`              | An event (decision-32). In JSON, `"type": ["h-event"]`. Needs `start` and `name`. Its `location` is the event's place, not where the post was written.                                                                                                                                                                                                          |
| `content`              | The body. Text is kept as the Markdown it is written in, and `{"html": "…"}` is converted to Markdown. Either way the HTML in it is cleaned first; see below.                                                                                                                                                                                                   |
| `name`                 | The title. A post without one is a note.                                                                                                                                                                                                                                                                                                                        |
| `summary`              | The description.                                                                                                                                                                                                                                                                                                                                                |
| `category`             | The tags, one tag per value. Several values.                                                                                                                                                                                                                                                                                                                    |
| `published`            | The date. A date without an offset is in the site's time zone. Without it, the post is dated now.                                                                                                                                                                                                                                                               |
| `post-status`          | `published` or `draft`. A draft is not published, federated or sent webmentions.                                                                                                                                                                                                                                                                                |
| `mp-slug`              | The slug in the file name and the URL. Without it the slug comes from `name`, then the content's first five words. A like, repost, bookmark or reply with neither is named after the cited page's title, as `liked-scripting-news`, else its address, as `liked-scripting-com`. A photo post with neither is named by its first photo's alt text, else `photo`. |
| `in-reply-to`          | Makes the post a reply to that URL.                                                                                                                                                                                                                                                                                                                             |
| `rsvp`                 | `yes`, `no`, `maybe` or `interested`. With `in-reply-to` naming an event, makes the post an RSVP to it, and refused without it. Needs no content. It federates as a Note replying to the event (decision-31).                                                                                                                                                   |
| `like-of`              | Makes the post a like of that URL. Needs no content. A like of a fediverse status federates as a `Like` of it (decision-28).                                                                                                                                                                                                                                    |
| `repost-of`            | Makes the post a repost of that URL. Needs no content. A repost of a fediverse status federates as an `Announce` of it (decision-28).                                                                                                                                                                                                                           |
| `bookmark-of`          | Makes the post a bookmark of that URL. Needs no content.                                                                                                                                                                                                                                                                                                        |
| `read-of`              | What was read: an h-cite, `{"type": ["h-cite"], "properties": {"name": ["…"]}}` with `author`, `uid` (`isbn:…` or `doi:…`) and `url` when known. With `read-status`, makes the post a read. Needs no content.                                                                                                                                                   |
| `read-status`          | `to-read`, `reading` or `finished`. Sent with `read-of`, and refused without it.                                                                                                                                                                                                                                                                                |
| `photo`                | A photo on the post. Several values. A value is a URL, `{"value": "…", "alt": "…"}` in JSON, or a file part in a multipart request. A post with a photo and no reply target is a photo post.                                                                                                                                                                    |
| `start`                | When an event starts. A time without an offset is in the site's time zone. Sent only with `h=event`, and refused on an `h=entry`.                                                                                                                                                                                                                               |
| `end`                  | When an event ends, with `h=event` only. An end before the start is refused.                                                                                                                                                                                                                                                                                    |
| `location`             | Where the post was written: a `geo:` URI such as `geo:48.85837,2.29448;u=50`, which Quill sends, or an h-geo, h-adr or h-card object. Kept in `data/locations.json`, never in the post's file; [Settings > Privacy](settings.md#location-on-posts) decides what readers see.                                                                                    |
| `location` (event)     | With `h=event`, where the event is, written into the post as its place: words, a web address for an online event, or an h-card or h-adr, which is written as its name and address joined by commas, or as its `url` when it names none. Its coordinates are dropped. A `geo:` URI is refused.                                                                   |
| `checkin`              | The venue of a checkin, an h-card, as Swarm and micropub.rocks send it. It becomes the post's location, marked as a checkin: the name, coordinates, locality, region and country are kept, and the URL, street address and postcode are dropped. Needs no content. A `location` sent with it fills in what it leaves out. Readers see it as any other location. |
| `mp-syndicate-to`      | Selects a syndication target by its `uid`, as the editor's Syndicate to checkboxes do. Several values. The post is sent to the targets when it is published.                                                                                                                                                                                                    |
| `slug`, `syndicate-to` | The same as `mp-slug` and `mp-syndicate-to`. Quill accounts created before Quill renamed them still send these names.                                                                                                                                                                                                                                           |
| `p3k-content-type`     | `text/plain` or `text/markdown`, which Quill sends from its content type selector. Either way the content is kept as Markdown, and nothing else is stored. Any other type is refused.                                                                                                                                                                           |
| `visibility`           | `public` or `unlisted`. Unlisted writes `visibility: unlisted`: the post keeps its page and federates, but is left off every listing, feed, the sitemap and search. `private` is refused, since the site has no private posts.                                                                                                                                  |
| `access_token`         | The token, when it is not in the header. It is never stored on the post.                                                                                                                                                                                                                                                                                        |

Content is cleaned at the endpoint, because a post's Markdown is rendered with
its raw HTML, as Eleventy renders it, and an app granted only the `create`
scope should not be able to put script on the site. HTML content is put through
an allow-list (headings, paragraphs, emphasis, links, lists, images, code,
quotations, tables, figures and details) and converted to Markdown. Script,
style, iframe, object, SVG and form elements, event-handler and `style`
attributes, link addresses with a scheme other than `http`, `https` or
`mailto`, and image addresses with one other than `http` or `https` are
removed. A table, figure, details or definition list
stays as an HTML block with no indentation and no blank line inside it, so
pretty-printed HTML never turns into a code block. Text and Markdown content
keeps its text as sent, and each piece of raw HTML in it, as the renderer reads
it, goes through the same allow-list. `q=source` answers the Markdown that was
stored. Posts written in the editor or as files are the owner's and are not
cleaned.

A like, repost or bookmark cites its URL on the post's page and sends that URL
a webmention when the post is published, as a reply does.

A read prints what was read, such as "Want to read: The Left Hand of Darkness
by Ursula K. Le Guin, ISBN: 9780441478125", on its page, opens its feed items
with the same line and federates as a note that says the same. A `read-of`
with a `url` is sent a webmention, as a citation is. A read keeps no `summary`:
its summary is that line, so changing `read-status` changes it everywhere.
[indiebookclub](https://indiebookclub.biz/) posts reads this way, and a test
replays the request its documentation shows.

A photo file part is stored in the media library the way the media endpoint
stores a file, and must be an image. A photo URL that points at this site's own
uploads is written as the upload's path, so the theme serves its resized
versions. A photo URL on another site is shown from that site. A photo without
alt text of its own takes the alt text from the media library.

A request whose `Content-Length` is over the larger of `uploadMaxBytes` and
`uploadMediaMaxBytes`, plus 8 KiB for the multipart envelope, gets 400
`invalid_request` before its body is read. The limit covers the whole request,
so several photo files in one create share it, and it applies to JSON and
form-encoded bodies too. The media endpoint has the same check.

A property not in the table, such as `itinerary`, is kept as it was
sent and the rest of the post is published. The site keeps it in
`data/kept-properties.json`, keyed by the post's URL and mode 0600, never in
the post's file, and shows it nowhere: not on the page, its Markdown or JSON,
the feeds, the fediverse, search or `llms.txt`. `q=source` gives it back, an
update changes it, and it moves with the post. A post keeps up to 16 KiB of
them. decision-27 records the rule.

Anything else gets 400 `invalid_request` with a description that names it, and
nothing is written. That covers another type such as `h=card`, an `mp-`
command the site does not carry out such as `mp-channel`, a create whose only
properties are ones the site does not understand (Quill's weight post, which
would publish an empty post), a file sent as a property other than `photo`, a
`location` that is not a `geo:` URI or an h-geo, h-adr or h-card, a `checkin`
that is not an h-card naming a place, a second
value for a property that takes one, a `uid` the site does not declare, and
anything the editor itself refuses, such as an `in-reply-to` that is not a URL.

## Changing and deleting a post

A `POST` with an `action` changes a post that already exists. Its `url` is the
post's URL on this site. A URL that is not a post here gets 400
`invalid_request`, and a post another user wrote gets 403 `forbidden`.

- `action=update` needs the update scope and a JSON body, such as
  `{"action": "update", "url": "…", "replace": {"content": ["…"]}}`.
  - `replace` sets a property's values.
  - `add` adds values to a property, which need not exist yet.
  - `delete` takes away the values it lists, or, given a list of property
    names, the whole properties.

  Only the properties it names change. It accepts the properties a create
  accepts, except `mp-slug` and `slug`, and changes a kept property the site
  does not understand as it changes the others. A `p3k-content-type` or `visibility` is
  checked as a create checks it and changes nothing. Adding or deleting an `mp-syndicate-to` value
  selects or deselects that target, and a deselected target is told the post no
  longer links to it. An update is saved exactly as an editor save. The post
  is stamped updated, federates an `Update` and sends webmentions. If the post
  is open in the editor, the editor reports a conflict on its next save instead
  of overwriting the update. The site answers 204, or 201 with a `Location` header
  when the post's URL changed, which only a re-dated draft can do.

  On an event, `start`, `end` and `location` change the event. Changing one
  keeps the other two, an end before the start is refused, and deleting
  `start` is refused, since it would leave a post that is no event; the
  editor can do that. A `start` or `end` sent to a post that is no event is
  refused.

- `action=delete` needs the delete scope. It moves the post to the trash, as
  the editor's Move to trash does. The post leaves the site, its feeds and
  search, and federates a `Delete`. The body is form-encoded or JSON. The site
  answers 204.
- `action=undelete` needs the delete scope. It restores the post from the
  trash and answers 204.

## Queries

A `GET` with `q` asks the endpoint a question and answers JSON. A query with
no `q`, or one the endpoint does not answer, gets 400 `invalid_request`.

- `?q=config` lists the media endpoint, the syndication targets under
  `syndicate-to`, the post types the site accepts (note, article, reply, RSVP,
  photo, like, repost, bookmark, read and event), the queries it answers, and the visibility
  values a post may take, `"visibility": ["public", "unlisted"]`. Each post
  type lists the `properties` a client should offer for it and the
  `required-properties` that make a post that type, so a client that reads
  the list, such as Micropublish, offers no field the site refuses. The event
  type offers `start`, `end`, `name` and the common properties, and requires
  `start` and `name`.
- `?q=syndicate-to` lists the syndication targets on their own. Each is the
  `uid` and `name` of a target in `content/_data/syndicationTargets.json`, with
  its `id` as the `uid`. A site that declares none lists `[]`. The file is read
  on each query, so a target added by hand is offered at once.
- `?q=category` lists every tag and category on a published post, once each,
  in alphabetical order. Add `&filter=…` to keep only the terms that contain
  that text, ignoring case.
- `?q=source&url=…` answers a post's properties in the same mapping a create
  takes, so an app can edit them and send them back. The selected syndication
  targets are under `mp-syndicate-to`; an id in the post's `syndicate-to` that
  names no declared target is left out and kept in the file. A photo in the
  media library is given as its absolute URL. The post's `location` is
  answered whatever Settings > Privacy shares, because the token's user is the
  author who sent it: a `geo:` URI for coordinates alone, an h-adr for a
  place's words, an h-card for a named place, each with the coordinates and
  their accuracy nested as `geo`. A checkin is answered as `checkin`, an
  h-card, instead of `location`. An event is answered as an `h-event` with its
  `start` and `end` as UTC instants and its place as `location`; the author's
  own location on an event is answered only when it is a checkin. A property
  the site does not understand is answered as it was sent. Add `&properties[]=content`, once
  per property, to get only those properties, without the type. The same
  ownership rules as an update apply.
- `?q=source` on the media endpoint answers
  `{"items": [{"url": "…", "published": "…"}]}`, the most recent file the
  token's user uploaded through it and when, or `{"items": []}` when there is
  none or the file has since been deleted. `&limit=…` caps the list; the site
  keeps only the last upload, so the list never holds more than one. Quill asks
  this to offer a photo uploaded in the last 15 minutes for the next note.
- `?q=last` on the media endpoint answers the same upload as `{"url": "…"}`, or
  `{}`. Each user's last upload and its time are kept in `micropub-media.json`
  in the data directory.

## Uploading media

The media endpoint takes a file before an app names it in a post. It takes a
token with the create scope or the media scope, because a create can already
carry a photo file part. A token with neither gets 401 `insufficient_scope`,
whose `WWW-Authenticate` header names `scope="create media"`. A token with media
and without create can upload but cannot create a post. The body is
`multipart/form-data` with the file in a part named
`file`. The file goes into the media library exactly as an admin upload does.
It is stored under `content/uploads/{yyyy}/{mm}/`, its image variants are
derived, and it is listed on the media screen. The site answers 201 with a `Location` header
naming the file's URL. A file over the upload limit, of a type the library does
not accept, or whose bytes do not match its extension gets 400
`invalid_request` with the library's reason, and nothing is stored.

## Clients and conformance

Each [micropub.rocks](https://micropub.rocks/) server test request has been
replayed with curl against a local site, and the full suite was run against
shll.me on 0.19.0 (2026-10-03). Every test passes except this one:

- 805 sends the same token in the header and the body and expects it refused,
  as RFC 6750 says. The site accepts it, because Quill sends its token that way
  and refusing it would refuse every Quill post.

Test 204 sends a `checkin` h-card. The site publishes the post and keeps the
checkin as the post's location, published only as far as Settings > Privacy
allows. A test replays the request.

Test 700 uploads a jpg with the token micropub.rocks signs in for, which has
create, update, delete and undelete and no media. It passes because the media
endpoint takes a create token.

[Quill](https://quill.p3k.io/) is supported: its note, article, bookmark, like,
repost and event editors, the location its note editor attaches, its photo uploads
through the media endpoint, and its last photo offer. Tests replay the
requests its source builds. On a site with `requireAltText` on, a photo needs
alt text: type it in Quill's photo dialog, which then sends
`{"value": "…", "alt": "…"}`, or the post is refused. An event whose place
was looked up keeps the place's name and address and drops its coordinates,
and one given a date and no time starts at midnight in the site's time zone.
Quill's code, review, itinerary, exercise and weight posts are not supported
yet.
