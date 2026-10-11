# Content

## Documents and files

A Markdown file and a `Document` convert both ways. The file is the source of
truth, so front-matter keys the CMS does not model survive an admin save:

```ts
import { parseDocument, serializeDocument } from '@geekity/cms';

const document = parseDocument(source, { path: 'posts/2026-09-02-hello.md' });
document.title; // 'Hello, World!'
document.html; // rendered with markdown-it

await writeFile(file, serializeDocument({ ...document, draft: false }));
```

`parseDocument` reads the type from the directory (`posts/` or `pages/`), fills
in a default permalink when the file has none, normalises dates to ISO 8601
strings and hashes the document's canonical text. `serializeDocument` writes
front matter in a fixed key order, so an unchanged document writes the same
bytes and a real edit produces a small diff.

`slugify(title)` and `defaultPermalink({ type, slug, date })` are what the admin
form proposes: `/{yyyy}/{mm}/{slug}/` for a post, `/{slug}/` for a page.
`renderMarkdown(body)` is markdown-it with Eleventy's `html: true`, plus
footnotes, heading ids and a language class on fenced code.

Fixtures that both this package and the Eleventy compatibility test build from
live in `packages/cms/test/fixtures/content/`.

## Two directories: `content/` and `data/`

Everything a site cannot afford to lose is a file, and every one of those files
is in one of two directories (decision-9). Nothing else needs backing up, and
nothing else needs carrying across a deploy.

`content/` is what the site publishes. It belongs in git, an Eleventy build of
the same directory reads all of it, and everything in it is meant to be public:

| Path                                                 | What it holds                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `content/posts/`, `content/pages/`                   | The Markdown documents, `_trash/` included.                              |
| `content/uploads/`                                   | Uploaded files, with their location and camera metadata removed.         |
| `content/_data/site.json`                            | Every site setting.                                                      |
| `content/_data/media.json`                           | The media library's alt text, keyed by upload.                           |
| `content/_data/federation/{username}/followers.json` | Who follows that user.                                                   |
| `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`   | Every activity the inbox was handed, one per line.                       |
| `content/_data/comments/{slug}.json`                 | The comments left on that post, whatever a moderator has done with them. |

`data/` is private. It is gitignored, and it is the half to copy somewhere safe:

| Path                             | What it holds                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/users.json`                | Usernames and argon2id password hashes. Mode `0600`.                                                                                              |
| `data/keys/`                     | Each user's actor key pairs as JWK files. Mode `0600`. **Losing these breaks federation.**                                                        |
| `data/locations.json`            | Where each post was written, keyed by permalink. Never in `content/`, so a public repository never carries it (decision-29). Mode `0600`.         |
| `data/kept-properties.json`      | The Micropub properties a post was sent that the site does not understand, such as an `itinerary`, keyed by permalink (decision-27). Mode `0600`. |
| `data/comment-salt`              | What hides commenters' addresses in the published comment files. Mode `0600`.                                                                     |
| `data/comments/{slug}.json`      | The emails of that post's commenters, and whether each asked to hear about replies, keyed by comment id. Mode `0600`.                             |
| `data/akismet.json`              | The Akismet key, and what `verify-key` last said about it. Mode `0600`.                                                                           |
| `data/mail.json`                 | The mail credential: a Brevo API key, an SMTP connection, or both. Mode `0600`.                                                                   |
| `data/notification-secret`       | What signs the one-click links in a notification. Mode `0600`. Losing it kills every link already in an inbox and nothing else.                   |
| `data/comment-optouts.json`      | The addresses that have unsubscribed from reply notices. Mode `0600`.                                                                             |
| `data/indieauth-tokens.json`     | A SHA-256 hash of each IndieAuth access and refresh token, with its user, app, scopes and expiry (decision-24). Mode `0600`.                      |
| `data/notification-digests.json` | When each user was last sent a digest. Mode `0600`. Losing it sends one digest early and nothing worse.                                           |
| `data/plugins/<package name>/`   | Each plugin's private folder. Its secret settings are in `secrets.json`, mode `0600`; the rest is the plugin's to say.                            |
| `data/plugin-changes.json`       | Who added, updated and removed which plugin on Admin > Plugins, and when. Mode `0600`.                                                            |

[Personal data](personal-data.md) lists the files that hold readers' data, and
how long each is kept.

Three things under `data/` may be deleted whenever the site is stopped, and
nothing else in either directory may:

| Path              | What it is                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/geekity.db` | The SQLite cache, with its `-wal` and `-shm`. `geekity rebuild` deletes and rebuilds it.                                                                                     |
| `data/images/`    | Image variants derived from `content/uploads/` (decision-10), with their `image.json` sidecars. `rm -r` it.                                                                  |
| `data/avatars/`   | Remote avatars served from `/_geekity/avatars/` (TASK-134), fetched and shrunk so a reader's browser never asks the server they live on. `rm -r` it; they are fetched again. |

