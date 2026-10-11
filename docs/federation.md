# Federation

**Every user is an ActivityPub actor**, served by [Fedify] at their author URL:
`{baseUrl}/author/{username}/` is the archive in a browser and the `Person` to
a peer asking for `application/activity+json`, exactly as a post's permalink is
its page and its object. The collections are that URL's children —
`inbox/`, `outbox/`, `followers/` and `following/` — and the instance-wide
shared inbox is `/inbox/`. `author` and `inbox` are reserved top-level paths
for that reason: an actor id a settings field could move would be a different
account to everybody holding it.

There is no site actor. A post is announced by the actor of the user its
`author` names, its `outbox` is that user's archive as activities, and its
followers are that user's own.

Fedify's stores have defaults that suit a single process, and `federation` is
where a site that has outgrown them says so:

| Field                 | Default                 | Meaning                                                                                                                                        |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv`                  | `MemoryKvStore`         | Fedify's cache and idempotence store. Nothing that has to survive a restart lives in it.                                                       |
| `queue`               | `InProcessMessageQueue` | The delivery and inbox queue. `null` means no queue: activities are handled and delivered inside the request that carried them, with no retry. |
| `allowPrivateAddress` | `false`                 | Whether Fedify may fetch private and loopback addresses. Leave it off: turning it on removes an SSRF guard. It exists for tests.               |

Followers and the log of what the inbox was told are the CMS's own, and they
are files the site publishes (decision-9):
`content/_data/federation/{username}/followers.json` holds one object per
follower of that user — actor id, inbox, shared inbox, handle, name, icon,
profile URL and follow time, oldest follow first — and
`content/_data/federation/inbox/{yyyy}-{mm}.jsonl` holds one compact JSON-LD
activity per line, with the `receivedAt` the log stamped it with and the
`recipient` it was addressed to in front of it. The log stays one chronological
record because it is a record of what this server was told; each line says
whose it was. Both are in git beside the posts, and an Eleventy build of the
same content directory sees them as `federation.{username}.followers` and
`federation.inbox`. A `Follow` appends to the first, an `Undo(Follow)` or an
actor's own `Delete` takes the entry out, and a like, a boost or a reply
appends a line to the second; each write updates the SQLite index in the same
step, behind a lock on the file, so the two can never disagree. The `followers` and `ap_inbox` tables are that
index and nothing more: every boot empties them and reads them back from the
files, which is what makes editing `followers.json` by hand and restarting a
supported thing to do, and what makes deleting the database cost a site
nothing. `cms.admin.replaceFollowers` and `replaceInboxActivities` are what the
rebuild calls; `rebuildFederationIndexes({ admin, contentDir })` is the rebuild
itself. The delivery outcomes stay in SQLite as a cache of what happened; the
activities themselves are not stored at all, because they are rebuilt from the
posts' files whenever they are wanted again.

Each user's key pairs are the CMS's own too, but they are the one
thing a site can never regenerate, so they live in files: one JWK per algorithm
per user under `dataDir/keys` (`ada.rsassa-pkcs1-v1_5.jwk` and
`ada.ed25519.jwk`), written `0600` in a `0700` directory, each holding the
private key alone because the public half is derived from it. They are
generated on the first request that needs them and read back on every one after
that. The actor publishes the RSA key as `publicKey` at `{actor}#main-key`,
which is what a peer verifies an HTTP Signature with, and both as
`assertionMethod` multikeys at `{actor}#multikey-0` and `#multikey-1`.

A key file that is there and will not import stops the boot, with a message
naming it. That is deliberate: replacing it would give the site a new identity
and every follower's cached public key would stop verifying, and Fedify's own
answer — an actor document with no `publicKey` at all — is worse still, because
peers cache it. Restore the file from a backup, or delete it to ask for a new
key on purpose.

## Delivery

Publishing federates. The delivery service listens to the index, so a post
edited on disk reaches the followers exactly as one saved through the editor
does:

| What happened to the post                                                 | What the followers get    |
| ------------------------------------------------------------------------- | ------------------------- |
| became published — written live, or undrafted, or restored from the trash | `Create` of its object    |
| edited while published                                                    | `Update` of its object    |
| drafted, trashed, or its file deleted                                     | `Delete` of a `Tombstone` |

