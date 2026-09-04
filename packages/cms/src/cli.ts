#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { createUser, DuplicateUsernameError, migrateUsersToFile } from './admin/accounts.ts';
import { credentialProblem } from './admin/credentials.ts';
import { openAdminStore } from './admin/store.ts';
import { resolveConfig } from './config.ts';
import { createCms } from './index.ts';
import type { GeekityConfig } from './config.ts';
import { initSite, ownManifest } from './init.ts';

export type Command = 'serve' | 'init' | 'sync' | 'user' | 'help' | 'version';

/** The commands a site can name on the command line, as opposed to the flags. */
const COMMANDS: readonly Command[] = ['serve', 'init', 'sync', 'user'];

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
  geekity user add <username> [--password <pw>] [--config <file>]

Commands:
  serve            Start the CMS (the default when no command is given).
  init             Create a new site in <directory>.
  sync             Rebuild the content index once and exit.
  user add         Create an admin user, so a site can get its first login
                   without the setup screen.

Options:
  --config <file>  Config file to load. Defaults to the first of
                   ${CONFIG_FILENAMES.join(', ')} found in the working directory.
  --password <pw>  The new user's password. Left off, it is asked for without
                   echo, or read as one line when standard input is a pipe.
                   A password on the command line is visible in the process
                   list and in shell history, so prefer being asked.
  -h, --help       Show this help.
  -v, --version    Show the installed version.

Environment overrides:
  GEEKITY_PORT (or PORT), GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR,
  GEEKITY_THEME_DIR, GEEKITY_BASE_URL, GEEKITY_WATCH
`;

/** Turn `process.argv.slice(2)` into a command, its options and its arguments. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: Command | undefined;
  let configPath: string | undefined;
  let password: string | undefined;
  const args: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    if (arg === '--help' || arg === '-h') return { command: 'help', configPath, password, args };
    if (arg === '--version' || arg === '-v') {
      return { command: 'version', configPath, password, args };
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

  return { command: command ?? 'serve', configPath, password, args };
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
  const { command, configPath, password, args } = parseArgs(argv);

  if (command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === 'version') {
    process.stdout.write(`${ownManifest().version}\n`);
    return 0;
  }

  if (command === 'init') return init(args);
  if (command === 'user') return userCommand(args, configPath, password);
  if (command === 'sync') return syncCommand(configPath);

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

/** `geekity serve`: the default. Runs until it is signalled. */
async function serveCommand(configPath: string | undefined): Promise<number> {
  const cms = createCms(await loadConfig(process.cwd(), configPath));
  const { port } = await cms.serve();
  process.stdout.write(`Geekity is serving ${cms.config.baseUrl} on port ${String(port)}\n`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void cms.close().then(() => process.exit(0));
    });
  }
  return 0;
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

  const problem = credentialProblem(username, password);
  if (problem !== undefined) {
    process.stderr.write(`${problem}\n`);
    return 1;
  }

  const config = resolveConfig(await loadConfig(process.cwd(), configPath));
  const admin = openAdminStore({ dataDir: config.dataDir });
  migrateUsersToFile({ admin, dataDir: config.dataDir });

  try {
    const user = await createUser({ dataDir: config.dataDir, username, password });
    process.stdout.write(`Created admin user ${user.username}. Sign in at ${LOGIN_URL}.\n`);
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
