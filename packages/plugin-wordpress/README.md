# @geekity/plugin-wordpress

A [Geekity CMS](https://github.com/geekitycom/cms/blob/main/packages/cms/README.md) plugin for a site that moved from the
WordPress ActivityPub plugin. It does three things:

- It answers the old plugin's inbox and collection paths until every
  follower's server has refetched the actor.
- It records when each path was last requested.
- It adds two imports. `geekity import wordpress` imports the content of a
  WordPress export. `geekity import wordpress-actor` imports each person's key
  pair, actor id and followers.

A site that started on the CMS never needs it. Stored actor ids, post object
ids, WebFinger aliases and the feed and archive layout belong to every site and
are in `@geekity/cms` (decision-14).

## Installing it

It works with every 0.x release of `@geekity/cms` from the one it was built
against, which its peer dependency names.

Add the package to the site and to `plugins` in the site's config:

```sh
pnpm add @geekity/plugin-wordpress
```

```ts
import { defineConfig } from '@geekity/cms/config';
import wordpress from '@geekity/plugin-wordpress';

export default defineConfig({
  plugins: [wordpress],
});
```

On Docker, add the package to the plugins folder instead, then press Reload
under `/admin/plugins`:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-wordpress
```

Both imports work as soon as the plugin is installed. The old paths, and the
redirects from WordPress media URLs, are served only while the plugin is
enabled under `/admin/plugins`. If you disable it, they stop on the next
request, with no restart.

The plugin keeps three files in `data/plugins/@geekity/plugin-wordpress/`:

| File            | What it holds                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actors.json`   | Each username and the number WordPress gave that person's actor. The old paths are built from the number. The import writes this file.                                                      |
| `requests.json` | When each old path was last requested, per user, and when the shared inbox was. If you lose it, the screen's times reset.                                                                   |
| `import.json`   | A hash of every file `geekity import wordpress` wrote, by path, and each `site.json`, `media.json` and redirect key it set. If you lose it, every imported file is a clash on the next run. |

## The old paths

A follower's server still holds the WordPress plugin's endpoints, such as
`/wp-json/activitypub/1.0/actors/2/inbox`, the shared
`/wp-json/activitypub/1.0/inbox`, and the collections beside them. These
paths are cached data, not identity. A follower's server replaces them the next
time it refetches the actor. The site serves them for a while, then stops.

While the plugin is enabled, the plugin serves:

- real inbox routes on those paths. They verify signatures the same way the
  site's own inboxes do, so an unsigned or badly signed delivery is refused.
- GET routes for the actor, its outbox, its followers and its following

A peer always reads back the canonical document: the same `id`, the same key,
and the _canonical_ inbox and collections. A follower that refetches the actor
at the old URL learns the new endpoints. A user with no number in
`actors.json` is not reachable through any of these paths.

Each path records the time it was last requested. The plugin's screen under
Plugins, `/admin/plugins/@geekity/plugin-wordpress`, lists each path with that
time, or _Never_. Once every follower's server has refetched the actor, no
more requests arrive, and you can disable the plugin.

## Bringing the content across

`geekity import wordpress` reads the WXR file WordPress writes under Tools >
Export (or `wp export`) and writes its contents into the content directory:

```sh
geekity import wordpress example.WordPress.2026-10-08.xml \
  --uploads ./wp-content/uploads \
  --origins https://staging.example.com
```

`--uploads` is a copy of the site's `wp-content/uploads`. An export carries
no files. `--origins` is a comma-separated list of any other hosts in the
posts' media URLs, such as the staging host the site was built on. Both are
optional. See [Media](#media).

A file that is not a WordPress export is refused before anything is written,
with each problem named, and the command exits 1.

The command prints the totals, then one tab-separated row per item: its
outcome, post type, WordPress id, title, the file it went to, and the
reason.

| Outcome     | What it means                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `written`   | The file is new, was changed on WordPress since the last run, or was removed here and is written again.  |
| `unchanged` | The file already holds what WordPress has.                                                               |
| `removed`   | A comment the import wrote is no longer on WordPress, or is spam or trash there. It is removed here.     |
| `kept`      | The file was edited on this site and WordPress has not changed it since. The edit stays.                 |
| `conflict`  | The file was edited on this site and changed on WordPress too. The edit stays. The row gives both dates. |
| `clash`     | A file the import never wrote is at the path. It is left alone.                                          |
| `skipped`   | The item has no Geekity CMS counterpart, such as a revision, a menu or the ActivityPub plugin's records. |
| `warned`    | The item was imported, with something the operator should check.                                         |

**You can run it any number of times.** Two runs over one export leave the
content directory byte for byte the same as one run. A run over a newer export
picks up what was added or edited on WordPress since. The import never
overwrites a file it did not write, and never deletes a file, so you can edit
imported files and keep the edits. The one thing a rerun removes is an imported
comment that WordPress no longer has, as described under comments below. To take WordPress's side of a conflict,
remove the file and run the import again.

### Posts and pages

Each post becomes `posts/YYYY-MM-DD-slug.md`, dated by its local publish date,
and each page becomes `pages/slug.md`. The front matter keeps the URLs and ids
that visitors, feed readers and followers already know:

| Key             | Where it comes from                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permalink`     | The URL WordPress served, from the export's link. A draft has none yet, so it gets the one the published posts' structure gives it. A page gets its parents' slugs.                            |
| `redirect_from` | The URLs the post had before WordPress renamed or redated it: its permalink with each `_wp_old_slug` in place of its slug, and each `_wp_old_date` in place of its date.                       |
| `date`          | `post_date_gmt`. A draft WordPress never dated has none.                                                                                                                                       |
| `updated`       | `post_modified_gmt`, when it differs from the date.                                                                                                                                            |
| `tags`          | The post's tags, by name.                                                                                                                                                                      |
| `categories`    | The post's categories, by name.                                                                                                                                                                |
| `draft`         | `true` for a draft, a pending post, and a private or password-protected one, which the report names. A scheduled post keeps its date and publishes then.                                       |
| `author`        | The WordPress login, when the site has a user by that name. A post by any other login has no author, and the report names it.                                                                  |
| `in-reply-to`   | The URL an ActivityPub plugin reply block answers.                                                                                                                                             |
| `activitypub`   | On a published post, `id` is `https://example.com/?p=ID`, the object id the ActivityPub plugin served. A post the plugin federated (`activitypub_status` is `federated`) also has `published`. |
| `guid`          | The WordPress guid, when it is not the post's `?p=` address, so feed readers see no old post as new.                                                                                           |
| `migrated`      | `true` on everything but a scheduled post, so importing it, or publishing a draft later, sends nothing to anyone. A scheduled post publishes here as news, as it would have on WordPress.      |

**Expect one difference when you diff the feeds.** WordPress prints the escapes in a
non-ASCII slug in lower case, as in `/2026/07/i-%e2%99%a5-rss/`. The site
prints them in upper case, as in `/2026/07/i-%E2%99%A5-rss/`, in the RSS,
Atom and JSON feeds, the comments feeds, `rel="canonical"`, `og:url`, the
sitemap and the ActivityStreams `url`. Under RFC 3986 the two spellings are
the same URL, and both answer `200` with the post. A feed reader keys an item
on its `guid`, which the import keeps, so the post does not show as new.

A post in the status format has no title, so it becomes a note. The page
WordPress served at the home URL becomes `homepage` in `_data/site.json`. The
import sets that key only while the site has not set it, or still holds what
the import last set.

The body becomes Markdown:

- Block comments are removed.
- A classic post's line breaks become paragraphs, as WordPress showed them.
- A YouTube or Vimeo iframe or embed becomes the video's URL on a line of its
  own. The site plays it.
- HTML that Markdown cannot express stays HTML: other iframes, a figure with a
  caption, a table with spans, and an element that carries a `style` or
  microformats class.
  `<!--more-->` stays where it was. Media URLs point at the files under
  `/uploads/`, as [Media](#media) describes.

### Media

Each attachment's original is copied from `--uploads` into `content/uploads/`
at the path WordPress kept it under, such as `uploads/2024/03/photo.png`.
WordPress's size variants (`photo-1024x575.png`, `photo-scaled.png`) are not
copied, because the site makes its own. A file that a post or page shows but
that is not an attachment is copied too, for that post.

Every media URL in a body becomes a root-relative `/uploads/` URL of the
original. This applies in Markdown and in the HTML the import keeps, for URLs
on the export's own origin, on an `--origins` host, or root-relative. A URL of
a size variant points at its original. An upload URL on any other host is left
unchanged.

Each file must pass the same rules as an upload through the editor: the site's
allowed types and size limits. The import removes location and camera details.
A file the site would refuse is not copied. The report names it, and names each
file missing from `--uploads`. Without `--uploads`, nothing is copied and the
report names each attachment.

An attachment's alt text (`_wp_attachment_image_alt`) goes to
`_data/media.json` under its upload path. The editor offers alt text from that
file. The import owns each key it set there, never the file.

While the plugin is enabled, a request for `/wp-content/uploads/<path>`
answers 301 at `/uploads/<path>`, so links from elsewhere still reach the file.
A request for a size variant the import did not copy redirects to its original,
as `import.json` records it. The query string is kept. The import writes no
`redirects.json` entry per file. Keep the plugin enabled for as long as links to
the old media URLs matter.

### Comments and reactions

For each post or page the import writes, every comment WordPress kept on it
goes into the post's comment file, `_data/comments/<slug>.json`. The site's own
comments go to the same file. This covers form comments, and the likes,
reposts, replies, mentions, bookmarks and pingbacks that the ActivityPub and
Webmention plugins stored as comments. Each one appears under the post the
same way as a comment the site received itself:

| WordPress                                                 | Here                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `comment`, `like`, `repost` with `protocol` `activitypub` | A fediverse reply, like or boost, linked to the remote post.   |
| `comment`, `like`, `repost` with `protocol` `webmention`  | A webmention reply, like or repost, linked to its source page. |
| `mention`, `bookmark`, `webmention`                       | A mention, linked to the page that linked here.                |
| `pingback`, `trackback`                                   | A mention, linked to the page that pinged.                     |
| `comment` with no protocol                                | A comment left on the page.                                    |

A commenter's name is the text WordPress showed. WordPress stores a name as
HTML, so `Andy Sylvester&#039;s Web` arrives as `Andy Sylvester's Web`. A
post's title and its tag and category names are decoded the same way.

A reply keeps the comment it answers. An approved comment is approved here. A
comment WordPress held for moderation is held here too. Spam and trash are left
out and named in the report. A commenter's email goes only to
`data/comments/`. The import announces nothing. It emails no moderator and
delivers nothing.

Every imported comment is `migrated: true`. It shows on its post and in its
thread like any other comment, and replies to it thread under it. It is in no
feed: not `/comments/feed/`, not a post's `{permalink}feed/`, not a
`/replies/{key}/` feed, and not in the reply counts the feeds give. A
subscriber to WordPress's comments feed sees nothing new when the site moves.

Each comment keeps its `origin`, the name it was first published under. Its id
is the key the site gives the same comment when the site receives it directly.
A key is the first 16 hex digits of a SHA-256.

| Comment                             | `origin`                                                                       | Id, the key of                        |
| ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| A fediverse reply                   | The note, `source_id`                                                          | The origin                            |
| A fediverse like or boost           | The activity, `source_id`                                                      | The origin                            |
| A webmention, pingback or trackback | The page that linked here: `webmention_source_url`, or a pingback's author URL | The origin and the post's permalink   |
| A like or repost with no protocol   | `source_id`, such as a Bluesky `at://` URI                                     | The origin and the post's permalink   |
| A comment left on the page          | None                                                                           | `https://example.com/?p=ID#comment-N` |

A webmention sent again therefore matches the comment the site already
holds. So does a fediverse reply or reaction delivered again or read by the
site's reply backfill. It shows once, as the imported comment, and replies to
the note thread under it. A fediverse reply's `url` stays the note's web page.
A comment left on the page has a page of its own, `/comment/{key}/`.

A fediverse comment names its actor in `_activitypub_remote_actor_id`. That is
one of the export's `ap_actor` items, the ActivityPub plugin's cached copy of
the actor's profile. The import reads that profile and gives the comment its
`actor`, the actor's id, and its `author.avatar`, the actor's icon. The page
shows the icon through the site's avatar cache, so a like or a boost shows a
face. A like from the same actor delivered here after the move is counted with
the imported one. A comment whose actor is not in the export imports without
`actor` or `author.avatar`.

A comment written while signed in to WordPress names its writer in
`comment_user_id`. If that WordPress user's login matches a user on this site
(the same rule a post's author follows), the comment keeps that user as its
`user`. The thread then shows the comment as that user's, the same way it shows
their reply posts: their display name and avatar, and a link to their author
archive with no `rel="nofollow ugc"`. It stays an imported comment.

The import merges by comment id. A rerun adds the comments WordPress received
since and picks up comments edited there. It leaves unchanged a comment this
site received itself. It also leaves unchanged the words and status of an
imported comment that a moderator approved, filed as spam, edited or deleted.
It still marks such a comment migrated and gives it its origin, its user and
its actor.

A rerun also removes an imported comment that has left WordPress since the
last run: one that was deleted there, or moved to spam or the trash. The
WordPress ActivityPub plugin deletes a like or boost when its sender undoes
it, so this keeps reaction counts the same on both sites. The import removes a
comment only when it is still exactly as the import wrote it, compared with
the hash in `import.json`. Each removal is a `removed` row naming the post and
the WordPress comment id. A comment that was edited or moderated on this site
stays and is reported as `kept`. A comment this site received itself is never
removed. Comments recorded by an earlier version of the import have no
WordPress id in `import.json`, so their rows name the comment's key instead.

**Upgrading from 0.2.0.** Version 0.2.0 used each comment's WordPress URL as
its id. The site replaces every such id with the key of that URL when it next
boots, or when it next runs a plugin command. A rerun of the import then moves
each fediverse comment and webmention, in place, to the key of its origin. Any
reply here that names the comment moves with it. Each comment stays one
record. The
import's record of what it wrote, `import.json`, moves to the new keys, so the
rerun reports no clash.

### Redirects

Links from elsewhere use URL forms that WordPress answered and the site has
no document at. The import declares a redirect for each in its own file,
`_data/redirects/wordpress.json`. The site reads that file beside
`_data/redirects.json`, with or without the plugin enabled:

| URL                                         | Answers 301 at              |
| ------------------------------------------- | --------------------------- |
| `/?p=ID`, for every published post and page | Its permalink.              |
| `/?page_id=ID`, for every published page    | Its permalink.              |
| An attachment's page, such as `/photo-jpg/` | Its file under `/uploads/`. |
| `/?attachment_id=ID` and `/?p=ID`, likewise | Its file under `/uploads/`. |

The page WordPress used as its static front page is the exception. Its
`?p=` and `?page_id=` answer at `/`, where the site serves its homepage. The
page's own permalink redirects there too.

A draft, or a pending, private, password-protected or scheduled post or page,
gets no redirect. Its `?p=` answers the same as an id WordPress never had. An
attachment whose file was not copied gets no redirect either, until a run
copies the file. A post's old slugs and dates go into its own `redirect_from`,
as [Posts and pages](#posts-and-pages) says. A published post's `?p=` is also
its `activitypub.id`. The site answers that first, at the same permalink.

The import owns each key it set in `wordpress.json`, never the file. It never
touches `_data/redirects.json`. The import leaves a key that the site added or
changed unchanged on every rerun. If both files declare one URL,
`redirects.json` wins. A link to a comment, `#comment-N`, reaches the post,
because the browser never sends the fragment to the server. The post's anchors
are `#comment-{key}`, so the browser opens the post at the top.

## Bringing a person across

`geekity import wordpress-actor` imports one person. It writes the three
things the site cannot create for itself:

- the RSA key pair that the followers have cached
- the actor id that the followers use to identify the account
- the followers

It is a command and not a screen, because a stored actor id is the account's
identity for the life of the account.

```sh
geekity import wordpress-actor ada \
  --actor-id 'https://example.com/?author=2' \
  --wordpress-id 2 \
  --keypair ada.keypair.json
```

The command:

1. writes `data/keys/ada.rsassa-pkcs1-v1_5.jwk`, and creates the Ed25519 pair
   beside it, which WordPress never had
2. puts `actorId` on the user in `data/users.json` and the number in the
   plugin's `actors.json`
3. fetches the WordPress plugin's public followers collection into
   `content/_data/federation/ada/followers.json`. It dereferences each follower
   for its inbox, shared inbox, handle, name, avatar and profile URL. Each of
   those requests is signed with the imported RSA key under
   `<actor id>#main-key`, so servers that run Mastodon's authorized fetch
   answer it. The report lists a follower whose server refuses the signed
   request, and running the command again does not change that.

| Option                                        | What it is                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--actor-id <url>`                            | The id WordPress published, including the query string. The import cannot derive it.                                                                  |
| `--wordpress-id <n>`                          | The WordPress user id, which is the number in the plugin's paths.                                                                                     |
| `--keypair <file>`                            | The JSON the plugin's option holds: `{"private_key": …, "public_key": …}`.                                                                            |
| `--private-key <file>`, `--public-key <file>` | The two PEMs instead, for a site still on the legacy user meta. The public key is only checked against the private half. It is derived, never stored. |
| `--followers <url\|file\|none>`               | Where the followers come from. The default is the plugin's own collection on the actor id's origin.                                                   |
| `--force`                                     | Import over a key pair the user already has.                                                                                                          |

**Exporting the key pair with wp-cli.** The WordPress plugin stores a user's
pair in an option named after their login:

```sh
# On the WordPress server. The login, not the user id, is what names the option.
wp option get activitypub_keypair_for_ada --format=json > ada.keypair.json
```

An older site still on the plugin's legacy storage has the pair in user meta
instead, one PEM per key:

```sh
wp user meta get 2 magic_sig_private_key > ada.private.pem
wp user meta get 2 magic_sig_public_key  > ada.public.pem
```

The command accepts either export, and either PEM encoding:
`-----BEGIN PRIVATE KEY-----` (PKCS#8) or `-----BEGIN RSA PRIVATE KEY-----`
(PKCS#1). Treat the files like a password. Whoever holds the private key
controls the account.

You can save the followers before you shut down the old site, and pass the
saved file to `--followers`:

```sh
curl -H 'Accept: application/activity+json' \
  'https://example.com/wp-json/activitypub/1.0/actors/2/followers?page=1' > followers.json
```

**Running it twice changes nothing**, and the command says so. You can run it
again after an instance that was down comes back. A follower already in the
file keeps its place and its follow time. A follower whose server does not
answer is listed and skipped. The import does not fail.

The command refuses a user who already has a _different_ key pair. Importing
over it would change that person's identity, and every follower has cached the
public half of the existing key. `--force` overrides the refusal. Use it only
when you are certain the pair you import is the one the followers hold. The
command also refuses an actor id or a WordPress number that another user
already has, before it writes anything.

The cutover, end to end, is in
[Moving a site from the WordPress ActivityPub plugin](https://github.com/geekitycom/cms/blob/main/docs/federation.md#moving-a-site-from-the-wordpress-activitypub-plugin).

## The bundle

The package's build also writes `dist/bundle/index.js`, one module with its
dependencies inlined and the plugin as its default export. A site that runs
the Docker image has no `node_modules` of its own, so its plugins folder holds
this file (decision-33).