Nothing is delivered for a full scan, the boot scan included: a rebuilt index
reports the whole archive as new, and announcing it again is not what deleting
`data/geekity.db` should mean.

A post's ActivityStreams object id is its permalink, absolute on the site's
base URL. One URL answers both audiences — a browser gets the page, a peer
asking for `application/activity+json` gets the post's object — so a shared
link, a feed item, an object id and a reply's `inReplyTo` all name the same
thing. Nothing else has to be minted or kept in step.

That object is a `Note` or an `Article`, whichever the post's discovered type
is: a post with no title, or whose text opens with its title, is a `Note`, and
any other is an `Article`. Mastodon shows the two differently. An `Article`
arrives as its title, its excerpt and a link, so it sends `name` and a
`summary`. A `Note` arrives as its `content` and nothing else, and Mastodon
would show a `summary` as a content warning, so a note sends neither and puts a
title its text does not open with at the top of its content.

Both carry their text twice: `content` as it always was, and `contentMap` keyed
by the post's language, with `summaryMap` beside an `Article`'s `summary`. The
language is the post's `lang` front matter when it names one, and the site's
`language` otherwise, so a client can filter and translate by it. Mastodon
reads a status's language from that key.

An author can choose the type for one post in its front matter:

```yaml
activitypub:
  type: Note
```

`Note` and `Article` are the two values. Anything else is logged as a warning
and the derived type is sent instead. The CMS never rewrites the key. Changing
it on a post already announced sends an `Update`, but a remote server may keep
showing the post the way it first arrived.

The first activity about a post writes one key, `activitypub.published`, into
its front matter: the record that the post has been announced and when, which
is what decides `Create` against `Update` and what a resend reads. Restoring a
trashed post reuses it too.

A post whose file already names an `activitypub.id` keeps it as its object id
for the life of the post — that is how a post migrated from WordPress keeps the
`https://example.com/?p=813` its followers, its replies and its RSS subscribers
already hold. The CMS serves the post's object at that URL on an ActivityStreams
request, redirects a browser from it to the permalink, and names it in every
`Update` and `Delete`.

