# The `geekity` command

`geekity` is installed as a bin. Inside a site, run it with
`pnpm geekity <command>`, with `npx geekity`, or from a `package.json` script.
The generated `sync` script calls it the third way.

| Command                                   | What it does                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `geekity serve`                           | Boot from the config file and listen. The CMS runs in a worker that the command supervises. A change to the plugins folder replaces the worker, and a crash respawns it. The default command.                      |
| `geekity init <dir>`                      | Create a new site in `<dir>`. Refuses a directory that is not empty.                                                                                                                                               |
| `geekity sync`                            | Rebuild the content index once and exit. Exits non-zero if any file could not be parsed.                                                                                                                           |
| `geekity rebuild`                         | Delete `data/geekity.db` and build it again from the files.                                                                                                                                                        |
| `geekity resend --all`, `<slug>...`       | Send announced posts again, as they read now, to every follower and relay, as the same job the federation screen queues. See [Quote posts](federation.md#quote-posts).                                             |
| `geekity maintenance on`, `off`, `status` | Take the public site down with a 503 and `Retry-After`, or bring it back, without a restart. `on --until <time>` sets when the site is due back.                                                                   |
| `geekity dev-mode on`, `off`, `status`    | Hold everything the site sends to the outside world while you build or migrate it, or take it live. See [Dev mode](deploying.md#dev-mode).                                                                         |
| `geekity settings list`, `get`, `set`     | Print, read or change the runtime settings, such as `maintenance.on`, and each running plugin's settings, with where each value comes from. See [Runtime settings](settings.md#runtime-settings).                  |
| `geekity settings migrate-plugins`        | Move plugin settings out of `content/_data/site.json` into `data/plugins/<name>/settings.json`. A server does this when it starts. See [Plugin settings](configuration.md#moving-plugin-settings-out-of-sitejson). |
| `geekity strip-metadata`                  | Remove location and camera metadata from files already in `content/uploads`, as the same job the Media screen queues. See [Location and camera metadata](media.md#location-and-camera-metadata).                   |
| `geekity export`                          | Write `content/` and the files in `data/` that the site cannot rebuild to a `.tar.gz`, with a manifest. It runs while the site serves. See [Exporting a site](#exporting-a-site).                                  |
| `geekity import <file>`                   | Restore a site from an archive that `geekity export` wrote, with the site stopped. It installs the folder plugins the archive names from the npm registry. See [Importing a site](#importing-a-site).              |
| `geekity user add <name>`                 | Create an admin account. Use it to give a site its first login without the setup screen.                                                                                                                           |
| `geekity plugin add <package>`, `remove`  | Install a plugin package's bundle from the npm registry into the plugins folder (`GEEKITY_PLUGINS_DIR`), or delete a disabled one. A running `geekity serve` reloads with the change.                              |
| `geekity --help`, `-h`                    | Print this table on the terminal.                                                                                                                                                                                  |
| `geekity --version`                       | Print the installed version.                                                                                                                                                                                       |

An installed plugin can add its own commands. `geekity --help` lists them
under _Plugin commands_. They run whether or not the plugin is enabled, and
this includes a plugin in the plugins folder. [Plugins and hooks](plugins.md)
describes `geekity plugin add` and how to write a plugin.

These commands take `--config <file>`: `serve`, `sync`, `rebuild`, `resend`,
`maintenance`, `dev-mode`, `settings`, `strip-metadata`, `export`, `import`, `user add`, `plugin` and every
plugin command. Without the option, they look in the working directory for
`geekity.config.ts`, then `geekity.config.js`, then `geekity.config.mjs`. If
none exists, they run on defaults.

`sync` prints what the scan did. It always turns watching off, whatever the
config says, so that the command exits after one scan:

```sh
$ geekity sync
Scanned 12: 2 created, 1 updated, 0 removed, 9 unchanged, 0 failed
```

`sync` logs a file that does not parse, leaves it out of the index and counts
it in `failed`. The command then exits `1`, so a deploy step can detect the
failure. Every other file in the directory is still indexed.

## When the job is already running

`strip-metadata` and `resend` run the same job that a button on the admin
queues. Before a command starts its job, it looks in `data/jobs.json` for a job
of the same name. The command starts nothing and exits `1` when it finds one of
these:

- A job that a running process is still running, from the admin or from
  another command.
- A job that is queued while a `geekity serve` for the same data folder
  answers on its control socket. That server runs the queued job.

The command prints the reason on stderr:

```sh
$ geekity strip-metadata
A strip-metadata job is already running, so this one did not start. Run the command again once it finishes.
```

Run the command again when the job is finished. The Media screen and the
federation screen show the job's progress.

The command runs its own job in these cases:

- The process that was running the job has stopped. A server runs that job
  again when it next looks for jobs that a stopped process left. Both jobs are
  safe to run twice.
- A job is queued, but no server answers. A command that stopped before it
  started its job can leave a queued job. The next server to start runs that
  job.

## How `geekity serve` runs

A site that adds no code of its own can skip the entry file and run the bin:

```sh
geekity serve --config geekity.config.ts
```

`geekity serve` is a small supervisor. It owns the port and runs the CMS in one
worker process. If the worker crashes, the supervisor respawns it after a delay
that grows with each crash. The supervisor replaces the worker with a new one,
which is a reload, when one of these events happens:

- A change on Admin > Plugins (Add, Update, Update all or Remove) finishes. The
  screen then shows the change and that the plugins reloaded.
- `geekity plugin add`, `upgrade` or `remove` finishes a change. The command
  sends the request to the supervisor over a Unix socket in the system temp
  folder. The socket is named after the site's data folder. The command prints
  how the reload went, or says that no supervisor answered.
- The plugins folder (`pluginsDir`) differs from what the running worker
  loaded, and it has not changed for five seconds. The supervisor reads the
  folder every second, so a slow copy loads once, when it is complete. It
  prints a line when it first sees the folder change, and a line when the
  folder settles as it was when its last reload failed, which it leaves alone
  until the folder changes again. Set `GEEKITY_PLUGIN_WATCH=off` to turn this
  off. The supervisor then says at start that the folder is not watched.
- You press **Reload** on Admin > Plugins. The screen offers the button
  whenever the folder differs from what the running worker loaded. It names the
  folders added, removed and updated.

One reload runs at a time. A change made during a reload is loaded by a second
reload after the first. Each reload runs these steps in order:

1. The running worker stops taking writes. It answers GET and HEAD, and it
   answers any other method with `503` and `Retry-After: 5`. It lets the writes
   already in flight finish, and prints how many it waits for. Then it stops
   its timers, its watcher and its plugins.
2. The running worker sends what its queues hold and stops writing to the
   database, `data/` and `content/`.
3. A new worker boots, runs the boot migrations alone and starts listening.
4. The old worker stops accepting connections. It exits when its open
   connections end.

The port stays open the whole time, so no request is refused. If a request
still reaches the old worker after step 4, the old worker redirects it to the
same address, and the new worker answers. If the new worker fails to boot, the
old worker keeps running and the Plugins screen shows the error. The supervisor
does not retry the same folder on its own. It waits for the folder to change.
Press Reload to retry at once.

SIGTERM and SIGINT close the worker the same way `close()` does. The supervisor
then exits 0.

## Starting the database again

`geekity rebuild` deletes `data/geekity.db`, with its `-wal` and `-shm` files.
It then builds a new database the same way a boot does: the same migrations,
the same scan of `content/` and the same read of `content/_data/federation/`.
Last, it prints what it indexed:

```sh
$ geekity rebuild
Rebuilt /srv/blog/data/geekity.db from the files.
Scanned 214: 214 created, 0 updated, 0 removed, 0 unchanged, 0 failed
Indexed 37 followers and 1,204 inbox activities.
```

Everything in the database is derived from `content/` and `data/`. The command
has no undo, and it loses no data.
[What a rebuild does cost is listed in Content](content.md#what-is-in-the-database-and-what-a-rebuild-costs).
Use it when this version refuses to open the database, for example a damaged
database or one written by a newer `@geekity/cms`.

The command refuses to run while the site is running. If it deleted the file
under a live server, the server would write to a database that no other
process can find. Stop the site first. A file that does not parse is reported,
and the command exits `1`, as `sync` does.

For the usual repair, use
[**Tools > Content index**](content.md#rebuilding-the-index-from-the-admin) in
the admin instead. It rebuilds the index in place on the live site, with no
downtime, and no user is signed out. Use the command only when this version
refuses to open the database. In that case no site is running, so the admin
screen is not available.

## Exporting a site

`geekity export` writes the site to one gzipped tar file:

```sh
$ geekity export
2 deliveries are waiting in data/queue.sqlite. They are not exported: before a move, wait until none are.
The archive holds actor keys, password hashes and personal data. Store it as carefully as data/.
Credentials left out: mail. --with-credentials includes them.
Wrote /srv/blog/geekity-blog.example-20261014T150405Z.tar.gz: 412 files, 18204113 bytes.
```

The file is named `geekity-<host>-<yyyymmdd>T<hhmmss>Z.tar.gz` and is written
in the working directory, unless `--out <file>` names another path. It is
written at mode `0600`.

The archive holds these entries, in this order:

1. `manifest.json`.
2. `content/`, apart from scratch files: the `.tmp` files of writes in
   progress, lock files and the watcher's `.geekity-watch-*` probe.
   `--without-content` leaves `content/` out.
3. Each file under `data/` whose class is `kept`, such as `users.json`, the
   actor keys in `keys/`, `notification-secret` and the comment emails.

Each file keeps its mode, so a `0600` file in `data/` is `0600` in the
archive. A `rebuildable`, `pending` or `scratch` file is never in the archive.
For example, `geekity.db`, the image variants and `queue.sqlite` are not
exported. `geekity export --list` prints each pattern that `data/` can hold,
its class and what is lost without it. It writes nothing.

A `credential` file holds an API key or a login that is typed in again from
another service: `mail.json`, `akismet.json` and each plugin's
`secrets.json`. These files are in the archive only with
`--with-credentials`. Credentials set in the environment are not in a file, so
they are never exported.

`manifest.json` records:

| Field                | What it holds                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `format`             | The archive format, `1`.                                                                                                           |
| `cms`                | The `@geekity/cms` version that wrote it.                                                                                          |
| `exportedAt`         | When it was written.                                                                                                               |
| `baseUrl`            | The base URL in effect.                                                                                                            |
| `content`            | Whether `content/` is in the archive.                                                                                              |
| `credentials`        | Whether credential files are in the archive.                                                                                       |
| `devMode`            | Whether the site was in dev mode.                                                                                                  |
| `files`              | Each file after the manifest: its path in the archive, its class (`kept` or `credential`), its size and its SHA-256.               |
| `undeclared`         | Files under `data/` that no declaration covers. They are not in the archive.                                                       |
| `notCarried`         | Each entry under `content/` that is not a regular file, such as a symbolic link, with `why`, what it is. It is not in the archive. |
| `credentialsLeftOut` | The settings namespaces and plugins whose credential files held something and were left out.                                       |
| `plugins`            | Each installed plugin: its name, version, `source` (`folder` for the plugins folder, `config` for the site config) and `enabled`.  |
| `overrides`          | Each setting that the environment or the config overrides, with the variable or config field. The value is not recorded.           |
| `pending`            | `deliveries`, the number of messages waiting in `data/queue.sqlite`, and the number of `queued` and `running` jobs in `jobs.json`. |

No plugin code is in the archive.

The command only reads, so it runs while the site serves. It runs no
migration and opens no database except `queue.sqlite`, which it reads with a
read-only connection to count the waiting deliveries. Each writer under
`data/` and `content/` replaces its file by a rename, so each file in the
archive is a complete file. The archive is not a snapshot of one instant: two
files can come from either side of a change that writes both.

The deliveries in `queue.sqlite` belong to the host that queued them, and they
are never exported. The command prints their number before it writes. Before
you move a site, wait until the number is 0.

A file in `data/` that no declaration covers is left out, and the command
names it on standard error. This is usually a file that a plugin or a script
wrote without a declaration.

The archive holds only regular files. A symbolic link under `content/` is left
out, and so are a socket, a FIFO and a device. The command names each one on
standard error and the manifest lists it in `notCarried`. A link to a folder
is not followed, so the files it points to are not exported through it. To
export what a link points to, replace the link with a copy of the file or
folder before you export.

The admin writes the same archive from
[Tools > Export](admin.md#tools--export), as a background job, and offers it
as a download. Import has no admin screen: run `geekity import`.

## Importing a site

`geekity import <file>` restores a site from an archive that `geekity export`
wrote. Run it with the site stopped, from the site's directory, with the
config and environment the site will run with:

```sh
$ geekity import geekity-blog.example-20261014T150405Z.tar.gz
Restored 412 files from /srv/blog/geekity-blog.example-20261014T150405Z.tar.gz.
Installed @geekity/plugin-llm 1.2.0.
Rebuilt /srv/blog/data/geekity.db from the files.
Scanned 120: 120 created, 0 updated, 0 removed, 0 unchanged, 0 failed
Indexed 34 followers, 210 inbox activities and 58 comments.
Type these credentials in again, which the export left out: mail.
Everyone signs in again: sessions are not exported.
```

The command does these steps in this order:

1. It refuses to run while the site runs. It uses the same checks as
   `geekity rebuild`: the database is open, or a `geekity serve` answers on
   its control socket.
2. It reads `manifest.json`, the first entry. It refuses an archive whose
   `format` is newer than this version reads.
3. It refuses when `content/` or `data/` already holds a file that is not
   scratch. With `--replace`, it continues, and step 6 moves what those
   folders hold aside. With an archive made `--without-content`, only `data/`
   is checked and replaced.
4. It unpacks the archive into a `.geekity-importing/` folder inside
   `content/` and inside `data/`. It treats the archive as untrusted: it
   refuses a link, a folder entry, a device, an absolute path, a `..`
   segment, a name outside `content/` and `data/`, a name that the import
   uses itself (`.geekity-import`, `.geekity-importing` and
   `.geekity-before-import-*`), a file the manifest does not list, and a file
   whose size or SHA-256 differs from the manifest. On a refusal it removes
   the staging folders and leaves the site's files as they were. A file in
   `data/` whose class on this site is not `kept` or `credential`, such as a
   `geekity.db` added by hand, is left out and named on standard error.
5. It compares the base URL in effect with the archive's `baseUrl`. The base
   URL in effect is `GEEKITY_BASE_URL` or `baseUrl` in the config, else the
   `url` in the imported `site.json`. When they differ, it refuses, because
   actor ids are built from the base URL and followers would not follow the
   site to a new address. `--new-base-url` imports the site at the base URL in
   effect.
6. It moves the staged files into place. With `--replace`, it first moves
   every entry that `content/` or `data/` holds into
   `.geekity-before-import-<yyyymmdd>T<hhmmss>Z/` inside the same folder.
   Without `--replace`, it deletes only scratch files, such as a stale
   `.tmp` file. Every move stays inside the folder, so `content/` and `data/`
   themselves are never renamed or removed. This is why the import works
   when they are mount points, as on Docker.
7. With `--dev-mode`, it turns dev mode on. Use this for a staging copy of a
   live site. Without it, the site keeps the dev mode it was exported in,
   because `data/dev-mode.json` is in the archive.
8. It installs each `folder` plugin in the manifest from the npm registry
   (`npm_config_registry`, or registry.npmjs.org) into the plugins folder, at
   the version the manifest records, as `geekity plugin add` does. It then
   makes each plugin's enabled state the manifest's. A `config` plugin is not
   installed: it comes with the new host's config.
9. It rebuilds `data/geekity.db`, as `geekity rebuild` does.
10. It prints what is left to do: each setting that the environment or the
    config set on the old site, each credential the export left out, each
    `config` plugin to check in the new config, and that everyone signs in
    again.

The archive's plugin files under `data/plugins/<name>/` are unpacked before
the plugins are installed, so they are classed as the files of a plugin that
is not loaded: `secrets.json` is a credential, and every other file is kept.
The export already left out the plugin's rebuildable files.

When a plugin cannot be installed, the import goes on. The reason can be that
the registry cannot be reached, the recorded version is no longer published,
the integrity check fails, the version needs a newer `@geekity/cms`, or no
plugins folder is set. The data is still restored, the database is rebuilt
and every other plugin is installed. The failed plugin keeps its enabled
state. The command never installs another version. At the end it prints one
line per failed plugin on standard error, with the reason and the command to
retry, such as `geekity plugin add @geekity/plugin-llm@1.2.0`.

| Exit code | Meaning                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `0`       | The site is restored and every `folder` plugin is installed.                                             |
| `1`       | The import was refused and nothing changed, or the site is restored but a plugin could not be installed. |

An import that was stopped part way leaves a `.geekity-importing/` folder, a
`.geekity-import` marker file, or a `.geekity-before-import-*` folder that is
not yet complete, inside `content/` or `data/`. Run the same import again,
with the same flags: it removes the staging folder, moves any entries still
left into the same `.geekity-before-import-*` folder, and finishes with the
same result as an import that was not stopped. The marker is removed when an
import finishes.

### Getting the old site back

`--replace` deletes nothing. What `content/` held is in
`content/.geekity-before-import-<yyyymmdd>T<hhmmss>Z/`, and what `data/` held
is in `data/.geekity-before-import-<yyyymmdd>T<hhmmss>Z/`. The command prints
both paths. The site ignores these folders: the content scan skips folders
whose name starts with a dot, and `geekity export` leaves them out. To go
back, stop the site, delete everything else in the folder, and move the
entries of the `.geekity-before-import-*` folder up one level. When the
imported site works, delete the folders to free the space. They hold the old
site's keys and personal data.

### Importing on Docker

The image mounts `content/` and `data/` at `/site/content` and `/site/data`.
Run the import in a one-off container of the same service, with the site
stopped, and mount the archive into it read-only. Do not put the archive in
`data/` or `content/`, because the import moves or deletes what those folders
hold. From the stack directory:

```sh
docker compose stop geekity
docker compose run --rm -v ./geekity-blog.example-20261014T150405Z.tar.gz:/tmp/site.tar.gz:ro \
  geekity geekity import /tmp/site.tar.gz
docker compose start geekity
```

The one-off container reads the same `.env`, so the base URL check uses
`GEEKITY_BASE_URL`. A stack that has already started once has the starter
site in `content/`, so give `--replace`, and the starter site is moved to
`content/.geekity-before-import-*/`. The plugins are installed into
`/site/plugins`, so the container needs to reach the npm registry.

To make the archive on the old Docker host, write it inside the container and
copy it out:

```sh
docker compose exec geekity geekity export --out /tmp/site.tar.gz
docker compose cp geekity:/tmp/site.tar.gz ./site.tar.gz
```

## Creating an admin from the command line

`geekity user add <username>` writes a user directly into `data/users.json`.
Use it to create the first login on a site that cannot reach `/admin/setup`
from a browser, such as a headless deploy or a server behind a bastion. It is
also the way back into a site that has locked out every user and cannot send
email. It applies the same rules as the setup form:

- The username is 1 to 64 letters, digits, dots, dashes or underscores.
- The password is at least 8 characters.

```sh
$ geekity user add ada
Password for ada:
Created admin user ada. Sign in at /admin/login.
```

The prompt does not echo. When standard input is not a terminal, the command
prints no prompt and reads the password as a single line. A script can pipe the
password in:

```sh
printf '%s\n' "$ADMIN_PASSWORD" | geekity user add ada
```

`--password <pw>` passes the password inline. This is the least private of the
three ways. A password on the command line is visible in the process list and
is saved in shell history.

`--email <address>` sets an address on the new user. The address is optional.
[Password recovery](security.md#forgotten-passwords) sends mail to it:

```sh
$ geekity user add ada --email ada@example.com
Password for ada:
Created admin user ada (ada@example.com). Sign in at /admin/login.
```

The command refuses a name that is already taken, an illegal username, a short
password and an invalid address. It writes nothing, prints the reason and exits
`1`.

After the first user can sign in, use the
[`/admin/users` screen](admin.md#users) instead. It adds users, generates
passwords and deletes users. Each user's own screen under it edits the rest of
the account.

## How a TypeScript config is loaded

`geekity serve` and `geekity sync` import `geekity.config.ts` directly. Node 24
strips types without a flag, so nothing else is needed. Type stripping cannot
erase some syntax, such as `enum`. For a config that uses it, the CLI registers
the **tsx installed in your own site** instead. `geekity init` puts tsx in
`devDependencies`, and tsx also runs `server.ts`. A site that wants neither can
write `geekity.config.js` instead. That file is in the lookup list for this
reason. The CLI searches nowhere else. It uses only the site's own tsx, never a
copy installed elsewhere on the machine.
