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

`geekity export` writes a smaller backup that holds only what the site cannot
rebuild, and `geekity import` restores it. See
[Back up and move a site](#back-up-and-move-a-site).

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

## Back up and move a site

`geekity export` writes `content/` and the files in `data/` that the site
cannot rebuild to one archive. `geekity import` restores a site from it on
another host, or on the same host after a loss. This section gives the order
of the steps for a move. [Exporting a site](cli.md#exporting-a-site) says what
the archive holds, and [Importing a site](cli.md#importing-a-site) says what
the import does, step by step.

Keep the base URL. Actor ids are built from it, so followers do not follow a
site to a new address. Move the site to the new host under the same address,
and point DNS at the new host at the end. `geekity import` refuses a base URL
that differs from the archive's unless you give `--new-base-url`.

### Before the move

- Lower the TTL of the site's DNS records a day or more before the move, so
  that the change at the end reaches clients quickly.
- Set up the new host with the config and environment the site will run with.
  `GEEKITY_BASE_URL`, or `baseUrl` in the config, is the old site's base URL.
  Copy every other setting that the old host sets in its environment or config,
  credentials included. The import prints the names of those settings, but not
  their values.
- Give the new host a plugins folder (`GEEKITY_PLUGINS_DIR`, or `pluginsDir` in
  the config) and access to the npm registry. The import installs the site's
  plugins from there.
- Add each plugin that the old site's config names to the new host's config and
  `package.json`. The import does not install these.
- Do not start the site on the new host yet. On Docker, the first start writes
  the starter site into `content/`, and the import then needs `--replace`.

### 1. Drain the queue on the old host

Deliveries, inbox work and retries that wait in `data/queue.sqlite` belong to
the host that queued them. They are never in an archive, so let them finish
before you export:

1. Turn on [maintenance mode](public-site.md#maintenance-mode) with
   `geekity maintenance on` or Tools > Maintenance. Every public URL, the
   ActivityPub inboxes included, then answers 503 to anyone who is not signed
   in, so visitors' comments and inbox activities stop arriving. A fediverse
   server whose delivery was refused tries again later. Maintenance mode does
   not stop the deliveries already waiting. The admin stays open.
2. Wait until the number of waiting messages is 0.
   [Tools > Export](admin.md#tools--export) shows it when the page loads.
   `geekity export` prints it before it writes.

A delivery to a server that is down stays in the queue between attempts, and
Fedify can wait up to 12 hours between two attempts. If the number stops
going down, you can export anyway. Those deliveries are lost, and the
manifest's `pending.deliveries` records how many there were.

Do not change anything on the old site from here on. The admin works in
maintenance mode, but a post, a setting or a user that changes after the export
is not in the archive.

### 2. Export

Run `geekity export` in the site directory, or use Tools > Export in the
admin and download the archive. On Docker, write the archive inside the
container and copy it out, as
[Importing on Docker](cli.md#importing-on-docker) shows.

Decide whether to include credentials: `--with-credentials`, or
**Include credentials** on Tools > Export. A credential is a key or login that
comes from another service: the mail login in `mail.json`, the Akismet key in
`akismet.json`, and each plugin's `secrets.json`. Without the option, these
files are left out, and you type them in again on the new host on
Settings > Email, Settings > Discussion and each plugin's settings screen. A
credential set in the old host's environment is never in a file, so it is
never exported. Set it in the new host's environment.

The archive holds the actor keys, the password hashes and personal data, with
or without credentials. Store and copy it as carefully as `data/`. See
[Site exports](personal-data.md#site-exports).

### 3. Stop the old site

Stop the old site, for example with `docker compose stop`. Leave its
`content/` and `data/` in place until the new host works. If the move fails,
start the old site again and turn maintenance mode off.

### 4. Copy the archive to the new host

Copy the archive with `scp` or another encrypted channel. Do not put it inside
the new host's `content/` or `data/`, because the import moves what those
folders hold.

The archive is mode `0600`. On Docker, the container runs as uid 1000, so give
the copy to that user before you mount it into the container:

```sh
sudo chown 1000:1000 geekity-blog.example-20261014T150405Z.tar.gz
```

### 5. Import on the new host

Run `geekity import <file>` in the site directory with the site stopped. On
Docker, run it in a one-off container, as
[Importing on Docker](cli.md#importing-on-docker) shows. The one-off container
reads the stack's `.env`, so the base URL check uses `GEEKITY_BASE_URL`.

If the import refuses the base URL, correct `GEEKITY_BASE_URL` or `baseUrl` on
the new host. Use `--new-base-url` only for a copy at another address, such as
a staging site, and never for the site its followers follow.

The import restores the files and rebuilds `data/geekity.db`. It installs each
plugin that the old site added to its plugins folder from the npm registry, at
the version the archive records, and enables or disables it as it was. It
never installs another version.

When it finishes, it prints what is left to do: the settings to set again in
the environment or config, the credentials to type in again, and the config
plugins to check.

| Exit code | What to do                                                                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | Nothing. The site is restored and every plugin is installed.                                                                                                                                                                      |
| `1`       | Read standard error. If the import was refused, nothing changed. Fix what it names and run it again. If a plugin could not be installed, the site is restored. Run the `geekity plugin add <name>@<version>` that the line names. |

A failed plugin keeps its enabled state, so once `geekity plugin add` installs
it, it runs as it did on the old site. Do not run the import again for a
plugin. A plugin that needs a newer `@geekity/cms` is installed but does not
run. Upgrade `@geekity/cms` on the new host first. On Docker, run the
command in a one-off container while the site is stopped:

```sh
docker compose run --rm geekity geekity plugin add @geekity/plugin-llm@1.2.0
```

If the import stops part way, run the same command again with the same flags.
It finishes the import that was stopped.

Dev mode comes back as it was exported. A site exported in dev mode is
imported in dev mode and sends nothing until `geekity dev-mode off`. Give
`--dev-mode` to import a staging copy of a live site in dev mode. See
[Dev mode](#dev-mode). Maintenance mode is not exported, so the imported site
starts with it off, unless the new host's environment or config turns it on.

### 6. Start the new site and point DNS at it

Start the site, for example with `docker compose up -d`. Check it on the new
host before you change DNS, for example with
`curl http://127.0.0.1:3000/healthz`. Then point the site's DNS records at the
new host.

Until every client sees the new records, some requests still go to the old
host, which is stopped. A fediverse server whose delivery fails tries again
later.

### 7. After the move

- **Everyone signs in again.** Sessions are in the database, which is not
  exported. The accounts and passwords are restored. A password reset link sent
  before the move no longer works.
- **Type in the credentials again.** Type in each credential that the export
  left out, and set again each setting the import named.
- **Announce the posts that came due during the move.** A post whose date fell
  between the export and the first start of the new site is published, but it
  is not announced to followers. Run `geekity resend <slug>` for each one after
  DNS points at the new host. It sends a `Create` for a published post that
  was never announced. On Docker, run
  `docker compose exec geekity geekity resend <slug>`. `geekity resend --all`
  does not reach these posts, because it resends only posts that were
  announced.
- **Delete what you no longer need.** Once the new site works, delete the old
  host's `content/` and `data/`, every copy of the archive, and the
  `.geekity-before-import-*` folders that `--replace` leaves inside `content/`
  and `data/`. They hold the keys and personal data.

The import keeps the fediverse identity: the actor ids, the keys and the
followers. IndieAuth apps stay signed in, and the links in mail already sent
keep working. The new site rebuilds the content, follower and comment indexes,
follows its relays again, and derives image variants and avatars again when
they are needed.

What the move loses:

- Sessions and password reset links in flight.
- The delivery history. The federation screen starts with nothing recorded.
- The record of sent webmentions, so a link removed later does not notify the
  page it pointed to.
- Announcements of posts that came due during the move, until you resend them.
- Deliveries still waiting when the export ran.
- Credentials, unless the archive includes them.
- Anything that changed on the old site after the export.

[What is in the database, and what a rebuild costs](content.md#what-is-in-the-database-and-what-a-rebuild-costs)
lists each table that the rebuild starts empty.

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