The CMS writes one itself in one case: when a published post's slug or
permalink is changed in the editor. A fediverse server cannot rename an object
it holds, so the URL the post is leaving becomes its stored `activitypub.id`.
Followers get an `Update` of the object they already have, a peer at the old
URL still gets the object, and a browser there is redirected to the new
permalink. The object's `url` is the new permalink. See
[Moved URLs](public-site.md#moved-urls).

One POST serves a whole instance — the shared inbox is preferred — but the
outcome is recorded per recipient, so an admin can see which one did not get it
and send the post again:

```ts
const report = await cms.delivery.resend(slug);
report?.deliveries; // one row per follower and relay: inbox, status, error, time
```

`resend` is "send this post as it now reads", not "send that activity again":
the activity is built from the file at the moment it is called, so a follower
whose server was down ends up with the post as it stands. Which activity that
is follows the same table as a save — a published post nobody has been told
about is a `Create` and is stamped, a published post they hold is an `Update`
under a fresh id, a draft or a trashed one is a `Delete` of a `Tombstone` — and
`undefined` comes back when there is no post by that name and nothing to
withdraw.

Nothing else is stored. What SQLite keeps about anything the site has sent is
one outcome row per recipient — the activity's id, type, object id and slug,
the inbox used, how it went, why not, and when — and that is a cache which may
be empty. `cms.admin.lastDeliveryToObject(objectId)` is the newest outcome
about one post, and `listDeliveries(activityId)` and
`countDeliveriesByStatus(activityId)` say how one activity landed with each
recipient. A status is `sent` (the inbox took it), `queued` (handed to Fedify's
queue, which retries out of band) or `failed`.

The one capability given up is tombstoning a post whose file is gone entirely
rather than in the trash: there is no file left to build the `Tombstone` from.

## Quote posts

Mastodon 4.5 lets people quote a post only when the post says who may, and
shows a quote only once the quoted author's server has approved it
([FEP-044f]). Every post this site federates is public, so every `Note` and
`Article` carries `interactionPolicy.canQuote` with `automaticApproval` set to
the public collection: anybody may quote it, and nobody has to approve it by
hand. Pages, drafts, scheduled and trashed posts do not federate, so nobody
can quote them.

A quoting server sends a `QuoteRequest` to the post's author. The inbox, and
any plugin inbox that hands its deliveries to the site's own handlers, answers
it:

- For a post the site federates, whose quote lives on the requester's own
  server, it stores an approval and replies `Accept` with a
  `QuoteAuthorization` as its `result`. The authorization names the quote
  (`interactingObject`), the post (`interactionTarget`) and the author
  (`attributedTo`).
- For anything else it replies `Reject` and stores nothing.

Approvals are files, like followers:
`content/_data/federation/{username}/quotes.json` holds one object per quote of
that user's posts. Each is served unsigned, as ActivityStreams JSON, at
`{baseUrl}/author/{username}/quotes/{id}/`, for as long as the post is still
published. An `Undo` of the `QuoteRequest`, or a `Delete` of the quoting post,
removes the approval, and its URL answers 404 after that. A quote does not
notify the author.

Mastodon keeps the copy of a post it fetched first, so a post federated before
the quote policy existed is not quotable until its followers receive an
`Update`. Editing the post sends one. To update every announced post at once,
run `geekity resend --all` in the site directory:

```sh
$ geekity resend --all
hello-world: Update to 3 of 3 inboxes
another-post: Update to 3 of 3 inboxes
```

`geekity resend <slug>...` does the same for named posts. Each is what the
Resend button on the federation screen does: an `Update` for a post still
published, a `Delete` for one that has been withdrawn, and a `Create` for a
published post that was never announced. `--all` only reaches posts that were
announced. The command delivers with no queue, so every activity has been
posted before it exits, and it exits non-zero when a named slug has nothing to
resend. It works while the server runs, because both read the same files and
database.

[FEP-044f]: https://codeberg.org/fediverse/fep/src/branch/main/fep/044f/fep-044f.md

## Replies to fediverse replies

Somebody who answers a fediverse reply on one of the site's posts addresses
the person they answer, not the site, so their reply never reaches the inbox.
Most servers list a note's replies in its `replies` collection, and the site
reads those collections to bring such replies in. The sweep starts when
the site serves and runs every hour, within these limits:

| Limit    | Value    | Meaning                                                                                               |
| -------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Interval | 6 hours  | How long a thread is left alone after it was read.                                                    |
| Age      | 30 days  | How old a post gets before its thread is no longer read, by the post's date.                          |
| Depth    | 4 levels | How far below the post a fediverse reply may sit and still have its collection read.                  |
| Pages    | 3        | How many pages of one collection are read. Mastodon's first page holds the author's own replies only. |

Every request is signed as the site's first account, as the actor profile
fetches are. A reply is kept only when it answers the note whose collection
listed it, is addressed to the public, and is written by an actor on the
note's own server. A note on the site's own origin is never fetched, because
the site already knows what it published.

A reply found this way is logged as the `Create` nobody delivered: a line in
`content/_data/federation/inbox/{yyyy}-{mm}.jsonl` with `"fetched": true` in
front of it, an `actor` taken from the note's `attributedTo` and the id
`{note id}#fetched`. From there it is a reply like any other. It is threaded
under the reply it answers with its own URL, counted, given a `/replies/` feed
and listed on the federation screen, and its author's `Delete` takes it back.
A note held once is never logged twice. The sweep skips a note the inbox
already holds or the site holds as a [migrated comment](comments.md#migrated-comments),
and a delivery of a note the sweep fetched first replaces the fetched line. An
imported fediverse reply's collection is read by its note id, its `origin`.

The site removes a fetched reply, with the fetched replies under it, when its
server answers 404 or 410 for it, or when a collection read to its end no
longer lists it. A delivered reply is never removed this way. A note with no
`replies` collection, a server that answers with any other error, and a
collection cut off by the page limit change nothing. The thread keeps what it
holds, and the sweep goes on to the next reply.

The site reads `replies` and not the conversation a note names in `context`
([FEP-7888]), because Mastodon publishes `replies` and few servers publish a
`context` collection yet.

[FEP-7888]: https://codeberg.org/fediverse/fep/src/branch/main/fep/7888/fep-7888.md

## Relays

A [Mastodon-style relay][fepae0c] boosts every public activity it is sent on to
the instances subscribed to it, which is how a site nobody follows yet reaches
people. `relays` is the setting: one relay inbox per line on
`/admin/federation/settings`, kept in `site.json` like every other setting, and
`https://tags.pub/user/_____relay_____/inbox` is one worth knowing about — it
boosts any public post carrying a hashtag it tracks, which every `Article` this
CMS builds already carries one of per tag and per category.

Adding a line sends that inbox a `Follow` whose object is the ActivityStreams
Public collection, signed by the site's first account — a relay subscription is
an instance-wide agreement rather than one person's, and the first account is
the one actor that can be chosen without asking — and carrying the Linked Data
signature a Mastodon-style relay verifies. The relay answers `Accept` or
`Reject` — possibly days later, because a subscription may need a human to
approve it — and that answer arrives in the site's inbox and moves the
subscription. Removing the line sends `Undo` of the same `Follow`.

Only an accepted relay is delivered to. From there it is one more inbox in the
fan-out: every `Create`, `Update` and `Delete` for a post, whoever wrote it,
and the actor `Update` a profile change sends, goes to it as well as to the
author's followers, its
outcome recorded in the delivery log against its actor id and its inbox exactly
as a follower's is — which is why Resend reaches relays too.

```ts
cms.admin.listRelays(); // inbox, actor, state, reason, follow id, times
cms.relays.sync(); // reconcile the records with the setting
await cms.relays.retry(inboxId); // send the follow again
```

The records live in `ap_relays`, keyed by inbox, and are operational state
rather than a source: the setting is. A relay the settings name that has no
record — a rebuilt database, a restored content directory — is followed again
on the next boot.

[fepae0c]: https://w3id.org/fep/ae0c

## A user's profile

An actor's `name`, `summary`, `icon` and `attachment` are the display name, the
bio, the avatar and the links on their user record, edited on
`/admin/users/<id>` and stored in `data/users.json` — the same profile the
author archive is headed with, so a page and an actor cannot say different
things about somebody. Their `preferredUsername` is their login, and
`alsoKnownAs` lists every URL they answer to: the actor id, the archive and
`/@{username}`. The profile holds two more fields the actor does not carry — a
job title and a location — which are there for a theme to print beside the
name.

The avatar is a path like `/uploads/2026/09/me.png`, stored with the site's
other uploads. The actor carries it as an absolute URL resolved against the
base URL in effect, because a peer has no site to resolve a path against; one
that is already an absolute URL is left alone, which is how a profile picture
goes on a CDN.

Saving a profile delivers an `Update` of that user's actor to their followers,
so the profile a peer cached is refreshed rather than left showing last year's
picture. Nothing on the settings screen does: the site is not an actor.
`cms.delivery.updateActor(user)` sends one from code. Its outcome is recorded
like every other activity's, with the actor's id as its object and no slug, so
it is not a row in the federation screen's per-post delivery table, which is
built from the posts the content index holds.

## WebFinger

`/.well-known/webfinger` is the CMS's own route rather than Fedify's, because
Fedify computes its `self` link and its `aliases` from the dispatcher path and
neither can be added to. It answers for every spelling of the same person — the
`acct:{username}@{host}` handle, the bare `{username}@{host}`, the author URL,
`/@{username}` and the stored actor id of somebody who has one — with the actor
id as `self`, the archive as `profile-page`, and all of the person's URLs as
`aliases`. A username nobody has is a 404. `/@{username}` itself is a 301 to
the archive of the user of exactly that name, and a 404 for a handle nobody
answers to: it is an alias of somebody, so a handle that is not anybody's is
nowhere rather than a redirect to an archive that does not exist either.

## A user's stored actor id

A user record in `data/users.json` may carry an `actorId`: the ActivityStreams
id that person was published under somewhere else, such as the
`https://example.com/?author=2` the WordPress ActivityPub plugin publishes.
That is identity, not cache — a follower's server keys the account by the URL
it first saw — so the CMS serves the person under it for the life of the
account, the way a post keeps its `activitypub.id`:

```json
{ "id": 2, "username": "ada", "actorId": "https://example.com/?author=2" }
```

The actor document's `id` is then that URL and its keys hang off it
(`…?author=2#main-key`), every activity the user sends names it as `actor` and
is signed with a key id under it, and the URL itself — query string and all —
answers with the `Person` for a peer and a 301 to the author archive for a
browser. WebFinger publishes it as `self` and resolves a lookup by it, and the
actor lists it in `alsoKnownAs` beside the archive and `/@{username}`. Nothing
else moves: `url` is still the archive and the collections are still the
archive's children, because a peer refetches those.

The CMS never mints one and no screen writes one. It arrives with a plugin's
import, such as the WordPress plugin's, or is typed into the file by hand; `/admin/users/<id>` shows it
read-only beside the account, and a value that is not an absolute URL is
ignored.

## Moving a site from the WordPress ActivityPub plugin

A site that moved here from the WordPress ActivityPub plugin keeps its people's
actor ids and its posts' object ids, which are identity and are the CMS's own
(above). What it needs besides is its content, the plugin's old paths, which
followers' servers keep delivering to until they refetch the actor, and an
import that brings each person's key pair and followers across. All three are the
[`@geekity/plugin-wordpress`](../packages/plugin-wordpress/README.md) package, which a
site born on the CMS never installs. decision-14's switch is that plugin now:
where the cutover used to say "turn the switch on", it says install and enable
the WordPress plugin.

### The cutover, end to end

1. **Start the new site in dev mode.** Set `GEEKITY_DEV_MODE=true` before
   its first boot (see [Dev mode](deploying.md#dev-mode)). Followers, relays, links and
   mail are all real from here on, and dev mode keeps every one of them from
   hearing about the import, the edits or a scheduled post until step 4.
2. **Export, while the WordPress site is still up.** Each person's key pair,
   and the followers if the old site is going away before the import runs. The
   plugin's README says how. Note the actor id and the numeric actor id off
   `https://example.com/?author=2`, take a WXR export under Tools > Export,
   and copy `wp-content/uploads`, which the export does not carry.
3. **Install the WordPress plugin and import.** Add `@geekity/plugin-wordpress`
   to the site's dependencies and to `plugins` in its config, then run
   `geekity import wordpress example.WordPress.xml --uploads wp-content/uploads`
   for the content and media, and
   `geekity import wordpress-actor ada --actor-id … --wordpress-id … --keypair ada.keypair.json`
   for each person. Both work before the plugin is enabled. Check the reports:
   every post should be written, every conflict or clash resolved, every
   follower added, and any follower that was skipped re-run once its server
   answers. Tools > Dev mode shows that the imports sent nothing. Both imports
   are safe to run again: run them over a fresh export just before step 4 to
   pick up what WordPress received in the meantime.
4. **Enable the WordPress plugin, move the DNS and go live.** Enable it under
   `/admin/plugins`, then move the DNS. Remove `GEEKITY_DEV_MODE` and run
   `geekity dev-mode off`: nothing held during the migration is sent.
   Followers' servers go on delivering to the plugin's old inbox paths until
   they next refetch the actor, and the plugin is what catches those
   deliveries. Once WordPress no longer answers, run both imports one last time
   over its final export: they merge what arrived between the export and the
   DNS move, and leave alone whatever this site wrote or edited since.
5. **Watch.** `/admin/federation` lists the users with their actor ids and
   followers; the plugin's own screen under Plugins lists each old path with
   the instant it was last asked for. Deliveries should thin out as each
   follower's server refetches the actor and learns the new endpoints.
6. **Disable it.** Once every path says _Never_ again for long enough — weeks
   rather than days, since a quiet instance refetches rarely — disable the
   plugin. Disabling it also ends the redirects from the old
   `/wp-content/uploads/` media URLs, so a site that still gets links to
   those keeps it enabled. The paths go away on the very next request, with nothing restarted,
   and if something was still using them you can enable it again just as
   quickly.

Retiring the stored actor id itself is a separate, optional step by the Move
protocol, and is not part of the cutover: not every follower's software honours
a `Move`, and the ones that do not would simply stop following.

## The federation screen

`/admin/federation` is all of that with a page in front of it. It shows one
panel per user — their avatar, their `@username@host` handle, the summary their
profile carries, their actor id, and the followers each of them has with
avatars and follow dates — the recent likes, boosts and replies out of the
inbox log, each linked to the remote object and to the post it was about, and
one row per post that has been federated: who announced it, its last activity,
when it went, and how many recipients it reached, is queued for, or failed
for. Each of those rows has a
Resend button, which is `cms.delivery.resend` behind a form: it builds the post
again from its file, sends it to every follower and every accepted relay the
site has now, and says what came of it.

Which posts are listed is a question for the files — the posts carrying an
`activitypub.published`, the trash included, which is the same thing as the
posts some follower holds a copy of — and how each landed is a question for the outcome
cache. So a site that has just deleted `data/geekity.db` sees every federated
post listed with nothing recorded against it, and can press Resend on any of
them.

A Relays panel sits between the followers and the inbox log: one row per
subscription with its inbox, whether it is waiting, accepted or rejected, when
it last moved, why it was refused if it was, and the last activity delivered
there with how that went. A subscription still waiting has a Retry, which sends
the `Follow` again under a fresh id.

## Testing federation against a real Mastodon account

Federation is the one part of the CMS that cannot be finished on localhost.
Mastodon has to be able to reach the site to fetch the actor, verify a
signature and deliver a `Follow`, and `http://localhost:3000` is not an
address it can reach. [`fedify tunnel`] gives the local server a public HTTPS
address for as long as the command runs, which is enough to do the whole round
trip by hand:

```sh
pnpm dlx @fedify/cli tunnel 3000
# The ephemeral public address is up and running:
# https://quiet-sun-42.serveo.net
```

Leave that running and boot the site with `baseUrl` set to the address it
printed, because `baseUrl` is what every ActivityStreams id is minted from — a
site booted on `http://localhost:3000` serves actors whose ids are
`http://localhost:3000/author/{username}/`, and no remote instance can
dereference those:

```sh
GEEKITY_BASE_URL=https://quiet-sun-42.serveo.net geekity serve
```

Then, from a Mastodon account:

1. Search for `@ada@quiet-sun-42.serveo.net` — the handle is a username at the
   tunnel's host. The profile should come back with that user's display name,
   bio and avatar.
2. Follow it. The `Follow` lands on `/author/ada/inbox/` (or on `/inbox/`), the
   CMS answers `Accept`, and the account appears on `/admin/federation` within
   a second or two.
3. Publish a post, from the editor or by writing a file into `content/posts/`.
   A `Create` is delivered, and the post shows up in the follower's
   home timeline; `/admin/federation` records the outcome, with a Resend
   button if it did not land.
4. Edit the post, then set `draft: true` on it, to see the `Update` and the
   `Delete` arrive.

Two things to know before relying on what a tunnel run shows you.

The tunnel address changes every time the command starts, and the followers
gathered under one are throwaway: their instances hold an actor id on a host
that no longer exists, so they cannot be migrated to the real domain. The
admin has no button for removing a follower yet, so run tunnel rehearsals
against a scratch `dataDir` rather than the one the real site will keep.

The key pairs live in `dataDir/keys`, not in the base URL, so they
survive across tunnel sessions. That is usually what you want; it also means a
`data` directory copied from one deployment to another brings the other's
identity with it.

`pnpm fed:smoke`, in this repository, is the automated half of the same idea:
it boots the CMS on a free port, runs `fedify lookup` against a user's actor
and a post object, reads WebFinger, and delivers a `Create(Article)` to two real inboxes over
loopback. It needs no tunnel and no network, and it is a job in CI. See
`packages/cms/scripts/fed-smoke.ts`, whose header explains why the `Follow`
half is sent by a peer built in the script rather than by `fedify inbox`.

[Fedify]: https://fedify.dev/
[`fedify tunnel`]: https://fedify.dev/cli
