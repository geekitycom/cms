#!/usr/bin/env node
import cluster from 'node:cluster';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { createUser, DuplicateUsernameError, migrateUsersToFile } from './admin/accounts.ts';
import { credentialProblem, emailProblem } from './admin/credentials.ts';
import { openAdminStore } from './admin/store.ts';
import type { AdminStore } from './admin/store.ts';
import { databaseFile, discardDatabase } from './cache.ts';
import { resolveConfig } from './config.ts';
import type { ResolvedConfig } from './config.ts';
import { stripStoredUploads } from './content/metadata/sweep.ts';
import { UPLOAD_DIRECTORY } from './web/assets.ts';
import { createCms } from './index.ts';
import type { GeekityConfig } from './config.ts';
import { initSite, ownManifest, seedStarterContent } from './init.ts';
import type { PluginCommand } from './plugin.ts';
import { importPluginFolders, scanPluginFolders } from './plugins/folder.ts';
import {
  ADD_WITH_COMMAND,
  addPlugin,
  installedFolders,
  parsePackageSpec,
  pluginRegistry,
  removePlugin,
  requirementNotes,
} from './plugins/install.ts';
import { describeUpgrade, upgradePlugins } from './plugins/upgrade.ts';
import type { UpgradeReport } from './plugins/upgrade.ts';
import { pluginSite, sitePluginRegistry } from './plugins/site.ts';
import { superviseCluster } from './supervisor/primary.ts';
import { processChannel, superviseWorker } from './supervisor/worker.ts';
import {
  enterMaintenance,
  leaveMaintenance,
  maintenanceFile,
  readMaintenance,
} from './maintenance.ts';

export type Command =
  | 'serve'
  | 'init'
  | 'sync'
  | 'rebuild'
  | 'resend'
  | 'user'
  | 'maintenance'
  | 'strip-metadata'
  | 'plugin'
  | 'help'
  | 'version';

/** The commands a site can name on the command line, as opposed to the flags. */
const COMMANDS: readonly Command[] = [
  'serve',
  'init',
  'sync',
  'rebuild',
  'resend',
  'user',
  'maintenance',
  'strip-metadata',
  'plugin',
];

/**
 * The options one command reads out of {@link ParsedArgs.flags}, each of which
 * carries a value.
 */
const VALUE_FLAGS = ['until'] as const;

/** The options that are simply on or off. */
const SWITCH_FLAGS = ['all', 'check'] as const;

export interface ParsedArgs {
  command: Command;
  /** Path to the config file, relative to the working directory, if the user named one. */
  configPath: string | undefined;
  /**
   * The password `user add` was given on the command line, if any. `undefined`
   * means "ask"; the empty string means the user passed `--password=` and is
   * refused by the password rules rather than by the parser.
   */
  password: string | undefined;
  /**
   * The email address `user add` was given, if any. `undefined` is a user with
   * no address, which is the ordinary case: an email is optional on a user and
   * only buys password recovery and the notices TASK-55 sends.
   */
  email: string | undefined;
  /**
   * Every other option that was given: {@link VALUE_FLAGS} as the text after
   * them, {@link SWITCH_FLAGS} as `true`. Empty for a command that takes none.
   */
  flags: Readonly<Record<string, string | true>>;
  /**
   * Positional arguments after the command: the directory for `init`, the
   * subcommand and its arguments for `user`. Flags are never in here.
   */
  args: readonly string[];
}

const CONFIG_FILENAMES = ['geekity.config.ts', 'geekity.config.js', 'geekity.config.mjs'];

