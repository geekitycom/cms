# Deploying

## Deploying with Docker

The image `ghcr.io/geekitycom/cms` runs `geekity serve` over four directories
under `/site`: `content/`, `data/`, `plugins/` and, optionally, `themes/`. It runs as uid
1000, listens on port 3000 and fills an empty `content/` with the starter site
on its first start. [`deploy/compose.yaml`](../deploy/compose.yaml) runs it as a
compose stack. It is written for [dockge](https://github.com/louislam/dockge),
but plain `docker compose` reads it the same way. Nothing else from this
repository goes on the server.

The steps below assume a Linux server with Docker, a stack directory of
`/opt/stacks/geekity` (dockge's default layout), and a reverse proxy on the same
machine that terminates TLS.

### 1. Create the stack and its directories

In dockge, create a stack called `geekity` and paste in `deploy/compose.yaml`.
With plain compose, copy the file to `/opt/stacks/geekity/compose.yaml`.

Then, in the stack directory, create `content/`, `data/` and `plugins/` and
give them to uid 1000 before the first start:

```sh
cd /opt/stacks/geekity
mkdir -p content data plugins
sudo chown 1000:1000 content data plugins
```

The container runs as uid 1000 and writes to all three directories. If they
are missing, Docker creates them owned by root and the site fails to start with
`EACCES`. `content/` must be empty, or already hold a site: an empty one is
filled with the starter site, and one with anything in it, even a dotfile, is
left alone. `plugins/` holds the plugins `geekity plugin add` installs; see
[Installing a plugin on Docker](plugins.md#installing-a-plugin-on-docker).

To move an existing site in, copy its `content/` and `data/` here instead and
`chown -R 1000:1000` them.

### 2. Write the `.env`

The `.env` sits beside `compose.yaml` (dockge edits it on the stack page).
Compose reads it for the image tag and passes every line in it to the container.

```sh
# The image tag to run, which is the @geekity/cms version in it. Required: it
# has no default, so the stack never picks a version by itself. `latest` is
# published too, and works here.
GEEKITY_TAG=0.3.0

# The public address of the site. Required. Canonical URLs, feeds, ActivityPub
# ids and the Secure flag on the session cookie all come from it, and the
# starter site's site.json is written with it.
GEEKITY_BASE_URL=https://blog.example.com

# The port on 127.0.0.1 the reverse proxy connects to. Defaults to 3000.
# GEEKITY_HOST_PORT=3000
```

Compose refuses to start the stack when `GEEKITY_TAG` or `GEEKITY_BASE_URL` is
missing, and says which one.

The compose file names three variables itself, and its values win over the
`.env`:

| Variable              | Value  | Why                                                                       |
| --------------------- | ------ | ------------------------------------------------------------------------- |
| `GEEKITY_BASE_URL`    | `.env` | Passed through, so compose can refuse to start without it.                |
| `GEEKITY_TRUST_PROXY` | `true` | The client address comes from the proxy's `X-Forwarded-For`.              |
| `GEEKITY_PORT`        | `3000` | The port mapping and the health check assume it. Use `GEEKITY_HOST_PORT`. |

The image sets `GEEKITY_CONTENT_DIR`, `GEEKITY_DATA_DIR`, `GEEKITY_THEMES_DIR`
and `GEEKITY_SEED_CONTENT`; leave them alone. Any other setting in
[Configuration](configuration.md) can go in the `.env`, for example
`GEEKITY_UPLOAD_MAX_BYTES` or `GEEKITY_IMAGE_FORMATS=webp,avif`. Mail, comments
and the rest of the site settings are set in the admin, not here.

### 3. Start it and point the proxy at it

Deploy the stack in dockge, or:

```sh
docker compose up -d
docker compose ps       # (healthy) once /healthz answers 200
```

The port is published on `127.0.0.1` only. Docker writes its own firewall
rules ahead of ufw and firewalld, so a port published on every interface would
be reachable from the internet even with the firewall closed, and anyone
connecting to it directly could put any address in `X-Forwarded-For`. Do not
change the mapping to `3000:3000`.

The proxy forwards to `http://127.0.0.1:3000`. Geekity reads the **first**
address in `X-Forwarded-For`, so the proxy must replace that header with the
address it saw rather than append to one the client sent. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 200m;  # at least GEEKITY_UPLOAD_MEDIA_MAX_BYTES
}
```

The proxy's body limit has to be at least the larger of
`GEEKITY_UPLOAD_MAX_BYTES` and `GEEKITY_UPLOAD_MEDIA_MAX_BYTES`, 200 MiB by
default, or an episode is refused by the proxy with a 413 before Geekity sees
it. nginx's own default is 1 MiB. Caddy sets no limit unless the site block has
a `request_body { max_size 200MB }`, and Cloudflare's free plan stops at 100 MB
whatever the origin allows, so a larger episode has to be uploaded to the
server directly.

Geekity compresses its own text responses, brotli or gzip, so the proxy does
not need to. If the proxy compresses anyway (nginx with `gzip on`, Caddy with
`encode`, or a CDN such as Cloudflare), add `GEEKITY_COMPRESSION=false` to the
`.env` so each response is compressed once, by the proxy. Leave it on when the
proxy only forwards, as the nginx block above does.

`GET /healthz` is also what an uptime monitor should poll; see
[Health check](public-site.md#health-check).

### 4. Sign in for the first time

A site with no users sends `/admin` to `/admin/setup`, where the first person
to arrive creates the admin account. Do this as soon as the site is reachable.

To create the account from the server instead, and close the setup screen
before anyone else reaches it:

```sh
docker compose exec geekity geekity user add ada --email ada@example.com
```

It prompts for the password without echoing it. Run from the stack directory,
`docker compose exec` finds the container by its service name, `geekity`; plain
`docker exec -it <container> geekity user add ada` works as well. The command
writes `data/users.json` through the same mount as the server, and the new
account can sign in straight away.

### 5. Bring a WordPress author across

[Moving a site from the WordPress ActivityPub plugin](federation.md#moving-a-site-from-the-wordpress-activitypub-plugin)
describes the cutover. In a container, the WordPress plugin and the user have
to exist first, and the exported key pair is read from standard input so no
copy of the private key is left inside the container:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-wordpress
docker compose exec geekity geekity user add ada
docker compose exec -T geekity geekity import wordpress-actor ada \
  --actor-id 'https://blog.example.com/?author=2' \
  --wordpress-id 2 \
  --keypair /dev/stdin < ada.keypair.json
shred -u ada.keypair.json
```

`-T` stops compose allocating a terminal, which would swallow the redirected
file. Left to itself, the import fetches the followers from the plugin on the
actor id's origin. A saved followers file has to be copied in first:

```sh
docker compose cp followers.json geekity:/tmp/followers.json
```

and then passed as `--followers /tmp/followers.json`.

### Reading the logs

The container writes to stdout and nothing else — no log file inside the
image, nothing to rotate — so Docker collects it and dockge shows it. From the
stack directory:

```sh
docker compose logs -f              # follow everything, boot lines included
docker compose logs -t --since 1h   # the last hour, with Docker's timestamps
docker compose logs | grep webfinger
```

The image runs `geekity serve`, so [the access log](configuration.md#the-access-log) is on:
one line per request, `GET /path?query 200 4.2ms`. That is what answers "did
that Mastodon instance ever ask about me?" — `docker compose logs | grep webfinger`
shows each lookup and what it was answered with. The health check polls
`/healthz` every 60 seconds, so those lines are the background hum; `grep -v healthz`
drops them.

The client address is not logged unless the stack asks for it. To turn it on,
add `GEEKITY_ACCESS_LOG_ADDRESS=true` to the `.env` and redeploy; behind the
proxy `GEEKITY_TRUST_PROXY` is already `true`, so the address logged is the
visitor's rather than the proxy's. `GEEKITY_ACCESS_LOG=false` turns the log
off altogether.

### Backups

Everything the site cannot rebuild is under the stack directory
([Two directories](content.md#two-directories-content-and-data) has
the full list):

- **All of `content/`**: posts, pages, uploads, `site.json`, followers, the
  inbox log and comments.
- **`data/`, apart from what is derived.** `data/users.json` and `data/keys/`
  matter most: the accounts, and the key pairs every follower has cached.
  Losing the keys breaks federation. The rest (`mail.json`, `akismet.json`,
  `contact/`, `comment-salt`, `notification-secret` and the other small files)
  is credentials and records that are also not rebuilt.
- **`compose.yaml` and `.env`**, so the stack can be recreated.

`data/geekity.db` (with `-wal` and `-shm`), `data/images/` and `data/avatars/`
are derived and need not be copied: the database is rebuilt on the next start, and an image
variant the next time it is asked for. The site writes its files by renaming a
finished copy over the old one, so a copy taken while it runs gets whole files;
stop the stack first if the copy has to be of one moment. For example:

```sh
tar -C /opt/stacks -czf geekity-$(date +%F).tar.gz \
  --exclude='geekity/data/geekity.db*' --exclude='geekity/data/images' \
  --exclude='geekity/data/avatars' geekity
```

Restore by unpacking it into `/opt/stacks`, checking `content/` and `data/` are
still owned by uid 1000, and starting the stack.

### Upgrading and rolling back

Every published version is a tag (see
[Publishing the Docker image](development.md#publishing-the-docker-image)). To upgrade, set
`GEEKITY_TAG` in the `.env` to the new version and redeploy, which in dockge is
Save then Deploy, and with plain compose is:

```sh
docker compose pull
docker compose up -d
```

Database migrations run on start, so there is no other step. Read the
[changelog](../packages/cms/CHANGELOG.md) for the versions in between first; a
breaking change carries a note there.

An upgrade never deletes a reader's data. Commenter emails, address hashes and
contact messages are kept until the owner sets a retention period on
**Settings > Discussion** ([Personal data](personal-data.md#retention)).

`GEEKITY_TAG=latest` is the other way to run this. Every push moves that tag,
so an upgrade is `pull` and `up -d` with nothing to edit — at the cost of the
site not saying which version it is on, and of the rollback below starting with
finding that out. `docker compose exec geekity geekity --version` answers it.
Pin the version if the site matters; the tags stay published either way.

To roll back, set `GEEKITY_TAG` to the version you came from and redeploy the
same way. If the newer version migrated the database, the older one refuses to
start and says the database was written by a newer `@geekity/cms` (the logs in
dockge, or `docker compose logs`, show it). The database is a cache, so rebuild
it with the old version — the one rebuild the admin cannot do, because there is
no site running to press a button in:

```sh
docker compose stop
docker compose run --rm geekity geekity rebuild
docker compose start
```

`geekity rebuild` refuses to run while the server has the database open, so
`docker compose exec` will not do; the one-off container from `run` uses the
same image, `.env` and mounts with the server stopped. A rebuild signs everyone
out; [what else it costs](content.md#what-is-in-the-database-and-what-a-rebuild-costs)
is listed in Content. The same three commands fix a damaged database.

**Every other rebuild belongs in the admin.** When the index and the content
files have come apart — content edited over ssh, a `git pull` while the stack
was down, one of the two restored from a backup — **Tools > Content index**
[reads every file again on the running site](content.md#rebuilding-the-index-from-the-admin):
no stopping the stack, no one-off container, nobody signed out, and none of the
cost listed above. In a container the server is PID 1, so
`docker exec <container> geekity rebuild` can never work; the admin is the door
that is always open.

### A custom theme

With no `theme` in `content/_data/site.json`, the site wears the default theme
that ships in the image. To use one of your own:

1. Create `themes/` in the stack directory and put the theme in it, one
   directory per theme with a `theme.json` in it (see [Themes](themes.md)):

   ```sh
   mkdir -p themes
   cp -r ~/my-theme themes/my-theme
   sudo chown -R 1000:1000 themes
   ```

2. Uncomment the `./themes:/site/themes:ro` line under `volumes` in
   `compose.yaml` and redeploy. The site only reads this directory, so it is
   mounted read-only.
3. In the admin, choose the theme on **Appearance > Themes**. That writes
   `theme` into `site.json`, and it takes effect on the next request.

A theme can replace a single template or `style.css` and take everything else
from the default theme.

## Dev mode

Building or migrating a site means running it with production data: the real
base URL, the real actor and keys, real followers, real links. Dev mode keeps
that site quiet until you take it live (decision-35). While it is on, nothing
the site does reaches the outside world:

- No ActivityPub delivery to followers or relays, no relay `Follow` or `Undo`,
  and no `Accept` or `Reject` answering an inbox. This holds whatever caused
  the change: the watcher, the admin, the scheduler, `geekity resend` or a
  reply context arriving.
- No webmention. Endpoint discovery is skipped too.
- No rssCloud or WebSub ping.
- No IndexNow submission.
- No email.

Reads still go out: reply contexts and cited pages, actor profiles, oEmbed,
avatars, the check of an incoming webmention, and a plugin's `host.fetch`. A
read tells nobody about the site, and without them it could not show its
replies or profiles. Inbound federation is accepted: follows, replies, likes
and webmentions are stored as on a live site, and the `Accept` a follow would
get is held. Plugins need no switch of their own. A plugin's federation hands
what it receives to the site's inbox, so its answers are held the same way.

Each held side effect is a line in `data/dev-mode.jsonl`: when, what kind,
what would have been sent, and to whom. Tools > Dev mode in the admin lists
them, newest first. Every admin screen shows a banner while the mode is on,
and `geekity serve` says so when it boots.

```sh
$ geekity dev-mode on
Dev mode is on: nothing the site does is sent until `geekity dev-mode off`.
$ geekity dev-mode status
Dev mode is on.
$ geekity dev-mode off
Dev mode is off: the site is live. Nothing held while it was on will be sent.
```

`devMode: true` in the config, or `GEEKITY_DEV_MODE=true`, starts a site in
dev mode: boot writes `data/dev-mode.json`, and the file keeps the mode on
from then on. Losing the variable does not take the site live. Only
`geekity dev-mode off` does, and it refuses while the config or the
environment still asks for dev mode, because the next boot would turn it on
again. The running site checks the file before every send, so going live
needs no restart, unless the server was started with the variable: that
process stays in dev mode until it restarts without it. Going live is a line
in the record too.

Going live replays nothing. A held side effect is dropped, not queued, and no
delivery or webmention is recorded as failed, so neither the Federation screen
nor `geekity resend` offers it again. A post announced while the mode was on
counts as announced, so its next edit goes out as an `Update`. A relay listed
while the mode was on stays pending: press Retry on the Federation screen once
the site is live.

Password recovery mail is held too, so in dev mode a password is reset from
the shell. A peer that followed while the mode was on never got its `Accept`,
and has to follow again.

### Dev mode on Docker

Set the variable in the service's environment before the first boot, so the
container never starts live:

```yaml
services:
  geekity:
    environment:
      GEEKITY_DEV_MODE: 'true'
```

To go live, remove the variable, recreate the container (the file in the
`data` volume keeps the mode on through the restart), then run:

```sh
docker compose exec geekity geekity dev-mode off
```

`geekity dev-mode status` in the same container says which state the site is
in. The record is in the `data` volume at `data/dev-mode.jsonl`.
