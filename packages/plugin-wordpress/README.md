# @geekity/plugin-wordpress

A [Geekity CMS](../cms/README.md) plugin for a site that moved from the
WordPress ActivityPub plugin. It answers the old plugin's inbox and collection
paths until every follower's server has refetched the actor, records when each
path was last asked for, and adds two imports: `geekity import wordpress`,
which brings the content of a WordPress export across, and
`geekity import wordpress-actor`, which brings each person's key pair, actor id
and followers across.

A site born on the CMS never needs it. Stored actor ids, post object ids,
WebFinger aliases and the feed and archive layout are the site's own and are in
`@geekity/cms` (decision-14).

## Installing it

It works with every 0.x release of `@geekity/cms` from the one it was built
against, which its peer dependency names.

Add the package to the site and to `plugins` in its config:

```sh
pnpm add @geekity/plugin-wordpress
```

```ts
import { defineConfig } from '@geekity/cms';
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

Both imports work as soon as the plugin is installed. The
old paths, and the redirects from WordPress media URLs, are served only while
the plugin is enabled under `/admin/plugins`, and disabling it takes them away
on the next request, with nothing restarted.

The plugin keeps two files in `data/plugins/@geekity/plugin-wordpress/`:

| File            | What it holds                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actors.json`   | Each username and the number WordPress gave that person's actor, which the old paths are built from. Written by the import.                                                    |
| `requests.json` | When each old path was last asked for, per user, and when the shared inbox was. Losing it resets what the screen says.                                                         |
| `import.json`   | A hash of every file `geekity import wordpress` wrote, by path, and each `site.json` and `media.json` key it set. Losing it makes every imported file a clash on the next run. |

## The old paths

A follower's server still holds the WordPress plugin's endpoints, such as
`/wp-json/activitypub/1.0/actors/2/inbox`, the shared
`/wp-json/activitypub/1.0/inbox`, and the collections beside them. Those are
cache rather than identity: a follower's server replaces them the next time it
refetches the actor. So the site carries them for a while, and is meant to
stop.

While the plugin is enabled, those paths are real inbox routes,
signature-verified exactly as the site's own are, so an unsigned or badly
signed delivery is refused, plus GET routes for the actor, its outbox, its
followers and its following. What a peer reads back is always the canonical
document: the same `id`, the same key, and the _canonical_ inbox and
collections, so a follower refetching the actor at the old URL is the follower
that learns the new endpoints. A user with no number in `actors.json` is not
reachable through any of it.

Every one of those paths records the instant it was last asked for, and the
plugin's screen under Plugins, `/admin/plugins/@geekity/plugin-wordpress`,
lists each path with that instant, or _Never_. Once every follower's server has
refetched the actor, nothing asks any more, and the plugin can be disabled.

## Bringing the content across

`geekity import wordpress` reads the WXR file WordPress writes under Tools >
Export (or `wp export`) and writes what it holds into the content directory:

```sh
geekity import wordpress example.WordPress.2026-10-08.xml \
  --uploads ./wp-content/uploads \
  --origins https://staging.example.com
```