const USAGE = `geekity — the Geekity CMS command line

Usage:
  geekity [serve] [--config <file>]
  geekity init <directory>
  geekity sync [--config <file>]
  geekity rebuild [--config <file>]
  geekity resend (--all | <slug>...) [--config <file>]
  geekity maintenance (on [--until <time>] | off | status) [--config <file>]
  geekity strip-metadata [--config <file>]
  geekity user add <username> [--password <pw>] [--email <address>] [--config <file>]
  geekity plugin (add <package>[@version] | remove <package>) [--config <file>]
  geekity plugin upgrade [<package>...] [--check] [--config <file>]

Commands:
  serve            Start the CMS (the default when no command is given).
  init             Create a new site in <directory>.
  sync             Rebuild the content index once and exit.
  rebuild          Delete data/geekity.db and build it again from the files.
                   Everything in it is derived, so this is always safe with the
                   site stopped; sessions and delivery outcomes start empty.
  resend           Send announced posts to every follower and relay again, as
                   they read now: an Update for a post still published, a
                   Delete for one withdrawn. --all resends every post the site
                   has announced; this is how posts federated before a new
                   federation feature (such as quote posts) pick it up.
  maintenance      Take the public site down on purpose, or bring it back.
                   While on, pages, feeds, sitemaps and inbox deliveries answer
                   503 with Retry-After; the admin, /healthz and signed-in
                   users are let through. A running site notices within a
                   second, with no restart.
  strip-metadata   Remove location and camera metadata (EXIF, XMP, IPTC, a
                   video's location) from files already in content/uploads.
                   New uploads are stripped as they arrive; this is for the
                   ones from before. Safe to run again: a clean file is left
                   as it is.
  user add         Create an admin user, so a site can get its first login
                   without the setup screen.
  plugin add       Install a plugin package's bundle from the npm registry
                   (npm_config_registry, or registry.npmjs.org) into the
                   plugins folder, GEEKITY_PLUGINS_DIR. It installs only the
                   package named, and names any plugin it requires that is
                   missing. Reload on the Plugins screen loads it.
  plugin remove    Delete a plugin's folder from the plugins folder. Reload on
                   the Plugins screen unloads it. It refuses a plugin the site
                   has enabled: disable it first.
  plugin upgrade   Bring each plugin in the plugins folder, or only the ones
                   named, up to its newest version that this core and the
                   other installed plugins can run, installed as plugin add
                   installs one. Plugins that must move together do. It says,
                   for each plugin, what it upgraded, or why it held a newer
                   version back. --check reports and installs nothing.

Options:
  --config <file>  Config file to load. Defaults to the first of
                   ${CONFIG_FILENAMES.join(', ')} found in the working directory.
  --password <pw>  The new user's password. Left off, it is asked for without
                   echo, or read as one line when standard input is a pipe.
                   A password on the command line is visible in the process
                   list and in shell history, so prefer being asked.
  --email <addr>   The new user's email address. Optional; it is what a
                   forgotten password is recovered through.
  --until <time>   With maintenance on: when the site should be back, as an
                   ISO 8601 time such as 2026-09-28T14:00:00Z. It is the
                   Retry-After a client is sent, and the maintenance page
                   says it.
  --all            With resend: every announced post rather than named ones.
  --check          With plugin upgrade: say what would change, install nothing.
  -h, --help       Show this help.
  -v, --version    Show the installed version.

Environment overrides:
  GEEKITY_PORT (or PORT), GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR,
  GEEKITY_THEMES_DIR, GEEKITY_PLUGINS_DIR, GEEKITY_BASE_URL, GEEKITY_WATCH,
  GEEKITY_MAINTENANCE (on keeps the site in maintenance until a restart)
`;

/** Turn `process.argv.slice(2)` into a command, its options and its arguments. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: Command | undefined;
  let configPath: string | undefined;
  let password: string | undefined;
  let email: string | undefined;
  const flags: Record<string, string | true> = {};
  const args: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    if (arg === '--help' || arg === '-h') {
      return { command: 'help', configPath, password, email, flags, args };
    }
    if (arg === '--version' || arg === '-v') {
      return { command: 'version', configPath, password, email, flags, args };
    }

    if (arg === '--config') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--config needs a file path, for example --config geekity.config.ts');
      }
      configPath = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (value === '') {
        throw new Error('--config needs a file path, for example --config geekity.config.ts');
      }
      configPath = value;
      continue;
    }

    // Unlike --config, the value after --password is taken as given: a
    // password may legitimately start with a dash, and `--password=` with
    // nothing after it is refused by the password rules, which say why.
    if (arg === '--password') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('--password needs a value, or leave it off to be asked for one.');
      }
      password = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--password=')) {
      password = arg.slice('--password='.length);
      continue;
    }

    // Read like --config rather than like --password: an email address never
    // starts with a dash, so a value that does is a missing one.
    if (arg === '--email') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--email needs an address, for example --email ada@example.com');
      }
      email = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
      continue;
    }

    // Everything else spelled as an option goes in the flags map, and an
    // option no command has is refused here rather than left to be read as a
    // file name by whatever command was running.
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
      const inline = equals === -1 ? undefined : arg.slice(equals + 1);

      if ((SWITCH_FLAGS as readonly string[]).includes(name)) {
        if (inline !== undefined) throw new Error(`--${name} takes no value.`);
        flags[name] = true;
        continue;
      }

      if ((VALUE_FLAGS as readonly string[]).includes(name)) {
        if (inline !== undefined) {
          if (inline === '') throw new Error(`--${name} needs a value.`);
          flags[name] = inline;
          continue;
        }
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('-')) {
          throw new Error(`--${name} needs a value.`);
        }
        flags[name] = value;
        i += 1;
        continue;
      }

      throw new Error(`Unknown option "--${name}". Run geekity --help to see what is available.`);
    }

    // The first bare word is the command; everything bare after it belongs to
    // that command, so `geekity user add ada` reaches `user` with `add ada`.
    if (command === undefined) {
      if (!isCommand(arg)) {
        throw new Error(`Unknown command "${arg}". Run geekity --help to see what is available.`);
      }
      command = arg;
      continue;
    }

    args.push(arg);
  }

  return { command: command ?? 'serve', configPath, password, email, flags, args };
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/** Extensions that need TypeScript support in the loader. */
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);

/**
 * Load a config module, returning `{}` when the site has no config file.
 *
 * A TypeScript config is imported directly first. That is all it takes on Node
 * 24, which strips types without a flag, and inside this repository, where
 * the CLI already runs under tsx. A Node started with stripping disabled — and
 * any file carrying TypeScript syntax that stripping cannot erase — falls back to
 * registering tsx from the *site's* own dependencies, which is where a site
 * scaffolded by `geekity init` has it. A site with neither writes
 * `geekity.config.js` instead; it is in the candidate list for exactly that.
 */
