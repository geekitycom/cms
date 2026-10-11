# The `geekity` command

`geekity` is installed as a bin, so `pnpm geekity <command>` runs it inside a
site (or `npx geekity`, or a `package.json` script, which is how the generated
`sync` script calls it).

| Command                                   | What it does                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geekity serve`                           | Boot from the config file and listen, in a worker the command supervises: a change to the plugins folder replaces it, and a crash respawns it. The default when no command is given.  |
| `geekity init <dir>`                      | Create a new site in `<dir>`. Refuses a directory that is not empty.                                                                                                                  |
| `geekity sync`                            | Rebuild the content index once and exit. Exits non-zero if any file could not be parsed.                                                                                              |
| `geekity rebuild`                         | Delete `data/geekity.db` and build it again from the files.                                                                                                                           |
| `geekity resend --all`, `<slug>...`       | Send announced posts to every follower and relay again, as they now read. See [Quote posts](federation.md#quote-posts).                                                               |
| `geekity maintenance on`, `off`, `status` | Take the public site down on purpose with a 503 and `Retry-After`, or bring it back, without a restart. `on --until <time>` names when it should be back.                             |
| `geekity dev-mode on`, `off`, `status`    | Hold everything the site would send to the outside world while it is built or migrated, or take it live. See [Dev mode](deploying.md#dev-mode).                                       |
| `geekity strip-metadata`                  | Remove location and camera metadata from files already in `content/uploads`. See [Location and camera metadata](media.md#location-and-camera-metadata).                               |
| `geekity user add <name>`                 | Create an admin account, so a site can get its first login without the setup screen.                                                                                                  |
| `geekity plugin add <package>`, `remove`  | Install a plugin package's bundle from the npm registry into the plugins folder (`GEEKITY_PLUGINS_DIR`), or delete a disabled one. A running `geekity serve` reloads with the change. |
| `geekity --help`, `-h`                    | The same table, on the terminal.                                                                                                                                                      |
| `geekity --version`                       | The installed version.                                                                                                                                                                |

An installed plugin may add commands of its own, which `geekity --help` lists
under _Plugin commands_ and which run whether or not the plugin is enabled.
That includes a plugin in the plugins folder. [Plugins and hooks](plugins.md)
describes `geekity plugin add` and writing a plugin.

`serve`, `sync`, `rebuild`, `resend`, `maintenance`, `dev-mode`, `strip-metadata`, `user add`, `plugin` and every plugin command take
`--config <file>`; without it they look for `geekity.config.ts`, then
`geekity.config.js`, then `geekity.config.mjs` in the working directory, and run
on defaults if there is none.

`sync` prints what the scan did and forces watching off whatever the config
says, because a one-shot scan that then sat in a watcher would never exit:

```sh
$ geekity sync
Scanned 12: 2 created, 1 updated, 0 removed, 9 unchanged, 0 failed
```

A file that will not parse is logged, left out of the index and counted in
`failed`; the command then exits `1` so a deploy step notices. Everything else
in the directory is still indexed.

## How `geekity serve` runs

Sites that add nothing of their own can skip the entry file and run the bin:

```sh
geekity serve --config geekity.config.ts
```

`geekity serve` runs as a small supervisor. It owns the port and runs the CMS
in one worker process, which it respawns, with a growing delay, if it crashes.
It replaces the worker with a new one, a reload, when one of these happens:

- A change on Admin > Plugins (Add, Update, Update all or Remove) finishes. The
  screen then shows the change and that the plugins reloaded.
- `geekity plugin add`, `upgrade` or `remove` finishes a change. The command
  asks the supervisor over a Unix socket in the system temp folder, named by
  the site's data folder, and prints how the reload went. When no supervisor
  answers, it says so.
- The plugins folder (`pluginsDir`) differs from what the running worker
  loaded and has not changed for five seconds. The supervisor reads the folder
  every second, so a copy that takes a while loads once, when it is done. Set
  `GEEKITY_PLUGIN_WATCH=off` to turn this off.
- You press **Reload** on Admin > Plugins. The screen offers it, naming the
  folders added, removed and updated, whenever the folder differs from what
  the running worker loaded.

One reload runs at a time. A change made during a reload is loaded by another
reload after it. Each reload works in this order:

1. The running worker stops taking writes. It answers GET and HEAD and answers
   any other method `503` with `Retry-After: 5`. It lets the writes already in
   flight finish, then stops its timers, its watcher and its plugins.
2. The running worker sends what its queues hold and stops writing to the
   database, `data/` and `content/`.
3. A new worker boots, runs the boot migrations alone and starts listening.
4. The old worker stops accepting connections and exits once its open ones end.

The port stays open throughout, so no request is refused. A reader that still
reaches the old worker after step 4 is redirected to the same address, which
the new worker answers. If the new worker fails to boot, the old one carries
on and the Plugins screen shows why. The supervisor does not try the same
folder again by itself. It waits for the folder to change, and Reload tries it
again at once.
SIGTERM and SIGINT close the worker the way `close()` does, and the supervisor
exits 0.

## Starting the database again

`geekity rebuild` deletes `data/geekity.db` (with its `-wal` and `-shm`) and
builds a new one exactly as a boot does — the same migrations, the same scan of
`content/`, the same read of `content/_data/federation/` — then says what it
indexed:

```sh
$ geekity rebuild
Rebuilt /srv/blog/data/geekity.db from the files.
Scanned 214: 214 created, 0 updated, 0 removed, 0 unchanged, 0 failed
Indexed 37 followers and 1,204 inbox activities.
```

Nothing in the database is anything but a reading of `content/` and `data/`, so
this is a command with no undo and nothing to lose; [what a rebuild does cost
is listed in Content](content.md#what-is-in-the-database-and-what-a-rebuild-costs). It is also the way past a
database this version refuses to open — a damaged one, or one written by a newer
`@geekity/cms`.

It refuses while the site is running, because deleting the file under a live
server would leave it writing to a database nothing can find. Stop the site
first. A file that will not parse is reported and exits `1`, as with `sync`.

That is why it is not the usual repair.
[**Tools > Content index**](content.md#rebuilding-the-index-from-the-admin) in
the admin rebuilds the index in place on the live site, with no downtime and
nobody signed out. Use the command for the one case the screen cannot be the
door for: a database this version refuses to open, where there is no site
running to press a button in.

## Creating an admin from the command line

`geekity user add <username>` writes a user straight into `data/users.json`,
which is how a site that cannot reach `/admin/setup` from a browser — a
headless deploy, a server behind a bastion — gets its first login. It is also
the way back into a site that has locked everybody out and cannot send email.
It enforces exactly the rules the setup form does: a username of 1 to 64
letters, digits, dots, dashes or underscores, and a password of at least 8
characters.

```sh
$ geekity user add ada
Password for ada:
Created admin user ada. Sign in at /admin/login.
```

The prompt does not echo. When standard input is not a terminal the command
prints no prompt and reads the password as a single line, so a script can pipe
one in:

```sh
printf '%s\n' "$ADMIN_PASSWORD" | geekity user add ada
```

`--password <pw>` passes it inline instead. That is the least private of the
three: a password on the command line is visible in the process list and lands
in shell history.

`--email <address>` puts an address on the new user, which is optional and is
what [password recovery](security.md#forgotten-passwords) works through:

```sh
$ geekity user add ada --email ada@example.com
Password for ada:
Created admin user ada (ada@example.com). Sign in at /admin/login.
```

A name that is already taken is refused and nothing is written; so are an
illegal username, a short password and an address that is not one. Every
refusal prints why and exits `1`.

Once somebody can sign in, the [`/admin/users` screen](admin.md#users) is the
easier door: it adds users, generates passwords and deletes them, and each
user's own screen under it is where the rest of an account is edited.

## How a TypeScript config is loaded

`geekity serve` and `geekity sync` import `geekity.config.ts` directly. That is
all it takes on Node 24, which strips types without a flag. For a config using
syntax stripping cannot erase, such as `enum`, the
CLI falls back to registering the **tsx installed in your own site**, which is
what `geekity init` puts in `devDependencies` (it is what runs `server.ts` too).
A site that wants neither can write `geekity.config.js` instead; it is in the
lookup list for exactly that reason. Nothing else is searched: the tsx has to be
the site's, so a copy that happens to be elsewhere on the machine is never used.
