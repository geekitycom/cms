import { readOption } from './options.ts';
import type { OptionSpec } from './options.ts';

const CORE_COMMANDS = [
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

const CORE_OPTIONS: readonly OptionSpec[] = [
  { name: 'config', value: { missing: CONFIG_MISSING } },
  {
    name: 'password',
    value: {
      missing: '--password needs a value, or leave it off to be asked for one.',
      dashed: true,
      empty: true,
    },
  },
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
  configPath: string | undefined;
  password: string | undefined;
  email: string | undefined;
  flags: Readonly<Record<string, string | true>>;
  args: readonly string[];
}

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
