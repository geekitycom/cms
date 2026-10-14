# Content

## Documents and files

A Markdown file and a `Document` convert both ways. The file is the source of
truth. Front-matter keys the CMS does not model survive an admin save.

```ts
import { parseDocument, serializeDocument } from '@geekity/cms';

const document = parseDocument(source, { path: 'posts/2026-09-02-hello.md' });
document.title; // 'Hello, World!'
document.html; // rendered with markdown-it

await writeFile(file, serializeDocument({ ...document, draft: false }));
```

`parseDocument` does four things:

- It reads the type from the directory (`posts/` or `pages/`).
- It fills in a default permalink when the file has none.
- It normalises dates to ISO 8601 strings.
- It hashes the document's canonical text.

`serializeDocument` writes front matter in a fixed key order. An unchanged
document writes the same bytes, and a real edit produces a small diff.

The admin form proposes a slug with `slugify(title)` and a permalink with
`defaultPermalink({ type, slug, date })`:

| Type | Default permalink      |
| ---- | ---------------------- |
| Post | `/{yyyy}/{mm}/{slug}/` |
| Page | `/{slug}/`             |

`renderMarkdown(body)` is markdown-it with Eleventy's `html: true`. It adds
footnotes, heading ids and a language class on fenced code.

The fixtures that this package and the Eleventy compatibility test both build
from are in `packages/cms/test/fixtures/content/`.

## Titles

A title is optional on a post and on a page. A file with no `title`, or with
`title: ''`, parses with an empty `document.title`. A post with no title is a
note. A page with no title suits a static homepage or a landing page with no
heading of its own. The editor saves either one. Without a title, it takes the
slug from the first words of the body.

**The label.** Where the site names an untitled document, it uses the
document's label, `postLabel(document)`. The label is the title, else the first
ten words of the text, else what a post with no words is (TASK-261), else
"Untitled". An untitled page gets the same label as an untitled post with the
same words.

**Where an untitled page is named.** A page with no title has no name of its
own. Its own heading and head print no name for it. Everything that links to it
or lists it uses its label.

| Where                                                                                                         | An untitled page shows                                   |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `<title>`, `og:title` and `twitter:title`                                                                     | The site title alone.                                    |
| The `h1` of `layouts/page.njk` and the `h2` of `layouts/front-page.njk`                                       | No heading.                                              |
| The JSON-LD `Article`                                                                                         | No `headline`.                                           |
| The Markdown representation (`index.md`)                                                                      | No `#` heading.                                          |
| The JSON representation (`index.json`)                                                                        | No `title` in `frontMatter`.                             |
| The posts page's heading, `<title>` and Markdown heading                                                      | The site title.                                          |
| The admin lists, the editor heading, the save and trash messages, and the homepage and posts page choices     | The label.                                               |
| Search results, `llms.txt`, backlinks, the comments feed and its link, oEmbed and the contact message records | The label.                                               |
| A menu item that points at the page                                                                           | The item's own label. A menu never reads a page's title. |

Micropub creates posts only. It refuses a page's URL on an update, so it never
creates or edits a page.

## Two directories: `content/` and `data/`

Every file a site cannot afford to lose is in one of two directories
(decision-9). Back up these two directories and carry them across a deploy.
Nothing else needs either.

`content/` holds what the site publishes. Keep it in git. An Eleventy build of
the same directory reads all of it, and everything in it is public.

| Path                                                 | What it holds                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `content/posts/`, `content/pages/`                   | The Markdown documents, `_trash/` included.                      |
| `content/uploads/`                                   | Uploaded files, with their location and camera metadata removed. |
| `content/_data/site.json`                            | Every site setting.                                              |
| `content/_data/media.json`                           | The media library's alt text, keyed by upload.                   |
| `content/_data/federation/{username}/followers.json` | Who follows that user.                                           |
| `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`   | Every activity the inbox received, one per line.                 |
| `content/_data/comments/{slug}.json`                 | Every comment left on that post, in every moderation state.      |

`data/` is private. It is gitignored. Copy it somewhere safe.

