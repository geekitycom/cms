import { CONFIG_FILENAMES, loadResolvedConfig } from '../config-loader.ts';
import { messageOf } from '../util/errors.ts';
import { COMMANDS } from './commands.ts';
import { pluginCommands } from './plugin-commands.ts';
import type { FoundCommand } from './plugin-commands.ts';

const OPTIONS_HELP = `Options:
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
  --unset          With settings set: remove the stored value.
  --all            With resend: every announced post rather than named ones.
  --check          With plugin upgrade: say what would change, install nothing.
  --out <file>     With export: the archive to write. Defaults to
                   geekity-<host>-<time>.tar.gz in the working directory.
  --with-credentials
                   With export: include the API keys and logins kept in
                   data/ (mail.json, akismet.json, tmdb.json, each plugin's
                   secrets).
  --without-content
                   With export: leave content/ out.
  --list           With export: print each file data/ may hold, its class
                   and what is lost without it, and write nothing.
  --replace        With import: move what content/ and data/ hold into
                   <dir>/.geekity-before-import-<time> when they hold a site.
  --dev-mode       With import: turn dev mode on, for a staging copy of a
                   live site.
  --new-base-url   With import: accept a base URL in effect that differs
                   from the one the archive was exported from.
  -h, --help       Show this help.
  -v, --version    Show the installed version.

Environment overrides:
  GEEKITY_PORT (or PORT), GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR,
  GEEKITY_THEMES_DIR, GEEKITY_PLUGINS_DIR, GEEKITY_BASE_URL, GEEKITY_WATCH,
  GEEKITY_MAINTENANCE (on keeps the site in maintenance until a restart),
  GEEKITY_DEV_MODE (on starts the site in dev mode; only dev-mode off ends it),
  GEEKITY_GEMINI_CERT and GEEKITY_GEMINI_KEY (the operator's own Gemini
  certificate and key instead of the generated pair)
`;

/**
 * The help, with the commands the site's plugins add. A config that will not
 * load costs the help its plugin section, not the help itself.
 */
export async function usage(configPath: string | undefined): Promise<string> {
  let found: FoundCommand[];
  try {
    found = await pluginCommands(await loadResolvedConfig(configPath));
  } catch (error) {
    process.stderr.write(`Plugin commands are not listed: ${messageOf(error)}\n`);
    return coreUsage();
  }
  if (found.length === 0) return coreUsage();

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
      lines.push(...helpEntry(`    ${flag}`, wrap(option.description, HELP_INDENT)));
    }
  }
  return `${coreUsage()}${lines.join('\n')}\n`;
}

function coreUsage(): string {
  const entries = Object.values(COMMANDS);
  return [
    'geekity — the Geekity CMS command line',
    '',
    'Usage:',
    ...entries.flatMap((entry) => entry.synopsis.map((line) => `  geekity ${line}`)),
    '',
    'Commands:',
    ...entries.flatMap((entry) =>
      entry.help.flatMap(([words, summary]) =>
        helpEntry(
          `  ${words}`,
          summary.map((line) => `${HELP_INDENT}${line}`),
        ),
      ),
    ),
    '',
    OPTIONS_HELP,
  ].join('\n');
}

function helpEntry(head: string, described: string[]): string[] {
  if (head.length < HELP_INDENT.length - 1 && described[0] !== undefined) {
    described[0] = `${head.padEnd(HELP_INDENT.length)}${described[0].trimStart()}`;
    return described;
  }
  return [head, ...described];
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