export async function loadConfig(
  cwd: string,
  configPath: string | undefined,
): Promise<GeekityConfig> {
  const candidates =
    configPath === undefined
      ? CONFIG_FILENAMES.map((name) => path.resolve(cwd, name))
      : [path.resolve(cwd, configPath)];

  for (const candidate of candidates) {
    const href = pathToFileURL(candidate).href;
    let module: { default?: GeekityConfig };
    try {
      module = (await import(href)) as { default?: GeekityConfig };
    } catch (error) {
      if (isModuleNotFound(error, candidate)) continue;
      if (!needsTypeScriptLoader(error, candidate)) throw error;

      await registerTypeScriptLoader(cwd, candidate);
      module = (await import(href)) as { default?: GeekityConfig };
    }
    return module.default ?? {};
  }

  if (configPath !== undefined) {
    throw new Error(`Config file not found: ${path.resolve(cwd, configPath)}`);
  }
  return {};
}

/**
 * The site's own tsx, as the directory the package was installed into, or
 * `undefined` when the site does not have one.
 *
 * Node's resolver is deliberately not asked: this has to be the tsx the *site*
 * installed, and a resolver anchored anywhere else — or patched by a tsx that
 * is already loaded, which is what happens inside this repository — would
 * happily answer with somebody else's copy.
 */