| Path                             | What it holds                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/users.json`                | Usernames and argon2id password hashes. Mode `0600`.                                                                                                |
| `data/keys/`                     | Each user's actor key pairs as JWK files. Mode `0600`. **Losing these breaks federation.**                                                          |
| `data/locations.json`            | Where each post was written, keyed by permalink. It is never in `content/`, so a public repository never holds it (decision-29). Mode `0600`.       |
| `data/kept-properties.json`      | The Micropub properties a post was sent that the site does not understand, such as an `itinerary`, keyed by permalink (decision-27). Mode `0600`.   |
| `data/comment-salt`              | The salt that hides commenters' IP addresses in the published comment files. Mode `0600`.                                                           |
| `data/comments/{slug}.json`      | The emails of that post's commenters, and whether each asked to hear about replies, keyed by comment id. Mode `0600`.                               |
| `data/akismet.json`              | The Akismet key, and the last `verify-key` result for it. Mode `0600`.                                                                              |
| `data/mail.json`                 | The mail credential: a Brevo API key, an SMTP connection, or both. Mode `0600`.                                                                     |
| `data/notification-secret`       | The secret that signs the one-click links in a notification. Mode `0600`. Losing it breaks every link already sent, and nothing else.               |
| `data/comment-optouts.json`      | The addresses that have unsubscribed from reply notices. Mode `0600`.                                                                               |
| `data/indieauth-tokens.json`     | A SHA-256 hash of each IndieAuth access and refresh token, with its user, app, scopes and expiry (decision-24). Mode `0600`.                        |
| `data/notification-digests.json` | When each user was last sent a digest. Mode `0600`. Losing it sends one digest early, and nothing else.                                             |
| `data/plugins/<package name>/`   | Each plugin's private folder. Its secret settings are in `secrets.json`, mode `0600`. The plugin decides what else goes there.                      |
| `data/plugin-changes.json`       | Who added, updated and removed which plugin on Admin > Plugins, and when. Mode `0600`.                                                              |
| `data/jobs.json`                 | The admin jobs: each one's state, progress and result, with the newest five ended jobs of each name. See [Admin jobs](configuration.md#admin-jobs). |
| `data/queue.sqlite`              | Deliveries, inbox activities and retries still waiting. Mode `0600`. See [The message queue](federation.md#the-message-queue).                      |

[Personal data](personal-data.md) lists the files that hold readers' data, and
how long each is kept.

Each file under `data/` has a declared class (decision-55). Core files are
declared in `packages/cms/src/files/data-files.ts`, and each settings namespace
declares its own file.

| Class       | Files                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kept        | The site cannot be rebuilt without it: every file in the table above apart from those below, `dev-mode.json` and `dev-mode.jsonl`.                                                          |
| credential  | Typed in again from another service: `mail.json`, `akismet.json` and each plugin's `secrets.json`.                                                                                          |
| rebuildable | Made again, fetched again or reset to a default: `geekity.db`, `images/`, `avatars/`, `maintenance.json`, `notification-digests.json`, `indieauth-activity.json` and `micropub-media.json`. |
| pending     | Work not done yet, tied to this host: `queue.sqlite` with its `-wal` and `-shm`.                                                                                                            |
| scratch     | Left by a write or a lock in flight: `*.tmp` and `*.lock` files.                                                                                                                            |

You may delete three things under `data/` while the site is stopped. Do not
delete anything else in either directory.

| Path              | What it is                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/geekity.db` | The SQLite cache, with its `-wal` and `-shm`. `geekity rebuild` deletes and rebuilds it.                                                                                                                                  |
| `data/images/`    | Image variants derived from `content/uploads/` (decision-10), with their `image.json` sidecars. Delete it with `rm -r`.                                                                                                   |
| `data/avatars/`   | Remote avatars served from `/_geekity/avatars/` (TASK-134). The server fetches and shrinks them, so a visitor's browser never contacts the server that hosts them. Delete it with `rm -r`. The server fetches them again. |

