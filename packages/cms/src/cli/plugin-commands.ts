import { databaseFile } from '../cache.ts';
import { loadResolvedConfig } from '../config-loader.ts';
import type { ResolvedConfig } from '../config.ts';
import type { PluginCommand } from '../plugin.ts';
import { migratePluginSettings } from '../plugins/migrate-settings.ts';
import { createSettings } from '../site/namespace.ts';
import { configFlag, leadingWords, withoutConfig } from './args.ts';
import type { CoreCommand } from './args.ts';
import { COMMANDS } from './commands.ts';
import { readOption } from './options.ts';
import type { OptionSpec } from './options.ts';
import { loadSitePlugins } from './site-plugins.ts';

export interface FoundCommand {
  plugin: string;
  command: PluginCommand;
}

export async function pluginCommands(config: ResolvedConfig): Promise<FoundCommand[]> {
  return (await loadSitePlugins(config, createSettings({ config }))).plugins
    .filter((entry) => entry.problem === undefined)
    .flatMap((entry) => entry.commands.map((command) => ({ plugin: entry.plugin.name, command })))
    .sort((a, b) => b.command.words.length - a.command.words.length);
}

export async function pluginExtends(
  first: CoreCommand,
  words: readonly string[],
  configPath: string | undefined,
): Promise<boolean> {
  if (COMMANDS[first].sharedWithPlugins !== true || words.length < 2) return false;
  const found = await pluginCommands(await loadResolvedConfig(configPath));
  return found.some(({ command }) => command.words.every((word, index) => words[index] === word));
}

export async function pluginCommand(argv: readonly string[]): Promise<number> {
  const configPath = configFlag(argv);
  const config = await loadResolvedConfig(configPath);
  const words = leadingWords(argv);
  migratePluginSettings({
    contentDir: config.contentDir,
    dataDir: config.dataDir,
    log: (line) => {
      console.log(line);
    },
  });
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
  const { adminStoreOwning, openAdminDatabase } = await import('../store/admin-store.ts');
  const { migrateUsersToFile } = await import('../admin/legacy-migrations.ts');
  const { migrateCommentEmails, migrateCommentKeys } = await import('../comments/migrations.ts');
  const { pluginSite } = await import('../plugins/site.ts');
  const adminDb = openAdminDatabase(config.dataDir, config.now);
  migrateUsersToFile(adminDb, config.dataDir);
  const admin = adminStoreOwning(adminDb, databaseFile(config.dataDir), config.now);
  const comments = { contentDir: config.contentDir, dataDir: config.dataDir };
  migrateCommentEmails(comments);
  migrateCommentKeys(comments);
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

function parseCommandArgs(
  argv: readonly string[],
  command: PluginCommand,
): { args: string[]; options: Record<string, string | true> } {
  const specs: OptionSpec[] = (command.options ?? []).map((option) => ({
    name: option.name,
    value: option.value === undefined ? undefined : {},
  }));
  const args: string[] = [];
  const options: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    const { name, value, words } = readOption(argv, i, specs);
    options[name] = value;
    i += words - 1;
  }

  return { args, options };
}