export function findSiteTsx(cwd: string): string | undefined {
  let directory = path.resolve(cwd);

  for (;;) {
    const candidate = path.join(directory, 'node_modules', 'tsx');
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Teach this process to import TypeScript, using the tsx installed alongside
 * the site.
 *
 * tsx is the site's rather than this package's because the CMS does not depend
 * on it at runtime: a site that runs `server.ts` already has it, and a site
 * that does not want it writes its config in JavaScript instead.
 */
export async function registerTypeScriptLoader(cwd: string, configFile: string): Promise<void> {
  const tsx = findSiteTsx(cwd);
  if (tsx === undefined) {
    throw new Error(
      `Could not load ${configFile}: this Node cannot import TypeScript on its own and tsx is ` +
        'not installed in this site. Either add it (pnpm add -D tsx), or write the config as ' +
        'geekity.config.js instead.',
    );
  }

  const fromTsx = createRequire(path.join(tsx, 'package.json'));
  const api = (await import(pathToFileURL(fromTsx.resolve('tsx/esm/api')).href)) as {
    register(): unknown;
  };
  api.register();
}

/**
 * Whether an import failed because the loader could not handle TypeScript.
 *
 * `ERR_UNKNOWN_FILE_EXTENSION` is Node before type stripping was on by
 * default; `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` is a file using `enum` or
 * `namespace`, which stripping refuses because erasing it is not enough.
 */
function needsTypeScriptLoader(error: unknown, candidate: string): boolean {
  if (!TYPESCRIPT_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return false;
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ERR_UNKNOWN_FILE_EXTENSION' || code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX';
}

function isModuleNotFound(error: unknown, candidate: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
    String((error as { message?: string }).message ?? '').includes(candidate)
  );
}

/** Run one command. Resolves with the exit code the process should use. */
async function main(argv: readonly string[]): Promise<number> {
  const first = leadingWords(argv)[0];
  if (first !== undefined && !isCommand(first) && !argv.some(isHelpOrVersion)) {
    return await pluginCommand(argv);
  }

  const { command, configPath, password, email, flags, args } = parseArgs(argv);

  if (command === 'help') {
    process.stdout.write(await usage(configPath));
    return 0;
  }

  if (command === 'version') {
    process.stdout.write(`${ownManifest().version}\n`);
    return 0;
  }

  if (command === 'init') return init(args);
  if (command === 'user') return userCommand(args, configPath, password, email);
  if (command === 'sync') return syncCommand(configPath);
  if (command === 'rebuild') return rebuildCommand(configPath);
  if (command === 'resend') return resendCommand(args, configPath, flags);
  if (command === 'maintenance') return maintenanceCommand(args, configPath, flags);
  if (command === 'strip-metadata') return stripMetadataCommand(configPath);
  if (command === 'plugin') return pluginFolderCommand(args, configPath, flags);

  return serveCommand(configPath);
}

/** `geekity init <directory>`: scaffold a new site. */
async function init(args: readonly string[]): Promise<number> {
  const directory = args[0];
  if (directory === undefined) {
    throw new Error('geekity init <directory> needs the directory to create.');
  }

  const site = await initSite({ directory, cwd: process.cwd() });
  const relative = path.relative(process.cwd(), site.directory) || '.';

  process.stdout.write(
    [
      `Created ${site.directory}`,
      '',
      'Next:',
      `  cd ${relative}`,
      '  pnpm install',
      '  pnpm dev',
      '',
    ].join('\n'),
  );
  return 0;
}

/**
 * `geekity maintenance on|off|status` (TASK-130).
 *
 * Only the file under `data/` is touched, so this works the same with the
 * site running or stopped: a running site re-reads it within a second.
 */
async function maintenanceCommand(
  args: readonly string[],
  configPath: string | undefined,
  flags: Readonly<Record<string, string | true>>,
): Promise<number> {
  const action = args[0];
  const config = resolveConfig(await loadConfig(process.cwd(), configPath));
  const file = maintenanceFile(config.dataDir);

  if (action === 'on') {
    const until = untilFlag(text(flags, 'until'));
    await enterMaintenance(config.dataDir, { until });
    process.stdout.write(`Maintenance mode is on (${file}).${untilLine(until)}\n`);
    return 0;
  }

  if (action === 'off') {
    await leaveMaintenance(config.dataDir);
    process.stdout.write(`Maintenance mode is off.${forcedLine(config.maintenance)}\n`);
    return 0;
  }

  if (action === 'status') {
    const window = readMaintenance(config.dataDir);
    if (window === undefined && !config.maintenance) {
      process.stdout.write('Maintenance mode is off.\n');
    } else {
      process.stdout.write(
        `Maintenance mode is on.${untilLine(window?.until)}${forcedLine(config.maintenance)}\n`,
      );
    }
    return 0;
  }

  throw new Error('geekity maintenance needs on, off or status.');
}

function untilFlag(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const until = new Date(value);
  if (Number.isNaN(until.getTime())) {
    throw new Error(
      `--until needs a time such as 2026-09-28T14:00:00Z, received ${JSON.stringify(value)}.`,
    );
  }
  return until;
}

function untilLine(until: Date | undefined): string {
  return until === undefined ? '' : ` Expected back by ${until.toUTCString()}.`;
}

function forcedLine(forced: boolean): string {
  return forced
    ? ' GEEKITY_MAINTENANCE or the maintenance setting keeps it on until the site restarts without it.'
    : '';
}

async function stripMetadataCommand(configPath: string | undefined): Promise<number> {
  const config = resolveConfig(await loadConfig(process.cwd(), configPath));
  const results = await stripStoredUploads(path.join(config.contentDir, UPLOAD_DIRECTORY));

  let stripped = 0;
  let clean = 0;
  let unreadable = 0;
  for (const result of results) {
    if (result.outcome === 'stripped') {
      stripped += 1;
      process.stdout.write(`${result.path}: removed ${result.removed.join(', ')}\n`);
    } else if (result.outcome === 'clean') {
      clean += 1;
    } else {
      unreadable += 1;
      process.stderr.write(`${result.path}: ${result.problem} Left as it was.\n`);
    }
  }

  process.stdout.write(
    `Checked ${count(results.length, 'file')}: ${String(stripped)} stripped, ` +
      `${String(clean)} already clean, ${String(unreadable)} unreadable\n`,
  );
  return unreadable === 0 ? 0 : 1;
}

/**
 * `geekity sync`: bring the index into line with the files once and stop.
 *
 * Watching is forced off whatever the config says, because a one-shot scan
 * that then sat in a watcher would never exit.
 */
async function syncCommand(configPath: string | undefined): Promise<number> {
  const config = await loadConfig(process.cwd(), configPath);
  const cms = createCms({ ...config, watch: false });

  try {
    const result = await cms.sync();
    process.stdout.write(
      `Scanned ${String(result.scanned)}: ${String(result.created)} created, ` +
        `${String(result.updated)} updated, ${String(result.removed)} removed, ` +
        `${String(result.unchanged)} unchanged, ${String(result.failed)} failed\n`,
    );

    if (result.failed > 0) {
      process.stderr.write(
        `${String(result.failed)} file${result.failed === 1 ? '' : 's'} could not be parsed and ` +
          `${result.failed === 1 ? 'was' : 'were'} left out of the index; the warnings above name ` +
          `${result.failed === 1 ? 'it' : 'them'}.\n`,
      );
      return 1;
    }
    return 0;
  } finally {
    await cms.close();
  }
}

/**
 * `geekity resend`: send announced posts to their followers again, as they now
 * read.
 *
 * Mastodon keeps the copy of a post it first fetched, so a property added
 * later — the quote policy (TASK-125) is the one that made this a command —
 * reaches a post already out only through an `Update`. This is the resend
 * button on the federation screen, for every post at once. Delivery runs with
 * no queue, so each activity has been posted before the process exits.
 */
async function resendCommand(
  args: readonly string[],
  configPath: string | undefined,
  flags: Readonly<Record<string, string | true>>,
): Promise<number> {
  const all = flags['all'] === true;
  if (all === args.length > 0) {
    throw new Error(
      'geekity resend needs either --all or the slugs of the posts to resend, and not both.',
    );
  }

  const config = await loadConfig(process.cwd(), configPath);
  const cms = createCms({
    ...config,
    watch: false,
    federation: { ...config.federation, queue: null },
  });

  try {
    await cms.sync();
    const slugs = all ? cms.store.listFederated().map((document) => document.slug) : args;
    let failed = 0;
    for (const slug of slugs) {
      const report = await cms.delivery.resend(slug);
      if (report === undefined) {
        process.stderr.write(`${slug}: nothing to resend, no announced post has that slug.\n`);
        failed += 1;
        continue;
      }
      const reached = report.deliveries.filter((delivery) => delivery.status === 'sent').length;
      process.stdout.write(
        `${slug}: ${report.activityType} to ${String(reached)} of ` +
          `${String(report.deliveries.length)} inboxes\n`,
      );
    }
    return failed === 0 ? 0 : 1;
  } finally {
    await cms.close();
  }
}

/**
 * `geekity rebuild`: throw the database away and read it back out of the files.
 *
 * Nothing in `data/geekity.db` is anything but a reading of `content/` and
 * `data/` (decision-9), so this is a command with no undo and no loss: the
 * content index, the followers, the inbox log and the comments come back
 * exactly as they were, and what does not — sessions, the cached delivery
 * outcomes, the relay handshake — is what a site is told it may lose. It is the
 * way past a database this version refuses to open, which is the other reason
 * it exists.
 *
 * The rebuild is the boot: after the file is gone, `createCms` applies the same
 * migrations and runs the same rebuilds boot runs, and `sync()`
 * is the same scan `serve()` does. Nothing here knows how to build an index,
 * which is what keeps a rebuilt database identical to a booted one.
 *
 * Watching is forced off for the reason `sync` forces it off: a one-shot
 * command that sat in a watcher would never exit.
 */
async function rebuildCommand(configPath: string | undefined): Promise<number> {
  const loaded = await loadConfig(process.cwd(), configPath);
  const config = resolveConfig(loaded);
  const file = databaseFile(config.dataDir);

  if (databaseInUse(config.dataDir)) {
    process.stderr.write(
      `${file} is in use: something else has it open, most likely the site itself. Stop the ` +
        'server and run this again — deleting the database under a running one would leave it ' +
        'writing to a file nothing can find.\n',
    );
    return 1;
  }

  discardDatabase(config.dataDir);

  const cms = createCms({ ...loaded, watch: false });
  try {
    const result = await cms.sync();
    process.stdout.write(
      `Rebuilt ${file} from the files.\n` +
        `Scanned ${String(result.scanned)}: ${String(result.created)} created, ` +
        `${String(result.updated)} updated, ${String(result.removed)} removed, ` +
        `${String(result.unchanged)} unchanged, ${String(result.failed)} failed\n` +
        `Indexed ${count(cms.admin.countFollowers(), 'follower')}, ` +
        `${count(cms.admin.countInboxActivities(), 'inbox activity', 'inbox activities')} and ` +
        `${count(totalComments(cms.admin), 'comment')}.\n`,
    );

    if (result.failed > 0) {
      process.stderr.write(
        `${String(result.failed)} file${result.failed === 1 ? '' : 's'} could not be parsed and ` +
          `${result.failed === 1 ? 'was' : 'were'} left out of the index; the warnings above name ` +
          `${result.failed === 1 ? 'it' : 'them'}.\n`,
      );
      return 1;
    }
    return 0;
  } finally {
    await cms.close();
  }
}

/** "1 follower", "2 followers". The plural is the singular plus s unless told. */
/** How many comments the files hold, whatever a moderator has done with them. */
function totalComments(admin: AdminStore): number {
  const counts = admin.countCommentsByStatus();
  return counts.pending + counts.approved + counts.spam;
}

function count(howMany: number, singular: string, plural = `${singular}s`): string {
  return `${String(howMany)} ${howMany === 1 ? singular : plural}`;
}

/**
 * Whether something else has the database open.
 *
 * SQLite in WAL mode keeps a shared-memory file that every connection takes a
 * lock in, and asking for `locking_mode = EXCLUSIVE` means asking to be the
 * only one there — so a write transaction under it comes back
 * {@link SQLITE_BUSY} exactly when somebody else is attached. That is a cheap
 * and honest answer to "is the site running?", where a lock file of our own
 * would have to be cleaned up after a crash and a check of the `-wal` file
 * would say yes to a database nobody has open. The probe's own connection is
 * closed either way, which is what releases the lock it may have taken.
 *
 * Only busy is in use. A database that is not there, and one that will not
 * open or read at all, are both the case this command exists for, so they
 * answer no and let the rebuild get on with it.
 */
function databaseInUse(dataDir: string): boolean {
  const file = databaseFile(dataDir);
  if (!existsSync(file)) return false;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch {
    return false;
  }

  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    db.exec('BEGIN IMMEDIATE');
    db.exec('COMMIT');
    return false;
  } catch (error) {
    const code = (error as { errcode?: unknown } | null)?.errcode;
    return code === SQLITE_BUSY || code === SQLITE_LOCKED;
  } finally {
    db.close();
  }
}

/** SQLite's result codes for "somebody else has it", the only ones that mean in use. */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

/**
 * `geekity serve`: the default. Runs until it is signalled.
 *
 * This process is a supervisor (TASK-288): it owns the port and runs the CMS
 * in a `node:cluster` worker that runs this same command, so Reload on the
 * Plugins screen can boot a new worker beside the old one and a worker that
 * crashes is respawned, both without restarting the container.
 *
 * With `seedContent` on, a missing or empty content directory is given the
 * starter site before any worker opens it, so a new box boots into something
 * to show and the setup screen. It happens here rather than in `createCms` so
 * a site that builds its own server never has content written for it.
 */
async function serveCommand(configPath: string | undefined): Promise<number> {
  if (cluster.isWorker) return serveWorker(configPath);

  const resolved = resolveConfig(await loadConfig(process.cwd(), configPath));
  if (
    resolved.seedContent &&
    (await seedStarterContent({ contentDir: resolved.contentDir, baseUrl: resolved.baseUrl }))
  ) {
    process.stdout.write(`Seeded ${resolved.contentDir} with the starter site\n`);
  }
  superviseCluster();
  return 0;
}

/**
 * One worker under the supervisor: the site's config and its plugins folder,
 * read afresh, so a reload sees what changed. Signals are the supervisor's to
 * act on; it tells this worker when to close.
 */
async function serveWorker(configPath: string | undefined): Promise<number> {
  const channel = processChannel();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => undefined);

  try {
    const config = await loadConfig(process.cwd(), configPath);
    const loaded = scanPluginFolders(resolveConfig(config).pluginsDir);
    const worker = superviseWorker({
      channel,
      loaded,
      exit: (code) => process.exit(code),
      log: (line) => process.stderr.write(`${line}\n`),
    });

    // The access log is on here and off in `createCms`: a server that answers
    // the internet should be able to say what it answered, while a CMS embedded
    // in somebody else's app has no business writing to their stdout uninvited.
    // Named as a config value rather than forced, so `GEEKITY_ACCESS_LOG` still
    // wins and a site that wrote `accessLog: false` still gets silence.
    const cms = createCms(
      { ...config, accessLog: config.accessLog ?? true },
      { folderPlugins: await importPluginFolders(loaded), supervision: worker.supervision },
    );
    const { port } = await cms.serve();
    process.stdout.write(`Geekity is serving ${cms.config.baseUrl} on port ${String(port)}\n`);
    worker.serving(cms);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    channel.send({ type: 'boot-failed', error: message }, () => process.exit(1));
  }
  return 0;
}

