# @geekity/plugin-wordpress

A [Geekity CMS](../cms/README.md) plugin for a site that moved from the
WordPress ActivityPub plugin. It answers the old plugin's inbox and collection
paths until every follower's server has refetched the actor, records when each
path was last asked for, and adds `geekity import wordpress-actor`, which
brings each person's key pair, actor id and followers across.

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

`geekity import wordpress-actor` works as soon as the plugin is installed. The
old paths are served only while the plugin is enabled under `/admin/plugins`,
and disabling it takes them away on the next request, with nothing restarted.

The plugin keeps two files in `data/plugins/@geekity/plugin-wordpress/`:

| File            | What it holds                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `actors.json`   | Each username and the number WordPress gave that person's actor, which the old paths are built from. Written by the import. |
| `requests.json` | When each old path was last asked for, per user, and when the shared inbox was. Losing it resets what the screen says.      |

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
