#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { configFlag, isCommand, isHelpOrVersion, leadingWords, parseArgs } from './cli/args.ts';
import { COMMANDS } from './cli/commands.ts';
import { usage } from './cli/help.ts';
import { pluginCommand, pluginExtends } from './cli/plugin-commands.ts';
import { ownManifest } from './init.ts';
import { messageOf } from './util/errors.ts';

/** Run one command. Resolves with the exit code the process should use. */
async function main(argv: readonly string[]): Promise<number> {
  const words = leadingWords(argv);
  const first = words[0];
  if (first !== undefined && !argv.some(isHelpOrVersion)) {
    if (!isCommand(first) || (await pluginExtends(first, words, configFlag(argv)))) {
      return await pluginCommand(argv);
    }
  }

  const parsed = parseArgs(argv);

  if (parsed.command === 'help') {
    process.stdout.write(await usage(parsed.configPath));
    return 0;
  }

  if (parsed.command === 'version') {
    process.stdout.write(`${ownManifest().version}\n`);
    return 0;
  }

  return COMMANDS[parsed.command].run(parsed);
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
      process.stderr.write(`${messageOf(error)}\n`);
      process.exit(1);
    });
}
