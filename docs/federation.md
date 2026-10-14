# Federation

**Every user is an ActivityPub actor**, served by [Fedify] at their author URL.
`{baseUrl}/author/{username}/` is the archive in a browser. To a peer that asks
for `application/activity+json`, the same URL is the `Person`. A post's
permalink works the same way: it is both the page and the object.

The actor's collections are children of that URL: `inbox/`, `outbox/`,
`followers/` and `following/`. The instance-wide shared inbox is `/inbox/`.
`author` and `inbox` are reserved top-level paths. If a settings field could
move an actor id, every server holding the old id would see a different
account.

There is no site actor. A post is announced by the actor of the user that its
`author` names. That user's `outbox` is their archive as activities, and the
post's followers are that user's followers.

Fedify's stores have defaults for a single process. Set `federation` to
replace them when a site outgrows them:

| Field                 | Default                                     | Meaning                                                                                                                                                                                     |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv`                  | `MemoryKvStore`                             | Fedify's cache and idempotence store. Nothing that has to survive a restart lives in it.                                                                                                    |
| `queue`               | `SqliteMessageQueue` in `data/queue.sqlite` | The delivery and inbox queue. `null` means no queue: activities are handled and delivered inside the request that carried them, with no retry. See [The message queue](#the-message-queue). |
| `allowPrivateAddress` | `false`                                     | Whether Fedify may fetch private and loopback addresses. Leave it off: turning it on removes an SSRF guard. It exists for tests.                                                            |

The CMS owns the followers and the inbox log. Both are files the site
publishes (decision-9):

| File                                                 | Contents                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content/_data/federation/{username}/followers.json` | One object per follower of that user: actor id, inbox, shared inbox, handle, name, icon, profile URL and follow time. Oldest follow first.          |
| `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`   | One compact JSON-LD activity per line. In front of each activity are the `receivedAt` time the log stamped and the `recipient` it was addressed to. |

The inbox log is one chronological record of what this server received, so it
is not split per user. Each line names its recipient. Both files are in git
beside the posts. An Eleventy build of the same content directory sees them as
`federation.{username}.followers` and `federation.inbox`.

- A `Follow` appends to `followers.json`.
- An `Undo(Follow)`, or an actor's own `Delete`, removes the entry.
- A like, a boost, or a reply appends a line to the inbox log.

Each write updates the SQLite index in the same step, behind a lock on the
file, so the file and the index always agree. The `followers` and `ap_inbox`
tables are only an index. Every boot empties them and reads them back from the
files. You can therefore edit `followers.json` by hand and restart, and
deleting the database loses nothing. The rebuild calls
`cms.admin.replaceFollowers` and `replaceInboxActivities`.
`rebuildFederationIndexes({ admin, contentDir })` is the rebuild itself.

The delivery outcomes stay in SQLite as a cache of what happened. The
activities are not stored. The site rebuilds them from the posts' files when it
needs them again.

The CMS also owns each user's key pairs. A site cannot regenerate them, so they
live in files:

- One JWK per algorithm per user, under `dataDir/keys`: `ada.rsassa-pkcs1-v1_5.jwk`
  and `ada.ed25519.jwk`.
- Each file is written `0600`, in a `0700` directory.
- Each file holds only the private key. The public half is derived from it.

The site generates the keys on the first request that needs them and reads
them back on every request after that. The actor publishes the RSA key as
`publicKey` at `{actor}#main-key`. A peer verifies an HTTP Signature with that
key. The actor publishes both keys as `assertionMethod` multikeys at
`{actor}#multikey-0` and `#multikey-1`.

If a key file exists but does not import, the boot stops with a message that
names the file. This is deliberate. A replacement key would give the site a new
identity, and every follower's cached public key would stop verifying. Fedify's
own fallback, an actor document with no `publicKey`, is worse, because peers
cache it. Restore the file from a backup, or delete it to request a new key on
purpose.

## The message queue