The next boot builds the database from the files with no manual step. A request
for a missing image variant derives it and serves it. `geekity rebuild` rebuilds
the database on demand. **Tools > Content index** in the admin rebuilds it
[without stopping the site](#rebuilding-the-index-from-the-admin). The images
have no command. Run `rm -r data/images`.

### What is in the database, and what a rebuild costs

Every table holds data that is either read back from the files or safe to lose.

| Table                                               | Where it comes back from                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `documents`, `document_tags`, `document_categories` | The boot scan of `content/`.                                            |
| `followers`, `ap_inbox`                             | `content/_data/federation/`, emptied and read back on every boot.       |
| `comments`                                          | `content/_data/comments/`, emptied and read back on every boot.         |
| `sessions`                                          | Nothing. Every signed-in user is signed out.                            |
| `ap_deliveries`                                     | Nothing. The federation screen shows its posts with "Nothing recorded." |
| `ap_relays`                                         | The relay list in `site.json`. Boot sends each relay a fresh `Follow`.  |
| `password_resets`                                   | Nothing. Every password reset link stops working.                       |
| `spent_tokens`                                      | Nothing. A one-click link that was already used works again.            |
| `cms_state`                                         | Nothing. The scheduler's watermark and its first run.                   |
| `migrations`, `admin_migrations`                    | The package. They record which schema versions have run.                |

A rebuild loses four things:

- **Logins.** Every signed-in user has to sign in again. The accounts are in
  `data/users.json`, and a rebuild does not touch them.
- **Whether a one-click link was used.** The server signs these links and does
  not store them, so they keep working. A rebuild forgets only which links were
  already used. Every action they perform is idempotent, so at worst a
  moderation link works a second time. The server does store password reset
  links, and those stop working.
- **Relay handshakes.** On boot, the server follows every relay in the settings
  that the database has no record of. A rebuild therefore sends every listed
  relay a new `Follow`, and loses the reason a relay gave for its last
  rejection. A relay that refuses the site gets a new request on each rebuild.
- **A scheduled post that came due while the site was down.** The scheduler
  treats a missing watermark as "start from here". Without that rule, a rebuilt
  database would re-announce the whole archive to every follower. Such a post is
  public on the next boot, but the server delivers no `Create` for it. If it
  should have gone out, resend it from `/admin/federation`.

The file-first design (decision-9) gives up one more thing. If a post's **file
is gone entirely**, the server can no longer withdraw it from followers'
timelines, because the permalink a `Delete` names was in the file. Trashing a
post in the admin keeps the file under `_trash/`, so the normal way to
unpublish a post still sends the `Delete`.

### A database this version will not open

The server refuses to boot in two cases. In both, the error names the file and
says what to do.

- **Written by a newer `@geekity/cms`.** Its migration ledger records a schema
  version this package does not ship. Usually the fix is to upgrade the package
  again. If the newer version was a mistake, `geekity rebuild` deletes the
  database.
- **Damaged.** SQLite cannot open it. Run `geekity rebuild`.

The server deletes and rebuilds without asking in one case: a database _older_
than the oldest migration the package still ships. No migration path exists
from it, and it holds only data read from the files.

## The content index

The Markdown files are the source of truth. SQLite is an index derived from
them, so you can delete `data/geekity.db` and the next boot rebuilds it. The two
federation indexes work the same way.
`content/_data/federation/{username}/followers.json` and
`content/_data/federation/inbox/{yyyy}-{mm}.jsonl` are the source. The server
empties the `followers` and `ap_inbox` tables and reads them back from those
files on every boot.

`createCms` opens the database in `dataDir`, creating the directory, and applies
the migrations the package ships. Migrations are versioned and recorded, so
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

A row converts back to the `Document` it came from. Optional fields stay absent
and do not become `undefined`. `extra` is stored as JSON, so any value JSON can
hold survives.

The index follows these rules:

- **Dates.** The index keeps `date` as the file has it, with its
  offset. Listings sort on a second column that holds the same instant in UTC.
  So `2026-06-01T09:00:00-05:00` sorts after `2026-06-01T12:00:00Z`. A document
  with no date sorts last. Ties sort by path, descending.
- **Trash.** A document under a `_trash/` directory is trashed. The flag comes
  from the path, not the front matter. To trash or restore a file, move it into
  or out of `_trash/`. `listPosts`, `listByTag` and `listByCategory` exclude
  drafts and trash. `listAll` shows drafts and hides trash, unless you pass
  `{ trashed: true }`.
- **Scheduling.** A non-draft document whose `date` has not arrived is not
  public yet, so every listing above excludes it. `listAll` shows it, and
  `{ scheduled: true }` shows only those documents. The index reads the clock
  through `store.now()`. `createCms` sets it from the `now` config option. The
  listings, the permalink and the scheduler all use this one clock, so they
  cannot disagree. The same clock stamps the operational records and the
  activities the site sends.
- **Permalinks** are unique and indexed. If you index a second document at a
  URL another file already uses, the store throws `DuplicatePermalinkError`,
  which names both paths.

## Keeping the index in step

Before it listens, `serve()` scans `contentDir`. It indexes every Markdown file
under `posts/` and `pages/` and drops index rows whose file is gone. After that,
a watcher keeps the index and the files in step. The index never serves a
document that differs from its file. An edit on disk reaches the live site in
about a second, with no restart. `cms.sync()` runs the same scan once, for
one-shot commands.

```ts
const result = await cms.sync();
// { scanned, created, updated, removed, unchanged, failed }
```

A scan parses every `.md` and `.markdown` file under a `posts/` or `pages/`
directory. It writes each file whose hash differs from the indexed row, and
drops rows whose file is gone. The watcher does the same for one path at a
time. It debounces changes by 100 ms, so a burst of writes causes one re-parse.

- **What is a document.** Only Markdown under `posts/` and `pages/`. The scan
  skips uploads, `posts.json`, `README.md` at the top level and every other
  file.
- **Underscore directories.** Eleventy ignores them, and so does the scan, with
  one exception. `_trash/` still holds documents. They stay indexed as trashed
  and out of every public listing, so the admin can restore them. The scan
  never indexes `_data/`, at any depth. `_data/site.json` holds the settings,
  and `_data/federation/` holds the followers and the inbox log. A theme and an
  Eleventy build read these as data, not as documents.
- **No-op writes.** A file rewritten with the same content has the same hash.
  The scan writes nothing to the index and emits no event. An admin save writes
  the file and updates the index itself, so it costs one index write, not two.
- **A file that does not parse** is logged and skipped. Its old row stays.
  Neither the scan nor the watcher stops.
- **Renames.** Trashing and restoring are renames. A rename briefly leaves two
  rows with one permalink. The row whose file is gone is dropped.

Each change emits an event that a site can act on. See
[Hooks](plugins.md#hooks).

To scan on boot and then stop, set `watch: false` (or `GEEKITY_WATCH=false`).
Use it on a host where the content cannot change while the process runs.
`geekity sync` sets it for you.

### Rebuilding the index from the admin

A scan skips a row when its hash matches the file. That rule fails when the
index and the files no longer match. For example:

- Content was edited over ssh while the site was down.
- A `git pull` ran that the watcher did not see.
- The database was restored from a backup older than the content.

**Tools > Content index** in the admin fixes this. It shows the documents,
followers, inbox activities and comments the index holds. One button empties
the index and reads every file again while the site runs.

The button has a confirm step. Between the emptying and the end of the scan,
the site answers 404 for documents whose files are fine. On a small site this
takes well under a second. On a large one it takes longer, and the site serves
requests the whole time. The server refuses a second rebuild while one is
running.

This rebuild deletes nothing and replaces no connection, so it costs much less
than `geekity rebuild`:

- You stay signed in.
- The delivery log, the relay handshakes and the scheduler's watermark are
  kept.
- A post that comes due during the rebuild is still announced.

It also notifies no one. Every change a scan makes carries `origin: 'scan'`.
Delivery, webmentions and feed pings all ignore those changes. No follower,
linked page or feed server hears about a post that was only re-indexed.

Use `geekity rebuild` at the command line for one case: a database this version
refuses to open. In that case no site is running, so the admin button is not
available. See
[Starting the database again](cli.md#starting-the-database-again) and
[A database this version will not open](#a-database-this-version-will-not-open).

## Dates and the timezone setting

Every date the CMS writes into a file is a UTC instant ending in `Z`. That
covers `date`, `updated` and `activitypub.published`. The `timezone` setting is
not stored with the date. The CMS uses it to display and read instants.

The setting applies in three places:

- **The editor** shows a stored instant as wall-clock time in the site's zone,
  and names the zone under the field (`Wall-clock time in America/Chicago
(CDT). Stored as UTC.`). It reads what you type in the same zone. In a site
  set to `America/Chicago`, type `2026-09-04 09:00` and the file gets
  `date: '2026-09-04T14:00:00Z'`. A value with its own offset, such as
  `2026-09-04T09:00:00+02:00`, already names an instant, and the editor keeps
  that instant.
- **The theme's `date` filter** renders `readable`, `html` and `year` in the
  site's zone. `iso` stays the UTC instant, because a `<time datetime>` and a
  feed need the instant. A change to the setting shows on every page at the
  next request. No file changes and no rebuild runs.
- **A new post's filename day and its `/{yyyy}/{mm}/` permalink** come from the
  calendar day in the site's zone at that instant. A post published at 00:30 on
  1 October in Berlin is filed under October, not under 30 September, the day
  it still was in UTC.

A later change to the setting never moves a URL. The CMS writes the permalink
into every file it saves. The day a post is filed under is the day in its
filename. The CMS sets that day once, when it writes the file, and the setting
does not change it.

Files written by hand keep working. The CMS reads a `date` with an offset, or
one that YAML parses as a timestamp, as the instant it names. It sorts and
schedules the post by that instant. It rewrites the date as UTC the next time
the CMS saves that file. A scan never rewrites it. A hand-written file with no
`permalink` still resolves to the URL Eleventy gives it, which Eleventy builds
from the date as the file writes it.

Feeds, the sitemap and the ActivityStreams objects emit instants, so the
setting does not affect them. A scheduled post publishes at its instant in every
zone setting.

## Scheduling

A post whose `date` is in the future is saved now and published at that date,
as in WordPress. Save it with Publish. The editor answers `Scheduled: {title}`
and shows when it goes out, in the site's `timezone` setting.

Until that date, the post is not public:

- It is not on the home page or any archive.
- It is not in any of the three feeds or the ActivityPub outbox.
- Its permalink returns 404 in every representation.
- No follower has been notified.

At that date, the running server publishes the post with no restart and no
build. The same delivery as a live publish sends the `Create` and pings the
notify server.

There is no `scheduled` key and no stored state. A scheduled post is an
ordinary published post whose date has not arrived. Every query checks the date
against the clock. As a result:

- Changing the date changes the publication time.
- Ticking Draft cancels the publication.
- Moving the date of a published post into the future withdraws it and sends
  the followers a `Delete`, the same as marking it a draft.

If a post's date passes while the server is down, the post is public as soon as
the next boot finishes its scan, and that boot federates it once. The CMS
records how far through the calendar it has published. A restart never
announces the same post twice, and a deleted database never announces the
archive.

The admin lists scheduled posts under their own Scheduled filter, with a
Scheduled status beside each one. The public permalink returns 404 for a
signed-in admin too.

Why: the public site has no session, on purpose. Every response it gives is
cacheable. A URL that answered differently for one viewer would be cached and
served to everyone else.

To see a scheduled post, use the editor's Preview button. It renders the post
through the theme's own layout at an admin URL.

## Unlisted posts

An unlisted post is published at its URL and left off every list. To make a
post unlisted, do one of these:

- Choose Unlisted in the editor's Visibility field.
- Send `visibility=unlisted` from a Micropub app.
- Write it into the front matter:

```yaml
visibility: unlisted
```

A post with no `visibility` key is public. When you choose Public again, the
editor removes the key. The site has no private posts.

Any other value, such as a hand-typed `visibility: private`, hides the post the
same way `draft: true` does:

- Its URL answers 404 to every visitor who is not signed in.
- It is on no list.
- If followers already have the post, the server withdraws it with a `Delete`.

The editor shows the value as stored and marks the post Hidden in the list. It
keeps the value through a save until you choose Public or Unlisted.

The same rules apply to pages.

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
| Webmentions                                                                | Sent as for any post, because the page is public.                                                                                            |

When a published post changes between public and unlisted, the server sends
its followers an `Update` with the new addressing.

In code, `isServed(document)` says whether the site serves a document at its
URL. `isListed(document)` says whether the site also lists it. The index
applies the same two rules in SQL. An Eleventy build with the example config
also reads the key. An unlisted post gets its page and `noindex`, and is in no
collection. An unrecognized value builds no page. See
[Building the same content with Eleventy](eleventy.md).

## The archive page

A page with `archive: true` in its front matter lists every published post
under the page's own text. Posts are grouped by the month they were published
in. The newest month is first, and the newest post is first inside each month.
The archive page has no pagination, because its purpose is to find one post,
not to read a listing. Drafts and posts whose date has not arrived are absent,
as everywhere else.

The default theme renders it from `partials/archive.njk`. The CMS passes the
layout `archiveMonths`, which is `{ month, posts }` per month. The month is
already converted to the site's `timezone`, so the heading and the dates agree.
Eleventy ignores the key. A static build of the same directory publishes the
page as an ordinary page.