async function pluginFolderCommand(
  args: readonly string[],
  configPath: string | undefined,
  flags: Readonly<Record<string, string | true>>,
): Promise<number> {
  const [action, ...names] = args;
  const spec = names.length === 1 ? names[0] : undefined;
  if (action !== 'upgrade' && action !== 'add' && action !== 'remove') {
    throw new Error(PLUGIN_USAGE);
  }
  const config = resolveConfig(await loadConfig(process.cwd(), configPath));
  const { pluginsDir } = config;
  if (pluginsDir === undefined) {
    throw new Error(
      'geekity plugin needs a plugins folder: set GEEKITY_PLUGINS_DIR, or pluginsDir in the config.',
    );
  }
  const registry = pluginRegistry(process.env);

  if (action === 'upgrade') {
    const report = await upgradePlugins({
      pluginsDir,
      registry,
      coreVersion: ownManifest().version,
      configured: config.plugins.map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        peerDependencies: plugin.requires ?? {},
      })),
      only: names.length === 0 ? undefined : names,
      check: flags['check'] === true,
      addAdvice: ADD_WITH_COMMAND,
    });
    process.stdout.write(upgradeReportText(report));
    return report.plugins.some((plugin) => plugin.status === 'failed') ? 1 : 0;
  }

  if (spec === undefined) throw new Error(PLUGIN_USAGE);
  if (action === 'remove') {
    const directory = await removePlugin(spec, { pluginsDir, contentDir: config.contentDir });
    process.stdout.write(
      `Removed ${spec} (${directory}). Reload on the Plugins screen to unload it.\n`,
    );
    return 0;
  }

  const { manifest, directory, replaced } = await addPlugin(parsePackageSpec(spec), {
    pluginsDir,
    registry,
  });
  const installed = new Map<string, string | undefined>([
    ...config.plugins.map((plugin) => [plugin.name, plugin.version] as const),
    ...installedFolders(pluginsDir),
  ]);
  const done =
    replaced === undefined || replaced === manifest.version
      ? `Added ${manifest.name} ${manifest.version} to ${directory}.`
      : `Replaced ${manifest.name} ${replaced} with ${manifest.version} in ${directory}.`;
  process.stdout.write(
    [
      done,
      ...requirementNotes(manifest, installed, ownManifest().version, ADD_WITH_COMMAND),
      'Reload on the Plugins screen to load it, then enable it there.',
      '',
    ].join('\n'),
  );
  return 0;
}