The next boot builds the database out of the files with no manual step, and a
request for a variant that is not there derives it and serves it.
`geekity rebuild` does the database half on demand, and **Tools > Content
index** in the admin does it
[without stopping the site](#rebuilding-the-index-from-the-admin). There is no
command for the images, because there is nothing to do: `rm -r data/images`.

### What is in the database, and what a rebuild costs

No table holds anything that is not either read back from the files or
something a site is told it may lose:

| Table                                               | Where it comes back from                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `documents`, `document_tags`, `document_categories` | The boot scan of `content/`.                                                 |
| `followers`, `ap_inbox`                             | `content/_data/federation/`, emptied and read back on every boot.            |
| `comments`                                          | `content/_data/comments/`, emptied and read back on every boot.              |
| `sessions`                                          | Nothing. Everybody signed in is signed out.                                  |
| `ap_deliveries`                                     | Nothing. The federation screen shows its posts with "Nothing recorded."      |
| `ap_relays`                                         | The relay list in `site.json`: boot sends each of them a fresh `Follow`.     |
| `password_resets`, `spent_tokens`                   | Nothing. Every reset link and every one-click moderation link stops working. |
| `cms_state`                                         | Nothing. The scheduler's watermark and its first run.                        |
| `migrations`, `admin_migrations`                    | The package. They record which schema versions have run.                     |

So four things are actually lost:

- **Logins.** Everybody signed in has to sign in again. The accounts themselves
  are in `data/users.json` and are untouched.
- **Whether a one-click link had been used.** The links themselves are signed
  rather than stored, so they go on working; a rebuild only forgets which of
  them had already been spent. Every action they perform is idempotent, so the
  worst that costs is a moderation link that works a second time. A password
  reset link, which _is_ stored, stops working altogether.
- **Relay handshakes.** A relay named in the settings that the database has
  never heard of is followed on boot, so a rebuild sends every listed relay a
  new `Follow` and the reason one gave for rejecting the last is gone. A relay
  that refuses the site is asked again on each rebuild.
- **A scheduled post that came due while the site was down.** The scheduler
  treats an absent watermark as "start from here", so that a rebuilt database
  cannot re-announce the archive to every follower. Such a post is public on the
  next boot but no `Create` is delivered for it; resend it from
  `/admin/federation` if it should have gone out.

The one thing the file-first design (decision-9) gives up is narrower than any
of those: a post whose **file is gone entirely** can no longer be withdrawn
from followers' timelines, because the permalink a `Delete` names was in the
file. Trashing a post in the admin keeps the file under `_trash/`, so the
ordinary way of unpublishing still sends the `Delete`.

### A database this version will not open

Two cases refuse the boot rather than being cleaned up behind your back, and
both name the file and say what to do about it:

- **Written by a newer `@geekity/cms`**, meaning its migration ledger records a
  schema version this package does not ship. Upgrading the package back is
  usually what was meant; `geekity rebuild` throws it away if it was not.
- **Damaged**, meaning SQLite will not open it. `geekity rebuild` is the fix.

A database _older_ than the oldest migration the package still ships is the one
case thrown away and rebuilt without asking: there is by definition no path
forward from it, and nothing in it is anything but a reading of the files.

## The content index

Markdown files are the source of truth; SQLite is a derived index over them, so
deleting `data/geekity.db` is safe and the next boot rebuilds it. The same is
true of the two federation indexes:
`content/_data/federation/{username}/followers.json` and
`content/_data/federation/inbox/{yyyy}-{mm}.jsonl` are the source, and the
`followers` and `ap_inbox` tables are emptied and read back from them on every
boot.
`createCms` opens it against `dataDir` (creating the directory) and applies the
migrations the package ships. Migrations are versioned and recorded, so
applying them again does nothing.

```ts
const cms = createCms({ dataDir: 'data' });

cms.store.upsert(parseDocument(source, { path: 'posts/2026-09-02-hello.md' }));

cms.store.getByPermalink('/2026/09/hello/'); // the same Document back
cms.store.listPosts({ limit: 10, offset: 0 }); // published, newest first
cms.store.listByTag('eleventy', { type: 'post' });
cms.store.listByCategory('general'); // the second taxonomy, same shape
cms.store.listAll({ draft: true }); // the admin's view
cms.store.counts(); // { total, posts, pages, drafts, scheduled, trashed }
```

A row round-trips to the `Document` it came from: optional fields stay absent
rather than becoming `undefined`, and `extra` is stored as JSON, so anything
JSON can hold survives.

A few rules worth knowing:

- **Dates.** `date` is kept verbatim, offset and all, because that is what the
  file says. Listings sort on a second column holding the same instant in UTC,
  so `2026-06-01T09:00:00-05:00` correctly sorts after `2026-06-01T12:00:00Z`.
  A document with no date sorts last; ties break on path, descending.
- **Trash.** A document under a `_trash/` directory is trashed. The flag comes
  from the path, not from the front matter, so moving a file in or out of the
  trash is all it takes. `listPosts`, `listByTag` and `listByCategory` exclude
  drafts and trash;
  `listAll` shows drafts but hides trash unless asked with `{ trashed: true }`.
- **Scheduling.** A non-draft document whose `date` has not arrived is not
  public yet, so every listing above excludes it too; `listAll` shows it, and
  `{ scheduled: true }` shows only those. The index reads the clock through
  `store.now()`, which `createCms` gives it from the `now` config option — one
  clock, so the listings, the permalink and the scheduler cannot disagree.
- **Permalinks** are unique and indexed. Indexing a second document at a URL
  another file already claims throws `DuplicatePermalinkError`, which names
  both paths.

## Keeping the index in step

`serve()` scans `contentDir` before it listens, indexes every Markdown file
under `posts/` and `pages/`, and drops index rows whose file has gone. After
that a watcher keeps the two in step, so the index never serves a document the
files disagree with, and an edit on disk reaches the live site in about a
second without a restart. `cms.sync()` runs the same scan on its own, which is
what a one-shot command wants.

```ts
const result = await cms.sync();
// { scanned, created, updated, removed, unchanged, failed }
```

A scan parses every `.md` and `.markdown` file under a `posts/` or `pages/`
directory, writes the ones whose hash differs from the indexed row, and drops
rows whose file has gone. The watcher does the same for one path at a time,
debounced 100 ms so a burst of writes costs one re-parse.

- **What is a document.** Only Markdown under `posts/` and `pages/`. Uploads,
  `posts.json`, `README.md` at the top level and anything else is skipped.
- **Underscore directories.** Eleventy ignores them and so does the scan, with
  one exception: `_trash/` still holds documents, which stay indexed as trashed
  and out of every public listing so the admin can restore them. `_data/` is
  never indexed, however deep it goes — `_data/site.json` is the settings and
  `_data/federation/` is the followers and the inbox log, and all three are
  data a theme and an Eleventy build read rather than documents.
- **No-op writes.** A file rewritten with the same content hashes the same, so
  nothing is written to the index and no event is emitted. That is what makes
  an admin save — which writes the file and updates the index itself — cost
  one index write rather than two.
- **A file that will not parse** is logged and skipped. Its old row is left
  alone, and neither the scan nor the watcher stops.
- **Renames**, which is what trashing and restoring are, briefly leave two rows
  claiming one permalink. The row whose file is gone gives way.

Each change is announced as an event, which a site can act on; see
[Hooks](plugins.md#hooks).

Set `watch: false` (or `GEEKITY_WATCH=false`) to scan on boot and stop there,
for a host whose content cannot change under the process. `geekity sync` sets
it for you.

### Rebuilding the index from the admin

A scan leaves a row alone when its hash matches the file, which is the right
rule almost always and the wrong one after the index and the files have come
apart: content edited over ssh while the site was down, a `git pull` the
watcher never saw, a database that was restored from an older backup than the
content. **Tools > Content index** in the admin is the repair. It shows what
the index holds — documents, followers, inbox activities, comments — and one
button empties it and reads every file again, on the site as it is running.

It is behind a confirm step, because between the emptying and the end of the
scan the site answers 404 for documents whose files are perfectly fine: well
under a second on a small site, longer on a large one, and it is serving the
whole time. A second rebuild asked for while one is running is refused rather
than started.

Nothing is deleted and no connection is replaced, so the rebuild costs a site
much less than the command below: you stay signed in, the delivery log, the
relay handshakes and the scheduler's watermark are all kept, and a post that
comes due during it is still announced. It also tells nobody: every change a
scan makes carries `origin: 'scan'`, which delivery, the webmentions and the
feed pings all ignore, so no follower, no linked page and no feed server hears
about a post that was only re-indexed.

`geekity rebuild` at the command line stays for the one case a screen cannot
be the door for: a database this version refuses to open, where there is no
site running to press a button in. See
[Starting the database again](cli.md#starting-the-database-again) and
[A database this version will not open](#a-database-this-version-will-not-open).

## Dates and the timezone setting

Every date the CMS writes into a file — `date`, `updated` and
`activitypub.published` — is a UTC instant ending in `Z`. The `timezone`
setting is not stored with the date; it is the lens the instant is read
through.

That means one rule in three places:

- **The editor** shows a stored instant as the clock reads in the site's zone,
  with the zone named under the field (`Wall-clock time in America/Chicago
(CDT). Stored as UTC.`), and reads what you type back in the same zone. Type
  `2026-09-04 09:00` in a site set to `America/Chicago` and the file gets
  `date: '2026-09-04T14:00:00Z'`. A value you write with an offset of its own —
  `2026-09-04T09:00:00+02:00` — already names an instant, so it is kept as one.
- **The theme's `date` filter** renders `readable`, `html` and `year` in the
  site's zone; `iso` stays the instant, because that is what a `<time
datetime>` and a feed want. Changing the setting changes what every page
  shows on the very next request, with no file touched and no rebuild.
- **A new post's filename day and its `/{yyyy}/{mm}/` permalink** come from the
  calendar day the site's zone was on at that instant, so a post published at
  half past midnight on 1 October in Berlin is filed under October and not
  under the 30 September that UTC was still on.

Changing the setting later never moves a URL. The permalink is written
explicitly into every file the CMS saves, and the day a post is filed under is
the one in its filename — decided once, when it was written, where no setting
can reach it.

Files written by hand keep working. A `date` with an offset, or one YAML parses
into a timestamp by itself, is read for the instant it names, sorts and
schedules by that instant, and is rewritten as UTC the next time the CMS saves
that file — never by a mere scan. A hand-written file with no `permalink` still
resolves to the URL Eleventy gives it, which is cut from the date as the file
spells it.

Feeds, the sitemap and the ActivityStreams objects emit instants and are
unaffected by the setting, and a scheduled post fires at its instant whatever
the zone is set to.

## Scheduling

A post whose `date` is in the future is written now and published then, the way
WordPress schedules one. Save it with Publish; the editor answers `Scheduled:
{title}` and says when it goes out, in the site's `timezone` setting.

Until that moment the post is not public in any sense: it is off the home page,
off every archive, out of all three feeds and out of the ActivityPub outbox,
its permalink 404s in every representation, and no follower has been told about
it. When the moment comes the running server publishes it — no restart, no
build — and the same delivery that a live publish runs sends the
`Create` and pings the notify server.

There is no `scheduled` key and no state to keep: a scheduled post is an
ordinary published one whose date has not arrived, which is a question asked of
the clock on every query. So moving the date moves the publication, ticking
Draft cancels it, and a date pushed into the future withdraws a post that was
already out — with a `Delete` to the followers, exactly as drafting it would.

A post whose date passed while the server was down is public the moment the
next boot has scanned, and is federated once on that boot. The CMS remembers
how far through the calendar it has got, so a restart never announces the same
post twice and a deleted database never announces the archive.

The admin lists scheduled posts under their own Scheduled filter, with a
Scheduled status beside them. The public permalink 404s for a signed-in admin
too: the public site has no session, deliberately — every response it gives is
cacheable, and a URL that answered differently for one viewer would be cached
and served to the rest. Use the editor's Preview button, which renders the post
through the theme's own layout at an admin URL.

## Unlisted posts

An unlisted post is published at its URL and left off every list. Choose
Unlisted in the editor's Visibility field, send `visibility=unlisted` from a
Micropub app, or write it into the front matter:

```yaml
visibility: unlisted
```

Public is the key's absence, and the editor removes the key when you choose
Public again. The site has no private posts. A value other than `public` or
`unlisted`, such as a hand-typed `visibility: private`, hides the post the way
`draft: true` does: its URL answers 404 to anybody not signed in, it is on no
list, and a post the followers already hold is withdrawn with a `Delete`. The
editor shows the value as it is stored, marks the post Hidden in the list, and
keeps the value through a save until you choose Public or Unlisted.

The rule works for pages too.

| Where                                                                      | An unlisted post                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Its permalink, in every representation                                     | 200, with `X-Robots-Tag: noindex`. The default theme also prints `<meta name="robots" content="noindex">`.                                   |
| The home page, tag, category and author archives, the `archive: true` page | Absent, and not counted in a pager or a tag count.                                                                                           |
| Previous and next links under other posts, a front page's `newestPosts`    | Absent.                                                                                                                                      |
| Every RSS, Atom and JSON feed, and the site-wide comments feed             | Absent. Saving one pings no notify server. An unlisted reply post shown in a thread is still in that thread's comments feeds.                |
| The sitemap, search (HTML and JSON) and `llms.txt`                         | Absent.                                                                                                                                      |
| IndexNow                                                                   | Not submitted. A public post that becomes unlisted is submitted once, so a search engine reads the `noindex`.                                |
| The ActivityPub outbox and featured collection                             | Absent.                                                                                                                                      |
| Followers                                                                  | Get the `Create` and every `Update`, addressed `to` the followers with Public in `cc`, which Mastodon shows as unlisted. Relays get nothing. |
| Webmentions                                                                | Sent as for any post: the page is public.                                                                                                    |

Changing a published post between public and unlisted sends its followers an
`Update` with the new addressing.

In code, `isServed(document)` says whether the site serves a document at its
URL and `isListed(document)` whether it also lists it. The index answers the
same two rules in SQL. An Eleventy build with the example config reads the key
too: an unlisted post gets its page, `noindex`, and no place in any collection,
and an unrecognized value builds no page. See
[Building the same content with Eleventy](eleventy.md).

## The archive page

A page carrying `archive: true` in its front matter lists every published post
under its own words, grouped by the month it was published in, newest month
first and newest post first inside a month. Nothing paginates it: an archive
page is a way of finding one piece of writing rather than a listing to read
through. Drafts and posts whose date has not arrived are absent, as they are
everywhere else.

The default theme draws it from `partials/archive.njk`, and the CMS hands the
layout `archiveMonths` — `{ month, posts }` per month, the month already read
through the site's `timezone` so the heading and the dates agree. Eleventy
ignores the key, and a static build of the same directory publishes the page as
an ordinary page.
