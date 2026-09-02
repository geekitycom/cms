#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  geekity user add <username>

Commands:
  serve            Start the CMS (the default when no command is given).
  init             Create a new site in <directory>.
  sync             Rebuild the content index once and exit.
  user add         Create an admin user. Not available yet; admin auth has not
                   shipped.

Options:
  --config <file>  Config file to load. Defaults to the first of
                   ${CONFIG_FILENAMES.join(', ')} found in the working directory.
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
  const args: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    if (arg === '--help' || arg === '-h') return { command: 'help', configPath, args };
    if (arg === '--version' || arg === '-v') return { command: 'version', configPath, args };

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

  return { command: command ?? 'serve', configPath, args };
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
 * 22.18 and newer, which strip types without a flag, and inside this
 * repository, where the CLI already runs under tsx. Older Node — and any file
 * carrying TypeScript syntax that stripping cannot erase — falls back to
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
  const { command, configPath, args } = parseArgs(argv);

  if (command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === 'version') {
    process.stdout.write(`${ownManifest().version}\n`);
    return 0;
  }

  if (command === 'init') return init(args);
  if (command === 'user') return userCommand(args);
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
 * `geekity user add`: create an admin without the setup screen.
 *
 * Not available yet. Admin authentication — the users table, the password
 * hashing and the login screen — is TASK-9, in the next milestone, and this
 * command is the front door to it. It is registered so `geekity user add`
 * explains itself rather than reading as an unknown command.
 */
function userCommand(args: readonly string[]): number {
  const subcommand = args[0];
  if (subcommand !== undefined && subcommand !== 'add') {
    throw new Error(`Unknown user subcommand "${subcommand}". The only one is: add.`);
  }

  process.stderr.write(
    'geekity user add is not available until admin authentication ships. There is no users ' +
      'table and no password hashing yet, so there is nothing an account could log in to.\n',
  );
  return 1;
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