const PLUGIN_USAGE =
  'geekity plugin needs add <package>[@version], remove <package> or upgrade [<package>...].';

function upgradeReportText(report: UpgradeReport): string {
  const lines = report.plugins.map((plugin) => `${plugin.name}: ${describeUpgrade(plugin)}`);
  for (const { name, notes } of report.unmet) {
    lines.push(...notes.map((note) => `${name}: ${note}`));
  }
  const statuses = new Set(report.plugins.map((plugin) => plugin.status));
  if (statuses.has('upgraded')) {
    lines.push('Reload on the Plugins screen to load the new versions.');
  }
  if (statuses.has('available')) {
    lines.push('Run geekity plugin upgrade without --check to install them.');
  }
  return lines.map((line) => `${line}\n`).join('');
}

/**
 * `geekity user add <username>`: create an admin without the setup screen.
 *
 * The other door into `data/users.json` is the first-run setup form, and this
 * one has to leave the same thing behind it, so both go through
 * {@link credentialProblem} rather than each carrying its own idea of a legal
 * username. The file is written under the config's `dataDir`, which is the
 * same one the server will read.
 *
 * The database is opened for one reason only: this is the one door that can
 * reach the users file before a server ever has, and a site upgrading from the
 * version that kept its accounts in SQLite would otherwise end up with a file
 * holding nobody but the user added here — which, the file winning, is what
 * the next boot would keep. So the same boot migration runs first.
 */
