# The `geekity` command

`geekity` is installed as a bin. Inside a site, run it with
`pnpm geekity <command>`, with `npx geekity`, or from a `package.json` script.
The generated `sync` script calls it the third way.

| Command                                   | What it does                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geekity serve`                           | Boot from the config file and listen. The CMS runs in a worker that the command supervises. A change to the plugins folder replaces the worker, and a crash respawns it. The default command. |
| `geekity init <dir>`                      | Create a new site in `<dir>`. Refuses a directory that is not empty.                                                                                                                          |
| `geekity sync`                            | Rebuild the content index once and exit. Exits non-zero if any file could not be parsed.                                                                                                      |
| `geekity rebuild`                         | Delete `data/geekity.db` and build it again from the files.                                                                                                                                   |
| `geekity resend --all`, `<slug>...`       | Send announced posts again, as they read now, to every follower and relay. See [Quote posts](federation.md#quote-posts).                                                                      |
| `geekity maintenance on`, `off`, `status` | Take the public site down with a 503 and `Retry-After`, or bring it back, without a restart. `on --until <time>` sets when the site is due back.                                              |
| `geekity dev-mode on`, `off`, `status`    | Hold everything the site sends to the outside world while you build or migrate it, or take it live. See [Dev mode](deploying.md#dev-mode).                                                    |
| `geekity strip-metadata`                  | Remove location and camera metadata from files already in `content/uploads`. See [Location and camera metadata](media.md#location-and-camera-metadata).                                       |
| `geekity user add <name>`                 | Create an admin account. Use it to give a site its first login without the setup screen.                                                                                                      |
| `geekity plugin add <package>`, `remove`  | Install a plugin package's bundle from the npm registry into the plugins folder (`GEEKITY_PLUGINS_DIR`), or delete a disabled one. A running `geekity serve` reloads with the change.         |
| `geekity --help`, `-h`                    | Print this table on the terminal.                                                                                                                                                             |
| `geekity --version`                       | Print the installed version.                                                                                                                                                                  |

An installed plugin can add its own commands. `geekity --help` lists them
under _Plugin commands_. They run whether or not the plugin is enabled, and
this includes a plugin in the plugins folder. [Plugins and hooks](plugins.md)
describes `geekity plugin add` and how to write a plugin.

These commands take `--config <file>`: `serve`, `sync`, `rebuild`, `resend`,
`maintenance`, `dev-mode`, `strip-metadata`, `user add`, `plugin` and every
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
  folder every second, so a slow copy loads once, when it is complete. Set
  `GEEKITY_PLUGIN_WATCH=off` to turn this off.
- You press **Reload** on Admin > Plugins. The screen offers the button
  whenever the folder differs from what the running worker loaded. It names the
  folders added, removed and updated.

One reload runs at a time. A change made during a reload is loaded by a second
reload after the first. Each reload runs these steps in order:

1. The running worker stops taking writes. It answers GET and HEAD, and it
   answers any other method with `503` and `Retry-After: 5`. It lets the writes
   already in flight finish. Then it stops its timers, its watcher and its
   plugins.
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