`--uploads` is a copy of the site's `wp-content/uploads` (an export carries
no files), and `--origins` names any other host the posts wrote media URLs
on, such as the staging host the site was built on, comma-separated. Both are
optional; see [Media](#media).

A file that is not a WordPress export is refused before anything is written,
with each problem named, and the command exits 1.

The command prints the totals, then one tab-separated row per item: its
outcome, post type, WordPress id, title, the file it went to, and why.

| Outcome     | What it means                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `written`   | The file is new, was changed on WordPress since the last run, or was removed here and is written again.  |
| `unchanged` | The file already holds what WordPress has.                                                               |
| `kept`      | The file was edited on this site and WordPress has not changed it since. The edit stays.                 |
| `conflict`  | The file was edited on this site and changed on WordPress too. The edit stays; the row gives both dates. |
| `clash`     | A file the import never wrote is at the path. It is left alone.                                          |
| `skipped`   | The item has no Geekity counterpart, such as a revision, a menu or the ActivityPub plugin's records.     |
| `warned`    | The item was imported, with something the operator should check.                                         |

**Run it as often as you like.** Two runs over one export leave the content
directory byte for byte as one run did, and a run over a newer export picks up
what was added or edited on WordPress since. The import never writes over a file
it did not write, and never deletes one, so a site can layer its own fixes on
top of an import. To take WordPress's side of a conflict, remove the file and
run the import again.

### Posts and pages

Each post becomes `posts/YYYY-MM-DD-slug.md`, dated by its local publish date,
and each page becomes `pages/slug.md`. The front matter keeps what readers,
feed readers and followers already know of it:

| Key           | Where it comes from                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `permalink`   | The URL WordPress served, from the export's link. A draft has none yet, so it gets the one the published posts' structure gives it; a page gets its parents' slugs.                              |
| `date`        | `post_date_gmt`. A draft WordPress never dated has none.                                                                                                                                         |
| `updated`     | `post_modified_gmt`, when it differs from the date.                                                                                                                                              |
| `tags`        | The post's tags, by name.                                                                                                                                                                        |
| `categories`  | The post's categories, by name.                                                                                                                                                                  |
| `draft`       | `true` for a draft, a pending post, and a private or password-protected one, which the report names. A scheduled post keeps its date and publishes then.                                         |
| `author`      | The WordPress login, when the site has a user by that name. A post by any other login has no author, and the report names it.                                                                    |
| `in-reply-to` | The URL an ActivityPub plugin reply block answers.                                                                                                                                               |
| `activitypub` | On a published post, `id` is `https://example.com/?p=ID`, the object id the ActivityPub plugin served. A post the plugin federated (`activitypub_status` is `federated`) also has `published`.   |
| `guid`        | The WordPress guid, when it is not the post's `?p=` address, so feed readers see no old post as new.                                                                                             |
| `migrated`    | `true` on everything but a scheduled post, so its arrival here, or a draft's publication later, sends nothing to anyone. A scheduled post publishes here as news, as it would have on WordPress. |

A post in the status format has no title, so it reads as a note. The page
WordPress served at the home URL becomes `homepage` in `_data/site.json`. The
import sets that key only while the site has not set it, or still holds what
the import last set.

The body becomes Markdown. Block comments go, a classic post's line breaks
become paragraphs as WordPress showed them, and a YouTube or Vimeo iframe or
embed becomes the video's URL on a line of its own, which the site plays.
What Markdown cannot say stays HTML: other iframes, a figure with a caption, a
table with spans, and an element carrying a `style` or microformats class.
`<!--more-->` stays where it was. Media URLs point at the files under
`/uploads/`, as [Media](#media) describes.

### Media

Each attachment's original is copied from `--uploads` into `content/uploads/`
at the path WordPress kept it under, such as `uploads/2024/03/photo.png`.
WordPress's size variants (`photo-1024x575.png`, `photo-scaled.png`) are not
copied: the site makes its own. A file a post or page shows that is no
attachment is copied too, for that post.

Every media URL in a body, in Markdown and in the HTML it keeps, on the
export's own origin, on an `--origins` host, or root-relative, becomes a
root-relative `/uploads/` URL of the original. One pointing at a size variant
points at its original. An upload URL on any other host is left alone.

Each file is held to the rules an upload through the editor is: the site's
allowed types and size limits, and location and camera details removed. A
file the site would refuse is not copied. The report names it, and names
each file missing from `--uploads`. Without `--uploads` nothing is copied and
the report names each attachment.

An attachment's alt text (`_wp_attachment_image_alt`) goes to
`_data/media.json` under its upload path, which is where the editor offers it
from. The import owns each key it set there, never the file.

While the plugin is enabled, a request for `/wp-content/uploads/<path>`
answers 301 at `/uploads/<path>`, so links from elsewhere still land on the
file. A size variant the import did not copy lands on its original, as
`import.json` records it, and the query string is kept. No `redirects.json`
entry is written per file. Keep the plugin enabled for as long as links to the
old media URLs matter.

### Comments and reactions

Every comment WordPress kept on a post or page the import writes goes into the
post's comment file, `_data/comments/<slug>.json`, the file the site's own
comments go to. That covers form comments, and the likes, reposts, replies,
mentions, bookmarks and pingbacks the ActivityPub and Webmention plugins stored
as comments. Each lands under the post as one the site received itself would:

| WordPress                                                 | Here                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `comment`, `like`, `repost` with `protocol` `activitypub` | A fediverse reply, like or boost, linked to the remote post.   |
| `comment`, `like`, `repost` with `protocol` `webmention`  | A webmention reply, like or repost, linked to its source page. |
| `mention`, `bookmark`, `webmention`                       | A mention, linked to the page that linked here.                |
| `pingback`, `trackback`                                   | A mention, linked to the page that pinged.                     |
| `comment` with no protocol                                | A comment left on the page.                                    |

A reply keeps the comment it answers. An approved comment is approved here,
and one WordPress held for moderation waits here too. Spam and trash are left
out and named in the report. Each comment keeps the id WordPress's comments
feed gave it, `https://example.com/?p=ID#comment-N`, so a feed reader sees
nothing it has not seen. A commenter's email goes only to `data/comments/`.
Nothing is announced: no moderator is emailed and nothing is delivered.

The import merges by comment id. A rerun adds the comments WordPress received
since and picks up one edited there. It leaves alone a comment this site
received itself, and an imported one a moderator approved, filed as spam,
edited or deleted.

## Bringing a person across

`geekity import wordpress-actor` brings one person across. It writes the three
things the site cannot mint for itself, the RSA key pair the followers have
cached, the actor id they key the account by, and the followers, and it is a
command rather than a screen because a stored actor id is identity for the life
of the account.

```sh
geekity import wordpress-actor ada \
  --actor-id 'https://example.com/?author=2' \
  --wordpress-id 2 \
  --keypair ada.keypair.json
```

It writes `data/keys/ada.rsassa-pkcs1-v1_5.jwk` (and mints the Ed25519 pair
beside it, which WordPress never had), puts `actorId` on the user in
`data/users.json` and the number in the plugin's `actors.json`, and fetches the
WordPress plugin's public followers collection into
`content/_data/federation/ada/followers.json`, dereferencing each follower for
its inbox, shared inbox, handle, name, avatar and profile URL.

| Option                                        | What it is                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--actor-id <url>`                            | The id WordPress published, query string and all. The one thing the import cannot work out for itself.                                                |
| `--wordpress-id <n>`                          | The WordPress user id, which is the number in the plugin's paths.                                                                                     |
| `--keypair <file>`                            | The JSON the plugin's option holds: `{"private_key": …, "public_key": …}`.                                                                            |
| `--private-key <file>`, `--public-key <file>` | The two PEMs instead, for a site still on the legacy user meta. The public key is only checked against the private half; it is derived, never stored. |
| `--followers <url\|file\|none>`               | Where the followers come from. Left off, the plugin's own collection on the actor id's origin.                                                        |
| `--force`                                     | Import over a key pair the user already has.                                                                                                          |

**Exporting the key pair with wp-cli.** The WordPress plugin keeps a user's
pair in an option named after their login:

```sh
# On the WordPress server. The login, not the user id, is what names the option.
wp option get activitypub_keypair_for_ada --format=json > ada.keypair.json
```

A site old enough to still be on the plugin's legacy storage has the pair in
user meta instead, one PEM per key:

```sh
wp user meta get 2 magic_sig_private_key > ada.private.pem
wp user meta get 2 magic_sig_public_key  > ada.public.pem
```

Either export is accepted, and either PEM encoding, `-----BEGIN PRIVATE
KEY-----` (PKCS#8) or `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1). Treat the
files the way you would treat a password: the private key is the account.

The followers can be saved before the old site goes away, and the saved file
passed to `--followers`:

```sh
curl -H 'Accept: application/activity+json' \
  'https://example.com/wp-json/activitypub/1.0/actors/2/followers?page=1' > followers.json
```

**Running it twice changes nothing**, and says so, which is what makes it safe
to run again after an instance that was down comes back: a follower already in
the file keeps its place and its follow time. A follower whose server will not
answer is listed and skipped rather than failing the import. A user who already
has a _different_ key pair is refused: importing over one would change that
person's identity, and every follower has cached the public half of the key
that is there. `--force` is the way past that, and is only right when you are
certain the pair being imported is the one the followers hold. An actor id or a
WordPress number another user already carries is refused too, before anything
is written.

The cutover, end to end, is in the `@geekity/cms` README under _Moving a site
from the WordPress ActivityPub plugin_.

## The bundle

The package's build also writes `dist/bundle/index.js`, one module with its
dependencies inlined and the plugin as its default export. It is what a
plugins folder holds on a site that runs the Docker image, which has no
`node_modules` of its own (decision-33).