async function userCommand(
  args: readonly string[],
  configPath: string | undefined,
  flagPassword: string | undefined,
  flagEmail: string | undefined,
): Promise<number> {
  const subcommand = args[0];
  if (subcommand === undefined) {
    throw new Error('geekity user add <username> needs a subcommand. The only one is: add.');
  }
  if (subcommand !== 'add') {
    throw new Error(`Unknown user subcommand "${subcommand}". The only one is: add.`);
  }

  const username = args[1];
  if (username === undefined) {
    throw new Error('geekity user add <username> needs the name of the user to create.');
  }

  const password = flagPassword ?? (await readPassword({ prompt: `Password for ${username}: ` }));

  const email = (flagEmail ?? '').trim();
  const problem = credentialProblem(username, password) ?? emailProblem(email);
  if (problem !== undefined) {
    process.stderr.write(`${problem}\n`);
    return 1;
  }

  const config = resolveConfig(await loadConfig(process.cwd(), configPath));
  const admin = openAdminStore({ dataDir: config.dataDir });
  migrateUsersToFile({ admin, dataDir: config.dataDir });

  try {
    const user = await createUser({ dataDir: config.dataDir, username, password, email });
    process.stdout.write(
      `Created admin user ${user.username}${
        user.email === undefined ? '' : ` (${user.email})`
      }. Sign in at ${LOGIN_URL}.\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof DuplicateUsernameError) {
      process.stderr.write(
        `${error.message} Pick another name, or change that user's password from the admin.\n`,
      );
      return 1;
    }
    throw error;
  } finally {
    admin.close();
  }
}

/** Where the success line points a new admin. Relative, because the host is the site's. */
const LOGIN_URL = '/admin/login';

/** One flag as the text it carries, or `undefined` when it was not given. */
function text(flags: Readonly<Record<string, string | true>>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function isHelpOrVersion(arg: string): boolean {
  return arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v';
}

/** The bare words before the first option other than `--config`. */
function leadingWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--config') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--config=')) continue;
    if (arg.startsWith('-')) break;
    words.push(arg);
  }
  return words;
}

/** `--config <file>` or `--config=<file>`, wherever it is. */
function configFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--config') return argv[i + 1];
    if (arg.startsWith('--config=')) return arg.slice('--config='.length);
  }
  return undefined;
}

/** A command a plugin added, and the plugin it came from. */
interface FoundCommand {
  plugin: string;
  command: PluginCommand;
}

/**
 * Every command the site's available plugins add, from its config and its
 * plugins folder, longest words first.
 */
async function pluginCommands(config: ResolvedConfig): Promise<FoundCommand[]> {
  const folderPlugins = await importPluginFolders(scanPluginFolders(config.pluginsDir));
  return sitePluginRegistry(config, folderPlugins)
    .plugins.filter((entry) => entry.problem === undefined)
    .flatMap((entry) => entry.commands.map((command) => ({ plugin: entry.plugin.name, command })))
    .sort((a, b) => b.command.words.length - a.command.words.length);
}

/**
 * Run a command a plugin added (decision-33). It needs no enabling: a
 * migration command runs before the plugin it prepares for is turned on.
 *
 * The database is opened for the reason `user add` opens it: a command can
 * reach `data/users.json` before any server has, so a site upgrading from the
 * version that kept its accounts in SQLite is migrated first.
 */
async function pluginCommand(argv: readonly string[]): Promise<number> {
  const configPath = configFlag(argv);
  const config = resolveConfig(await loadConfig(process.cwd(), configPath));
  const words = leadingWords(argv);
  const found = (await pluginCommands(config)).find(({ command }) =>
    command.words.every((word, index) => words[index] === word),
  );
  if (found === undefined) {
    throw new Error(
      `Unknown command "${words[0] ?? ''}". Run geekity --help to see what is available.`,
    );
  }

  const { args, options } = parseCommandArgs(
    withoutConfig(argv).slice(found.command.words.length),
    found.command,
  );
  const admin = openAdminStore({ dataDir: config.dataDir });
  migrateUsersToFile({ admin, dataDir: config.dataDir });
  try {
    return await found.command.run({
      args,
      options,
      cwd: process.cwd(),
      site: pluginSite({ admin, config }),
      write: (output) => process.stdout.write(output),
    });
  } finally {
    admin.close();
  }
}

function withoutConfig(argv: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--config') {
      i += 1;
      continue;
    }
    if (!arg.startsWith('--config=')) kept.push(arg);
  }
  return kept;
}

/** A plugin command's arguments and options, refusing any option it does not take. */
function parseCommandArgs(
  argv: readonly string[],
  command: PluginCommand,
): { args: string[]; options: Record<string, string | true> } {
  const args: string[] = [];
  const options: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }

    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const option = command.options?.find((entry) => entry.name === name);
    if (option === undefined) {
      throw new Error(`Unknown option "--${name}". Run geekity --help to see what is available.`);
    }

    if (option.value === undefined) {
      if (inline !== undefined) throw new Error(`--${name} takes no value.`);
      options[name] = true;
      continue;
    }
    if (inline !== undefined) {
      if (inline === '') throw new Error(`--${name} needs a value.`);
      options[name] = inline;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('-')) throw new Error(`--${name} needs a value.`);
    options[name] = value;
    i += 1;
  }

  return { args, options };
}