Fedify queues every outgoing delivery, every inbox activity and every retry it
schedules. By default the queue is a `SqliteMessageQueue` from
`@fedify/sqlite`, in the table `federation_messages` of `data/queue.sqlite`
(decision-57). The file is apart from `data/geekity.db`, so `geekity rebuild`
does not touch it.

- A delivery that waits in the queue, and a retry Fedify scheduled for later,
  survive a restart, a crash and a reload. The server sends them when it
  starts.
- Only a running server takes messages from the queue. A CLI command that
  queues a message leaves it there, and the server takes it within 5 seconds.
- On a reload under `geekity serve`, the old server stops taking messages,
  finishes the ones it holds, and leaves the rest for the new server. No
  message is handled by both.
- A delivery whose handler is running when the process dies is lost. The queue
  removes a message when a server takes it. Resend the post from the
  federation screen.
- While dev mode is on, the server drops each outgoing delivery it takes from
  the queue and records it in `data/dev-mode.jsonl` as held. A `data/` copied
  from a live site can hold deliveries that are still waiting.

The file is mode `0600`. A waiting delivery holds the activity, the inbox it
goes to and the private key it is signed with. An inbox activity waiting to be
handled holds what the peer sent. You can delete the file while the site is
stopped. The waiting deliveries and retries are lost, and nothing else.

A queue passed as `federation.queue` replaces this one. A durable queue is
handled the same way. An `InProcessMessageQueue` is never paused: a server
that stops sends everything it queued before it exits, and loses its scheduled
retries.

## Delivery

Publishing a post federates it. The delivery service listens to the index, so
a post edited on disk reaches the followers in the same way as a post saved
through the editor:

| What happened to the post                                                    | What the followers get    |
| ---------------------------------------------------------------------------- | ------------------------- |
| became published, whether written live, undrafted or restored from the trash | `Create` of its object    |
| edited while published                                                       | `Update` of its object    |
| drafted, trashed, or its file deleted                                        | `Delete` of a `Tombstone` |

A full scan delivers nothing, and that includes the boot scan. A rebuilt index
reports the whole archive as new. Deleting `data/geekity.db` must not announce
the archive again.

A post's ActivityStreams object id is its permalink, absolute on the site's
base URL. One URL serves both audiences. A browser gets the page, and a peer
that asks for `application/activity+json` gets the post's object. A shared
link, a feed item, an object id, and a reply's `inReplyTo` all name the same
thing. The site does not mint or sync any other id.

The object is a `Note` or an `Article`, depending on the post's discovered
type. A post with no title, or whose text opens with its title, is a `Note`.
Any other post is an `Article`. Mastodon shows the two differently:

- An `Article` appears as its title, its excerpt, and a link, so it sends
  `name` and a `summary`.
- A `Note` appears as its `content` only. Mastodon would show a `summary` as a
  content warning, so a note sends neither `name` nor `summary`. If the note's
  text does not open with its title, the title goes at the top of its content.

Both types carry their text twice: `content`, and `contentMap` keyed by the
post's language. An `Article` also has `summaryMap` beside its `summary`. The
language is the post's `lang` front matter when it names one, and the site's
`language` otherwise. Clients can filter and translate by it. Mastodon reads a
status's language from that key.

To choose the type for one post, set it in the front matter:

```yaml
activitypub:
  type: Note
```

The two values are `Note` and `Article`. For any other value, the site logs a
warning and sends the derived type. The CMS never rewrites the key. Changing it
on a post that was already announced sends an `Update`, but a remote server may
keep showing the post as it first arrived.

The first activity about a post writes one key into its front matter:
`activitypub.published`. It records that the post was announced, and when. It
decides between `Create` and `Update`, and a resend reads it. Restoring a
trashed post reuses it too.

If a post's file already names an `activitypub.id`, the post keeps that as its
object id for the life of the post. A post migrated from WordPress keeps the
`https://example.com/?p=813` that its followers, its replies, and its RSS
subscribers already hold. At that URL the CMS:

- serves the post's object on an ActivityStreams request
- redirects a browser to the permalink

The CMS names that URL in every `Update` and `Delete`.

