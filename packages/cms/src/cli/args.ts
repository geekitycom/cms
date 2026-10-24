import { readOption } from './options.ts';
import type { OptionSpec } from './options.ts';

export const CORE_COMMANDS = [
  'serve',
  'init',
  'sync',
  'rebuild',
  'resend',
  'maintenance',
  'dev-mode',
  'gemini',
  'settings',
  'strip-metadata',
  'export',
  'import',
  'user',
  'plugin',
] as const;

export type CoreCommand = (typeof CORE_COMMANDS)[number];

export type Command = CoreCommand | 'help' | 'version';

const CONFIG_MISSING = '--config needs a file path, for example --config geekity.config.ts';

/** Every option a core command takes. */
const CORE_OPTIONS: readonly OptionSpec[] = [
  { name: 'config', value: { missing: CONFIG_MISSING } },
  // Unlike --config, the value after --password is taken as given: a password
  // may legitimately start with a dash, and `--password=` with nothing after
  // it is refused by the password rules, which say why.
  {
    name: 'password',
    value: {
      missing: '--password needs a value, or leave it off to be asked for one.',
      dashed: true,
      empty: true,
    },
  },
  // Read like --config rather than like --password: an email address never
  // starts with a dash, so a value that does is a missing one.
  {
    name: 'email',
    value: {
      missing: '--email needs an address, for example --email ada@example.com',
      empty: true,
    },
  },
  { name: 'until', value: {} },
  { name: 'out', value: {} },
  { name: 'all' },
  { name: 'check' },
  { name: 'unset' },
  { name: 'with-credentials' },
  { name: 'without-content' },
  { name: 'list' },
  { name: 'replace' },
  { name: 'dev-mode' },
  { name: 'new-base-url' },
];

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
   * only buys password recovery and moderation notices.
   */
  email: string | undefined;
  /**
   * Every other option that was given: a value option as the text after it, a
   * switch as `true`. Empty for a command that takes none.
   */
  flags: Readonly<Record<string, string | true>>;
  /**
   * Positional arguments after the command: the directory for `init`, the
   * subcommand and its arguments for `user`. Flags are never in here.
   */
  args: readonly string[];
}

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

    if (arg.startsWith('--')) {
      const { name, value, words } = readOption(argv, i, CORE_OPTIONS);
      i += words - 1;
      if (value === true) flags[name] = true;
      else if (name === 'config') configPath = value;
      else if (name === 'password') password = value;
      else if (name === 'email') email = value;
      else flags[name] = value;
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

  return { command: command ?? 'serve', configPath, password, email, flags, args };
}

export function isCommand(value: string): value is CoreCommand {
  return (CORE_COMMANDS as readonly string[]).includes(value);
}

/** One flag as the text it carries, or `undefined` when it was not given. */
export function text(
  flags: Readonly<Record<string, string | true>>,
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function isHelpOrVersion(arg: string): boolean {
  return arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v';
}

/** The bare words before the first option other than `--config`. */
export function leadingWords(argv: readonly string[]): string[] {
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
export function configFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--config') return argv[i + 1];
    if (arg.startsWith('--config=')) return arg.slice('--config='.length);
  }
  return undefined;
}

export function withoutConfig(argv: readonly string[]): string[] {
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