/**
 * The help, with the commands the site's plugins add. A config that will not
 * load costs the help its plugin section, not the help itself.
 */
async function usage(configPath: string | undefined): Promise<string> {
  let found: FoundCommand[];
  try {
    found = await pluginCommands(resolveConfig(await loadConfig(process.cwd(), configPath)));
  } catch (error) {
    process.stderr.write(
      `Plugin commands are not listed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return USAGE;
  }
  if (found.length === 0) return USAGE;

  const lines = ['', 'Plugin commands:'];
  for (const { plugin, command } of found) {
    const synopsis = wrap(
      `geekity ${[...command.words, command.usage].join(' ').trim()} [--config <file>]`,
      USAGE_CONTINUATION,
    );
    lines.push(`  ${(synopsis[0] ?? '').trimStart()}`, ...synopsis.slice(1));
    lines.push(...wrap(command.summary, HELP_INDENT), `${HELP_INDENT}From ${plugin}.`);
    for (const option of command.options ?? []) {
      const flag = `--${option.name}${option.value === undefined ? '' : ` ${option.value}`}`;
      const described = wrap(option.description, HELP_INDENT);
      const head = `    ${flag}`;
      if (head.length < HELP_INDENT.length - 1 && described[0] !== undefined) {
        described[0] = `${head.padEnd(HELP_INDENT.length)}${described[0].trimStart()}`;
        lines.push(...described);
      } else {
        lines.push(head, ...described);
      }
    }
  }
  return `${USAGE}${lines.join('\n')}\n`;
}

/** Where the help's descriptions start, as the core commands' do. */
const HELP_INDENT = ' '.repeat(19);
/** Where a usage line carries on, as the core commands' do. */
const USAGE_CONTINUATION = ' '.repeat(10);
const HELP_WIDTH = 79;

/** Text wrapped to the help's width, each line indented. */
function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((entry) => entry !== '')) {
    if (line !== '' && indent.length + line.length + 1 + word.length > HELP_WIDTH) {
      lines.push(`${indent}${line}`);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(`${indent}${line}`);
  return lines;
}

/** A terminal, as much of one as {@link readPassword} needs. */
type PasswordInput = NodeJS.ReadableStream & {
  isTTY?: boolean | undefined;
  isRaw?: boolean | undefined;
  setRawMode?: (mode: boolean) => unknown;
};

/** Where {@link readPassword} reads from, writes to, and what it says. */
export interface ReadPasswordOptions {
  /** Stream to read the password from. Defaults to standard input. */
  input?: PasswordInput;
  /** Stream the prompt goes to. Defaults to standard error, so `>` keeps it out of a file. */
  output?: NodeJS.WritableStream;
  /** The prompt, shown only on a terminal. */
  prompt?: string;
}

/**
 * Ask for a password once, without putting it on the screen.
 *
 * Two things would otherwise echo it, and both are turned off: the terminal
 * driver, silenced by putting the input into raw mode, and readline, whose
 * output goes to a writable that keeps nothing. Readline happens to set raw
 * mode itself, but it is set here as well rather than relied on: the day that
 * changes, a password would be printed. Raw mode also means readline sees
 * Ctrl-C as a byte rather than a signal, so it is turned back into a
 * cancellation here.
 *
 * Off a terminal — a pipe, a heredoc, a CI job — nothing is printed and the
 * first line is the password, which is what makes
 * `printf '%s\n' "$PW" | geekity user add ada` work.
 */
export async function readPassword(options: ReadPasswordOptions = {}): Promise<string> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  const terminal = input.isTTY === true;

  if (terminal && options.prompt !== undefined) output.write(options.prompt);

  const wasRaw = input.isRaw === true;
  if (terminal) input.setRawMode?.(true);

  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const reader = createInterface({ input, output: muted, terminal });
  let cancelled = false;
  reader.on('SIGINT', () => {
    cancelled = true;
    reader.close();
  });

  try {
    for await (const line of reader) {
      if (!cancelled) return line;
      break;
    }
  } finally {
    reader.close();
    if (terminal) {
      input.setRawMode?.(wasRaw);
      // The terminal is left on the line the swallowed newline never printed.
      output.write('\n');
    }
    input.pause();
  }

  if (cancelled) throw new Error('Cancelled; no user was created.');

  throw new Error(
    'No password was given: standard input ended before a line arrived. Pass --password, or ' +
      'pipe the password in as a single line.',
  );
}

/**
 * True when this module is the process entry point.
 *
 * The entry path is realpath'd first: package managers link a bin through
 * `node_modules/.bin`, so `process.argv[1]` reaches this file through a symlink
 * while `import.meta.url` is already resolved.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      // `serve` resolves with 0 while the server is still listening; exiting
      // here would kill it, so only a command that finished sets the code and
      // lets the event loop empty on its own.
      if (code !== 0) process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
