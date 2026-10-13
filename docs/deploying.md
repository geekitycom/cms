# Deploying

## Deploying with Docker

The image `ghcr.io/geekitycom/cms` runs `geekity serve` over four directories
under `/site`: `content/`, `data/`, `plugins/` and, optionally, `themes/`. The
image:

- Runs as uid 1000.
- Listens on port 3000.
- Fills an empty `content/` with the starter site on its first start.

[`deploy/compose.yaml`](../deploy/compose.yaml) runs the image as a compose
stack. The file is written for [dockge](https://github.com/louislam/dockge), and
plain `docker compose` reads it the same way. No other file from this
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
are missing, Docker creates them owned by root, and the site fails to start with
`EACCES`.

`content/` must be empty or already hold a site. The image fills an empty
`content/` with the starter site. It leaves a `content/` with any entry in it,
even a dotfile, unchanged.

`plugins/` holds the plugins that `geekity plugin add` installs. See
[Installing a plugin on Docker](plugins.md#installing-a-plugin-on-docker).

To move an existing site in, copy its `content/` and `data/` here instead, and
run `chown -R 1000:1000` on them.

### 2. Write the `.env`

The `.env` file is next to `compose.yaml`. Dockge edits it on the stack page.
Compose reads the image tag from it and passes every line in it to the
container.

```sh
# The image tag to run, which is the @geekity/cms version in it. Required. It
# has no default, so the stack never picks a version on its own. `latest` is
# also published and works here.
GEEKITY_TAG=0.3.0

# The public address of the site. Required. Canonical URLs, feeds, ActivityPub
# ids and the Secure flag on the session cookie all come from it. The starter
# site's site.json is written with it.
GEEKITY_BASE_URL=https://blog.example.com

# The port on 127.0.0.1 the reverse proxy connects to. Defaults to 3000.
# GEEKITY_HOST_PORT=3000
```

If `GEEKITY_TAG` or `GEEKITY_BASE_URL` is missing, compose refuses to start the
stack and names the missing variable.

The compose file sets three variables itself. Its values take precedence over
the `.env`:

| Variable              | Value  | Why                                                                       |
| --------------------- | ------ | ------------------------------------------------------------------------- |
| `GEEKITY_BASE_URL`    | `.env` | Passed through, so compose can refuse to start without it.                |
| `GEEKITY_TRUST_PROXY` | `true` | The client address comes from the proxy's `X-Forwarded-For`.              |
| `GEEKITY_PORT`        | `3000` | The port mapping and the health check assume it. Use `GEEKITY_HOST_PORT`. |

The image sets `GEEKITY_CONTENT_DIR`, `GEEKITY_DATA_DIR`, `GEEKITY_THEMES_DIR`
and `GEEKITY_SEED_CONTENT`. Do not change them. You can put any other setting
in [Configuration](configuration.md) in the `.env`, for example
`GEEKITY_UPLOAD_MAX_BYTES` or `GEEKITY_IMAGE_FORMATS=webp,avif`. Set mail,
comments and the rest of the site settings in the admin.

### 3. Start it and point the proxy at it

Deploy the stack in dockge, or:

```sh
docker compose up -d
docker compose ps       # (healthy) once /healthz answers 200
```

The port is published on `127.0.0.1` only. Do not change the mapping to
`3000:3000`. Docker writes its own firewall rules ahead of ufw and firewalld. A
port published on every interface is reachable from the internet even when the
firewall is closed. A client that connects to it directly can put any address
in `X-Forwarded-For`.

The proxy forwards to `http://127.0.0.1:3000`. Geekity reads the **first**
address in `X-Forwarded-For`. The proxy must replace that header with the
address it saw. It must not append to a header the client sent. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 200m;  # at least GEEKITY_UPLOAD_MEDIA_MAX_BYTES
}
```

Set the proxy's body limit to at least the larger of
`GEEKITY_UPLOAD_MAX_BYTES` and `GEEKITY_UPLOAD_MEDIA_MAX_BYTES`, which is
200 MiB by default. Otherwise the proxy refuses an episode with a 413 before
Geekity sees it. Proxy limits:

- nginx defaults to 1 MiB.
- Caddy sets no limit unless the site block has
  `request_body { max_size 200MB }`.
- Cloudflare's free plan stops at 100 MB, whatever the origin allows. Upload a
  larger episode to the server directly.

Geekity compresses its own text responses with brotli or gzip, so the proxy
does not need to. If the proxy also compresses (nginx with `gzip on`, Caddy
with `encode`, or a CDN such as Cloudflare), add `GEEKITY_COMPRESSION=false` to
the `.env`. Each response is then compressed once, by the proxy. Leave
compression on when the proxy only forwards, as the nginx block above does.

Point an uptime monitor at `GET /healthz`. See
[Health check](public-site.md#health-check).

### 4. Sign in for the first time

A site with no users redirects `/admin` to `/admin/setup`. The first visitor
to that screen creates the admin account. Create it as soon as the site is
reachable.

To create the account from the server instead, and close the setup screen
before anyone else reaches it, run:

```sh
docker compose exec geekity geekity user add ada --email ada@example.com
```

The command prompts for the password and does not echo it. Run it from the
stack directory, where `docker compose exec` finds the container by its service
name, `geekity`. Plain `docker exec -it <container> geekity user add ada` also
works. The command writes `data/users.json` through the same mount as the
server, and the new account can sign in at once.

### 5. Bring a WordPress author across

[Moving a site from the WordPress ActivityPub plugin](federation.md#moving-a-site-from-the-wordpress-activitypub-plugin)
describes the cutover. In a container, install the WordPress plugin and create
the user first. Pass the exported key pair on standard input, so no copy of the
private key stays inside the container:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-wordpress
docker compose exec geekity geekity user add ada
docker compose exec -T geekity geekity import wordpress-actor ada \
  --actor-id 'https://blog.example.com/?author=2' \
  --wordpress-id 2 \
  --keypair /dev/stdin < ada.keypair.json
shred -u ada.keypair.json
```

`-T` stops compose from allocating a terminal. A terminal would swallow the
redirected file. By default, the import fetches the followers from the plugin on
the actor id's origin. To use a saved followers file, copy it in first:

```sh
docker compose cp followers.json geekity:/tmp/followers.json
```

and then passed as `--followers /tmp/followers.json`.

### Reading the logs

The container writes only to stdout. The image has no log file and nothing to
rotate. Docker collects the output, and dockge shows it. From the stack
directory:

```sh
docker compose logs -f              # follow everything, boot lines included
docker compose logs -t --since 1h   # the last hour, with Docker's timestamps
docker compose logs | grep webfinger
```

The image runs `geekity serve`, so [the access log](configuration.md#the-access-log)
is on. It writes one line per request, such as `GET /path?query 200 4.2ms`. Use
it to check whether a Mastodon instance looked up the site.
`docker compose logs | grep webfinger` shows each lookup and its status. The
health check polls `/healthz` every 60 seconds and adds a line each time. To
drop those lines, add `grep -v healthz`.

The client address is not logged by default. To log it, add
`GEEKITY_ACCESS_LOG_ADDRESS=true` to the `.env` and redeploy. The compose file
already sets `GEEKITY_TRUST_PROXY` to `true`, so the log shows the visitor's
address, not the proxy's. `GEEKITY_ACCESS_LOG=false` turns the log off.

### Backups

Everything the site cannot rebuild is under the stack directory.
[Two directories](content.md#two-directories-content-and-data) has the full
list. Back up:

- **All of `content/`**: posts, pages, uploads, `site.json`, followers, the
  inbox log and comments.
- **`data/`, apart from what is derived.** `data/users.json` holds the
  accounts, and `data/keys/` holds the key pairs every follower has cached.
  These two matter most. Losing the keys breaks federation. The rest
  (`mail.json`, `akismet.json`, `contact/`, `comment-salt`,
  `notification-secret` and the other small files) holds credentials and
  records that the site also cannot rebuild.
- **`compose.yaml` and `.env`**, so the stack can be recreated.

`data/geekity.db` (with `-wal` and `-shm`), `data/images/` and `data/avatars/`
are derived. You do not need to copy them. The site rebuilds the database on
the next start, and an image variant the next time a client requests it.

The site writes a file by renaming a finished copy over the old one. A backup
taken while the site runs therefore gets whole files. If the backup must
capture one moment, stop the stack first. For example:

```sh
tar -C /opt/stacks -czf geekity-$(date +%F).tar.gz \
  --exclude='geekity/data/geekity.db*' --exclude='geekity/data/images' \
  --exclude='geekity/data/avatars' geekity
```

To restore, unpack the archive into `/opt/stacks`, check that uid 1000 still
owns `content/` and `data/`, and start the stack.

### Upgrading and rolling back

Every published version is a tag. See
[Publishing the Docker image](development.md#publishing-the-docker-image). To
upgrade, set `GEEKITY_TAG` in the `.env` to the new version and redeploy. In
dockge, press Save, then Deploy. With plain compose, run:

```sh
docker compose pull
docker compose up -d
```

Database migrations run on start, so no other step is needed. Before you
upgrade, read the [changelog](../packages/cms/CHANGELOG.md) for the versions in
between. Each breaking change has a note there.

An upgrade never deletes a visitor's data. The site keeps commenter emails,
address hashes and contact messages until the site owner sets a retention
period on **Settings > Discussion**. See
[Personal data](personal-data.md#retention).

You can also set `GEEKITY_TAG=latest`. Every push moves that tag, so an upgrade
is `pull` and `up -d` with nothing to edit. The cost is that the `.env` does
not show which version the site runs, so a rollback starts by finding the
version. Run `docker compose exec geekity geekity --version` to print it. If
the site matters, pin the version. The version tags stay published either way.

To roll back, set `GEEKITY_TAG` to the version you came from and redeploy the
same way. If the newer version migrated the database, the older version refuses
to start. It logs that a newer `@geekity/cms` wrote the database. The logs in
dockge, or `docker compose logs`, show the message. The database is a cache, so
rebuild it with the old version. The admin cannot do this rebuild, because no
site is running:

```sh
docker compose stop
docker compose run --rm geekity geekity rebuild
docker compose start
```

`geekity rebuild` refuses to run while the server has the database open, so
`docker compose exec` does not work. The one-off container from `run` uses the
same image, `.env` and mounts while the server is stopped. A rebuild signs
everyone out.
[What else it costs](content.md#what-is-in-the-database-and-what-a-rebuild-costs)
is listed in Content. The same three commands fix a damaged database.

**Do every other rebuild in the admin.** The index and the content files can
fall out of step when someone edits content over ssh, runs `git pull` while the
stack is down, or restores one of the two from a backup. In that case,
**Tools > Content index**
[reads every file again on the running site](content.md#rebuilding-the-index-from-the-admin).
It does not stop the stack, needs no one-off container, signs no user out and
has none of the cost listed above. In a container the server is PID 1, so
`docker exec <container> geekity rebuild` never works. The admin always does.

### A custom theme

When `content/_data/site.json` has no `theme`, the site uses the default theme
that ships in the image. To use your own theme:

1. Create `themes/` in the stack directory and put the theme in it, one
   directory per theme with a `theme.json` in it (see [Themes](themes.md)):

   ```sh
   mkdir -p themes
   cp -r ~/my-theme themes/my-theme
   sudo chown -R 1000:1000 themes
   ```

2. Uncomment the `./themes:/site/themes:ro` line under `volumes` in
   `compose.yaml` and redeploy. The site only reads this directory, so the
   mount is read-only.
3. In the admin, choose the theme on **Appearance > Themes**. This writes
   `theme` into `site.json`. The change takes effect on the next request.

A theme can replace a single template or `style.css` and use the default theme
for everything else.

## Dev mode

To build or migrate a site, you run it with production data: the real base
URL, the real actor and keys, real followers and real links. Dev mode stops
that site from sending anything until you take it live (decision-35). While dev
mode is on, the site sends none of these:

- No ActivityPub delivery to followers or relays, no relay `Follow` or `Undo`,
  and no `Accept` or `Reject` in answer to an inbox. This applies whatever
  caused the change: the watcher, the admin, the scheduler, `geekity resend` or
  an arriving reply context.
- No webmention. Endpoint discovery is skipped too.
- No rssCloud or WebSub ping.
- No IndexNow submission.
- No email.

Reads still go out: reply contexts and cited pages, actor profiles, oEmbed,
avatars, the check of an incoming webmention, and a plugin's `host.fetch`. A
read tells no other server about the site. Without reads, the site cannot show its
replies or profiles.

The site accepts inbound federation. It stores follows, replies, likes and
webmentions as a live site does, and holds the `Accept` for a follow. Plugins
need no switch of their own. A plugin's federation hands what it receives to
the site's inbox, so the site holds its answers the same way.

Each held side effect is a line in `data/dev-mode.jsonl`. The line records
when, what kind, what the site would have sent, and to whom. Tools > Dev mode
in the admin lists the lines, newest first. Every admin screen shows a banner
while the mode is on, and `geekity serve` prints a notice when it boots.

Tools > Dev mode also has a switch that turns the mode on and takes the site
live. It does what `geekity dev-mode on` and `off` do, and the record says
which of them was used.

```sh
$ geekity dev-mode on
Dev mode is on: nothing the site does is sent until `geekity dev-mode off`.
$ geekity dev-mode status
Dev mode is on.
$ geekity dev-mode off
Dev mode is off: the site is live. Nothing held while it was on will be sent.
```

The mode is the setting `dev_mode.on`, stored in `data/dev-mode.json` as
`{ "on": true }` (see [Runtime settings](settings.md#runtime-settings)). A file
written by an older version, where the file being there meant on, is still read
as on.

`devMode: true` in the config, or `GEEKITY_DEV_MODE=true`, starts a site in
dev mode. Boot sets `dev_mode.on` to true, and the stored value keeps the mode
on from then on. The variable is a latch, not an override: removing it does not
take the site live. Only `geekity dev-mode off` or the admin switch does. Both
refuse while the config or the environment still sets dev mode, because the
next boot would turn it on again. There is no `GEEKITY_DEV_MODE__ON`.

The running site reads the setting before every send, so going live needs no
restart. Going live adds a line to the record, with who did it: the command or
the admin switch.

Going live replays nothing. The site drops each held side effect. It does not
queue it, and it does not record a delivery or webmention as failed. Neither
the Federation screen nor `geekity resend` offers it again. A post announced
while the mode was on counts as announced, so its next edit goes out as an
`Update`. A relay added while the mode was on stays pending. Press Retry on the
Federation screen after the site is live.

The site also holds password recovery mail, so in dev mode, reset a password
from the shell. A peer that followed while the mode was on never got its
`Accept`, and must follow again.

### Dev mode on Docker

Set the variable in the service's environment before the first boot. The
container then never starts live:

```yaml
services:
  geekity:
    environment:
      GEEKITY_DEV_MODE: 'true'
```

To go live, remove the variable and recreate the container. The file in the
`data` volume keeps the mode on through the restart. Then turn the switch off at
Tools > Dev mode, or run:

```sh
docker compose exec geekity geekity dev-mode off
```

`geekity dev-mode status` in the same container prints the site's state. The
record is in the `data` volume at `data/dev-mode.jsonl`.