The CMS writes an `activitypub.id` itself in one case: when you change a
published post's slug or permalink in the editor. A fediverse server cannot
rename an object it holds, so the URL the post is leaving becomes its stored
`activitypub.id`. Followers get an `Update` of the object they already have. A
peer at the old URL still gets the object, and a browser there is redirected to
the new permalink. The object's `url` is the new permalink. See
[Moved URLs](public-site.md#moved-urls).

One POST serves a whole instance, and the site prefers the shared inbox. The
site records the outcome per recipient, so an admin can see which recipient did
not get a post and send it again:

```ts
const report = await cms.delivery.resend(slug);
report?.deliveries; // one row per follower and relay: inbox, status, error, time
```

`resend` sends the post as it reads now. It does not repeat an earlier
activity. It builds the activity from the file at the moment you call it, so a
follower whose server was down receives the current post. The activity follows
the same table as a save:

- A published post that no follower has received is a `Create`, and the site
  stamps it.
- A published post that followers hold is an `Update`, under a new id.
- A draft or a trashed post is a `Delete` of a `Tombstone`.

`resend` returns `undefined` when there is no post with that slug and nothing
to withdraw.

The site stores nothing else. For each activity it sends, SQLite keeps one
outcome row per recipient: the activity's id, type, object id and slug, the
inbox used, the status, the error, and the time. That cache may be empty.

- `cms.admin.lastDeliveryToObject(objectId)` returns the newest outcome for one
  post.
- `listDeliveries(activityId)` and `countDeliveriesByStatus(activityId)`
  report how one activity went with each recipient.

A status is one of:

- `sent`: the inbox accepted it.
- `queued`: it was handed to Fedify's queue, which retries out of band.
- `failed`

One capability is not supported: tombstoning a post whose file is deleted, as
opposed to trashed. With no file, there is nothing to build the `Tombstone`
from.

## Quote posts

Mastodon 4.5 lets people quote a post only when the post says who may quote
it. It shows a quote only after the quoted author's server approves it
([FEP-044f]). Every post this site federates is public. Every `Note` and
`Article` carries `interactionPolicy.canQuote` with `automaticApproval` set to
the public collection. Anyone may quote the post, and no manual approval is
needed. Pages, drafts, and scheduled and trashed posts do not federate, so
they cannot be quoted.

A quoting server sends a `QuoteRequest` to the post's author. The inbox
answers it. So does any plugin inbox that hands its deliveries to the site's
own handlers.

- For a post the site federates, when the quote is on the requester's own
  server, the inbox stores an approval. It replies `Accept` with a
  `QuoteAuthorization` as its `result`. The authorization names the quote
  (`interactingObject`), the post (`interactionTarget`), and the author
  (`attributedTo`).
- For anything else it replies `Reject` and stores nothing.

Approvals are files, like followers.
`content/_data/federation/{username}/quotes.json` holds one object per quote of
that user's posts. Each approval is served unsigned, as ActivityStreams JSON, at
`{baseUrl}/author/{username}/quotes/{id}/`, while the post is still published.
An `Undo` of the `QuoteRequest`, or a `Delete` of the quoting post, removes the
approval. Its URL then answers 404. A quote does not notify the author.

Mastodon keeps the copy of a post it fetched first. A post federated before the
quote policy existed cannot be quoted until its followers receive an `Update`.
Editing the post sends one. To update every announced post at once, run
`geekity resend --all` in the site directory:

```sh
$ geekity resend --all
hello-world: Update to 3 of 3 inboxes
another-post: Update to 3 of 3 inboxes
```

`geekity resend <slug>...` does the same for named posts. Both run the same
`resend` [admin job](configuration.md#admin-jobs) as the federation screen.
Each resend sends:

- an `Update` for a post that is still published
- a `Delete` for a post that was withdrawn
- a `Create` for a published post that was never announced

`--all` reaches only posts that were announced. The command runs the job in its
own process and waits for it. It delivers with no queue, so every activity is
posted before it exits. In dev mode it prints
`hello-world: Update held by dev mode, nothing sent` for each post. It names
each slug with nothing to resend on standard error, and exits `1` if there was
one or if the job failed. It works while the server runs, because both read the
same files and database. The command does not send webmentions. The Resend
button on a post's row does.

[FEP-044f]: https://codeberg.org/fediverse/fep/src/branch/main/fep/044f/fep-044f.md

## Replies to fediverse replies

When someone answers a fediverse reply on one of the site's posts, they address
the person they answer, not the site. Their reply never reaches the inbox.
Most servers list a note's replies in its `replies` collection. The site reads
those collections to bring such replies in. The sweep starts when the site
starts serving and runs every hour, within these limits:

| Limit    | Value    | Meaning                                                                                               |
| -------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Interval | 6 hours  | How long a thread is left alone after it was read.                                                    |
| Age      | 30 days  | How old a post gets before its thread is no longer read, by the post's date.                          |
| Depth    | 4 levels | How far below the post a fediverse reply may sit and still have its collection read.                  |
| Pages    | 3        | How many pages of one collection are read. Mastodon's first page holds the author's own replies only. |

Every request is signed as the site's first account, like the actor profile
fetches. The site keeps a reply only when all of these are true:

- It answers the note whose collection listed it.
- It is addressed to the public.
- Its actor is on the note's own server.

The site never fetches a note on its own origin, because it already has what
it published.

The site logs a reply found this way as a `Create` that was never delivered. It
writes a line in `content/_data/federation/inbox/{yyyy}-{mm}.jsonl` with:

- `"fetched": true` in front of it
- an `actor` taken from the note's `attributedTo`
- the id `{note id}#fetched`

After that it is a reply like any other. It is threaded under the reply it
answers by its own URL, counted, given a `/replies/` feed, and listed on the
federation screen. Its author's `Delete` removes it.

The site never logs a note twice. The sweep skips a note that the inbox already
holds, or that the site holds as a
[migrated comment](comments.md#migrated-comments). When a note the sweep
fetched first is later delivered, the delivery replaces the fetched line. The
site reads an imported fediverse reply's collection by its note id, its
`origin`.

The site removes a fetched reply, with the fetched replies under it, when:

- its server answers 404 or 410 for it, or
- a collection read to its end no longer lists it.

The site never removes a delivered reply this way. These change nothing: a
note with no `replies` collection, a server that answers with any other error,
and a collection cut off by the page limit. The thread keeps what it holds, and
the sweep moves to the next reply.

The site reads `replies`, not the conversation a note names in `context`
([FEP-7888]). Mastodon publishes `replies`, and few servers publish a `context`
collection yet.

[FEP-7888]: https://codeberg.org/fediverse/fep/src/branch/main/fep/7888/fep-7888.md

## Relays

A [Mastodon-style relay][fepae0c] boosts every public activity it receives to
the instances subscribed to it. A site with no followers yet reaches people
this way. The setting is `relays`: one relay inbox per line on
`/admin/federation/settings`, stored in `site.json` like every other setting.
One useful relay is `https://tags.pub/user/_____relay_____/inbox`. It boosts
any public post that carries a hashtag it tracks. Every `Article` this CMS
builds carries one hashtag per tag and per category.

Adding a line sends that inbox a `Follow` whose object is the ActivityStreams
Public collection. The `Follow` is signed by the site's first account and
carries the Linked Data signature that a Mastodon-style relay verifies. The
site uses the first account because a relay subscription is an agreement for
the whole instance, not for one person. The first account is the one actor the
site can pick without asking.

The relay answers `Accept` or `Reject`, possibly days later, because a
subscription may need a human to approve it. The answer arrives in the site's
inbox and updates the subscription. Removing the line sends an `Undo` of the
same `Follow`.

The site delivers only to an accepted relay. An accepted relay is one more
inbox in the fan-out. It receives, as well as the author's followers:

- every `Create`, `Update`, and `Delete` for a post, whoever wrote it
- the actor `Update` that a profile change sends

The delivery log records each relay outcome against the relay's actor id and
inbox, as it does for a follower. Resend therefore reaches relays too.

```ts
cms.admin.listRelays(); // inbox, actor, state, reason, follow id, times
await cms.relays.sync(); // reconcile the records with the setting
await cms.relays.retry(inboxId); // send the follow again
```

The records live in `ap_relays`, keyed by inbox. They are operational state,
not a source. The setting is the source. If the setting names a relay that has
no record, after a rebuilt database or a restored content directory, the site
follows it again on the next boot.

[fepae0c]: https://w3id.org/fep/ae0c

## A user's profile

An actor's fields come from the user record, edited on `/admin/users/<id>` and
stored in `data/users.json`:

| Actor field         | User record field |
| ------------------- | ----------------- |
| `name`              | Display name      |
| `summary`           | Bio               |
| `icon`              | Avatar            |
| `attachment`        | Links             |
| `preferredUsername` | Login             |

The author archive is headed with the same profile, so a page and an actor
always show the same details. `alsoKnownAs` lists every URL the user answers
to: the actor id, the archive, and `/@{username}`. The profile has two more
fields that the actor does not carry, a job title and a location. A theme can
print them beside the name.

The avatar is a path like `/uploads/2026/09/me.png`, stored with the site's
other uploads. The actor carries it as an absolute URL, resolved against the
current base URL, because a peer cannot resolve a path. If the avatar is
already an absolute URL, the site leaves it unchanged. Use that to serve a
profile picture from a CDN.

Saving a profile delivers an `Update` of that user's actor to their followers.
The followers' servers then refresh their cached copy of the profile. Saving
the settings screen sends nothing, because the site is not an actor.
`cms.delivery.updateActor(user)` sends an actor `Update` from code. Its outcome
is recorded like every other activity's, with the actor's id as its object and
no slug. It is therefore not a row in the federation screen's per-post delivery
table, which is built from the posts in the content index.

## WebFinger

`/.well-known/webfinger` is a CMS route, not a Fedify one. Fedify computes its
`self` link and its `aliases` from the dispatcher path, and neither can be
extended. The route answers for every form of the same person's address:

- the `acct:{username}@{host}` handle
- the bare `{username}@{host}`
- the author URL
- `/@{username}`
- the stored actor id, for a user who has one

It answers with the actor id as `self`, the archive as `profile-page`, and all
of the person's URLs as `aliases`. An unknown username answers 404.

`/@{username}` itself is a 301 to the archive of the user with exactly that
name. A handle that no user has answers 404. The handle is an alias of a user,
so a handle with no user has no archive to redirect to.

## A user's stored actor id

A user record in `data/users.json` may carry an `actorId`. It is the
ActivityStreams id the person was published under on another site, such as the
`https://example.com/?author=2` that the WordPress ActivityPub plugin
publishes. The `actorId` is identity, not cache. A follower's server keys the
account by the URL it first saw. The CMS serves the person under that URL for
the life of the account, as a post keeps its `activitypub.id`:

```json
{ "id": 2, "username": "ada", "actorId": "https://example.com/?author=2" }
```

With an `actorId` set:

- The actor document's `id` is that URL, and its keys are under it
  (`…?author=2#main-key`).
- Every activity the user sends names it as `actor` and is signed with a key
  id under it.
- The URL itself, including the query string, answers with the `Person` for a
  peer and a 301 to the author archive for a browser.
- WebFinger publishes it as `self` and resolves a lookup by it.
- The actor lists it in `alsoKnownAs`, beside the archive and `/@{username}`.

Nothing else changes. `url` is still the archive, and the collections are
still the archive's children, because a peer refetches those.

The CMS never creates an `actorId`, and no screen writes one. It comes from a
plugin's import, such as the WordPress plugin's, or you type it into the file
by hand. `/admin/users/<id>` shows it read-only beside the account. The site
ignores a value that is not an absolute URL.

## Moving a site from the WordPress ActivityPub plugin

A site that moved here from the WordPress ActivityPub plugin keeps its users'
actor ids and its posts' object ids. Those are identity, and the CMS handles
them itself (see above). The site also needs three more things:

- its content
- the plugin's old paths, which followers' servers keep delivering to until
  they refetch the actor
- an import that brings each user's key pair and followers across

All three are in the
[`@geekity/plugin-wordpress`](../packages/plugin-wordpress/README.md) package.
A site that started on the CMS never installs it. That plugin now replaces
decision-14's switch. Where the cutover used to say "turn the switch on", it
now says install and enable the WordPress plugin.

### The cutover, end to end

1. **Start the new site in dev mode.** Set `GEEKITY_DEV_MODE=true` before its
   first boot (see [Dev mode](deploying.md#dev-mode)). From here on, followers,
   relays, links, and mail are all real. Dev mode stops all of them from
   receiving the import, the edits, or a scheduled post until step 4.
2. **Export while the WordPress site is still up.** Export each user's key
   pair. If the old site goes away before the import runs, export the followers
   too. The plugin's README explains how. Note the actor id and the numeric
   actor id from `https://example.com/?author=2`. Take a WXR export under
   Tools > Export. Copy `wp-content/uploads`, because the export does not
   include it.
3. **Install the WordPress plugin and import.** Add `@geekity/plugin-wordpress`
   to the site's dependencies and to `plugins` in its config. Run
   `geekity import wordpress example.WordPress.xml --uploads wp-content/uploads`
   for the content and media. Run
   `geekity import wordpress-actor ada --actor-id … --wordpress-id … --keypair ada.keypair.json`
   for each user. Both commands work before the plugin is enabled. Check the
   reports: every post is written, every conflict or clash is resolved, and
   every follower is added. Re-run any skipped follower once its server
   answers. Tools > Dev mode shows that the imports sent nothing. You can run
   both imports again safely. Run them over a fresh export just before step 4
   to pick up what WordPress received in the meantime.
4. **Enable the WordPress plugin, move the DNS, and go live.** Enable the
   plugin under `/admin/plugins`, then move the DNS. Remove `GEEKITY_DEV_MODE`
   and run `geekity dev-mode off`. Nothing held during the migration is sent.
   Followers' servers keep delivering to the plugin's old inbox paths until
   they next refetch the actor. The plugin receives those deliveries. Once
   WordPress no longer answers, run both imports one last time over its final
   export. They merge what arrived between the export and the DNS move. They
   leave unchanged anything this site wrote or edited since.
5. **Watch.** `/admin/federation` lists the users with their actor ids and
   followers. The plugin's own screen under Plugins lists each old path with
   the time it was last requested. Deliveries decrease as each follower's
   server refetches the actor and learns the new endpoints.
6. **Disable it.** When every path has shown _Never_ for long enough, disable
   the plugin. Wait weeks, not days, because a quiet instance refetches rarely.
   Disabling the plugin also ends the redirects from the old
   `/wp-content/uploads/` media URLs. If the site still gets links to those,
   keep the plugin enabled. The paths stop working on the next request, with
   no restart. If something still used them, enable the plugin again. That
   also takes effect on the next request.

Retiring the stored actor id, by the Move protocol, is a separate, optional
step. It is not part of the cutover. Not every follower's software supports a
`Move`, and followers on that software would stop following.

## The federation screen

`/admin/federation` shows the federation state described above. It has:

- One panel per user, with their avatar, their `@username@host` handle, the
  summary from their profile, their actor id, and their followers with avatars
  and follow dates.
- The recent likes, boosts, and replies from the inbox log. Each links to the
  remote object and to the post it was about.
- One row per post that has been federated: who announced it, its last
  activity, when that was sent, and how many recipients it reached, is queued
  for, or failed for.

Each post row has a Resend button, and the Resend panel above the rows has
**Resend every announced post**. Both queue the `resend`
[admin job](configuration.md#admin-jobs) and return at once. The job calls
`cms.delivery.resend` for each post, so it builds each post again from its file
when it runs and sends it to every current follower and every accepted relay.
The button on a row also sends that post's webmentions again. The panel button
does what `geekity resend --all` does.

The Resend panel shows the latest resend job: queued, running with the posts
sent out of the total, finished, failed with the error, or interrupted. A
finished job lists each post with how many inboxes it reached out of how many,
how many are queued or failed, and its webmentions when it sent them. It names
the posts dev mode held and the slugs with nothing to resend. The page does not
reload itself. Select **Check again** to see how far it got. While a resend is
queued or running, the screen queues no second one and says so.

When the server stops or reloads during a resend, the job stops before the next
post and the next server runs it again from the first post. A post sent twice
reaches its followers as a second `Update`, which they treat as the same post.

The files decide which posts are listed. A post is listed when it carries an
`activitypub.published`, including posts in the trash. These are the posts
that some follower holds a copy of. The outcome cache supplies how each post
landed. After a site deletes `data/geekity.db`, the screen lists every
federated post with no outcome recorded, and Resend works on any of them.

A Relays panel sits between the followers and the inbox log. It has one row per
subscription, with:

- its inbox
- its state: waiting, accepted, or rejected
- when the state last changed
- the reason, if the relay refused
- the last activity delivered there, and its outcome

A subscription that is still waiting has a Retry button. Retry sends the
`Follow` again under a new id.

## Testing federation against a real Mastodon account

You cannot finish testing federation on localhost. Mastodon must reach the site
to fetch the actor, verify a signature, and deliver a `Follow`, and it cannot
reach `http://localhost:3000`. [`fedify tunnel`] gives the local server a
public HTTPS address while the command runs. That is enough to test the whole
round trip by hand:

```sh
pnpm dlx @fedify/cli tunnel 3000
# The ephemeral public address is up and running:
# https://quiet-sun-42.serveo.net
```

Leave the tunnel running. Boot the site with `baseUrl` set to the address it
printed, because every ActivityStreams id is built from `baseUrl`. A site
booted on `http://localhost:3000` serves actors with ids like
`http://localhost:3000/author/{username}/`, and no remote instance can
dereference those:

```sh
GEEKITY_BASE_URL=https://quiet-sun-42.serveo.net geekity serve
```

Then, from a Mastodon account:

1. Search for `@ada@quiet-sun-42.serveo.net`. The handle is a username at the
   tunnel's host. The profile appears with that user's display name, bio, and
   avatar.
2. Follow it. The `Follow` arrives at `/author/ada/inbox/` (or at `/inbox/`),
   the CMS answers `Accept`, and the account appears on `/admin/federation`
   within a second or two.
3. Publish a post, from the editor or by writing a file into `content/posts/`.
   The site delivers a `Create`, and the post appears in the follower's home
   timeline. `/admin/federation` records the outcome, with a Resend button if
   the delivery failed.
4. Edit the post, then set `draft: true` on it. The `Update` and the `Delete`
   arrive.

Keep two limits in mind when you read the results of a tunnel run.

The tunnel address changes every time the command starts. Followers gathered
under one address are disposable. Their instances hold an actor id on a host
that no longer exists, so you cannot migrate them to the real domain. The
admin has no button to remove a follower yet. Run tunnel tests against a
scratch `dataDir`, not the one the real site will keep.

The key pairs live in `dataDir/keys`, not in the base URL, so they persist
across tunnel sessions. That is usually what you want. It also means that a
`data` directory copied from one deployment to another brings the first
deployment's identity with it.

`pnpm fed:smoke`, in this repository, automates part of the same test. It:

1. boots the CMS on a free port
2. runs `fedify lookup` against a user's actor and a post object
3. reads WebFinger
4. delivers a `Create(Article)` to two real inboxes over loopback

It needs no tunnel and no network, and it runs as a job in CI. See
`packages/cms/scripts/fed-smoke.ts`. Its header explains why a peer built in
the script sends the `Follow`, not `fedify inbox`.

[Fedify]: https://fedify.dev/
[`fedify tunnel`]: https://fedify.dev/cli
