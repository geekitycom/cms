import { loadResolvedConfig } from '../config-loader.ts';
import type { ResolvedConfig } from '../config.ts';
import { migratePluginSettings } from '../plugins/migrate-settings.ts';
import { readEnabledPlugins } from '../plugins/enabled.ts';
import type { PluginRegistry, RegisteredPlugin } from '../plugins/registry.ts';
import { overridden, sourceLabel } from '../settings/registry.ts';
import type { SettingRef, SettingsRegistry } from '../settings/types.ts';
import { createSettings } from '../site/namespace.ts';
import { messageOf } from '../util/errors.ts';
import type { ParsedArgs } from './args.ts';
import { table } from './format.ts';
import { loadSitePlugins } from './site-plugins.ts';

export async function settingsCommand({ args, configPath, flags }: ParsedArgs): Promise<number> {
  const [action, name, value] = args;
  const config = await loadResolvedConfig(configPath);

  if (action === 'migrate-plugins' && name === undefined) {
    const moved = migratePluginSettings({
      contentDir: config.contentDir,
      dataDir: config.dataDir,
      log: (line) => process.stdout.write(`${line}\n`),
    });
    if (moved.length === 0) {
      process.stdout.write('No plugin settings are left in content/_data/site.json.\n');
    }
    return 0;
  }

  const request = settingsRequest(action, name, value, flags['unset'] === true);
  if (request === undefined) {
    throw new Error(
      'geekity settings needs list [<namespace>], get <namespace.key>, set <namespace.key> with a value or --unset, or migrate-plugins.',
    );
  }

  const settings = await settingsWithRunningPlugins(config);

  if (request.action === 'list') {
    const refs = settings.list().filter((ref) => name === undefined || ref.namespace === name);
    if (refs.length === 0) throw new Error(`There is no settings namespace ${String(name)}.`);
    const rows = await Promise.all(refs.map((ref) => settingRow(settings, ref)));
    process.stdout.write(table(rows));
    return 0;
  }

  const ref = settingNamed(settings, request.name);

  if (request.action === 'get') {
    const resolved = await settings.resolve(ref);
    const lines = [shown(ref, resolved.value)];
    if (overridden(resolved.source)) {
      const held = resolved.stored === undefined ? 'nothing' : shown(ref, resolved.stored);
      lines.push(`overridden by ${sourceLabel(resolved.source)}; the file holds ${held}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }

  const { type } = ref.declaration;
  let stored: unknown;
  if (request.value !== undefined) {
    const parsed = type.fromText(request.value);
    if (!parsed.ok) throw new Error(`${request.name} ${parsed.problem}.`);
    stored = type.toJson(parsed.value);
  }
  await setOrThrow(settings, ref.namespace, { [ref.key]: stored });
  process.stdout.write(table([await settingRow(settings, ref)]));
  return 0;
}

type SettingsRequest =
  | { action: 'list' }
  | { action: 'get'; name: string }
  | { action: 'set'; name: string; value: string | undefined };

function settingsRequest(
  action: string | undefined,
  name: string | undefined,
  value: string | undefined,
  unset: boolean,
): SettingsRequest | undefined {
  if (action === 'list') return { action };
  if (name === undefined) return undefined;
  if (action === 'get') return { action, name };
  if (action === 'set' && (value !== undefined) !== unset) return { action, name, value };
  return undefined;
}

async function settingsWithRunningPlugins(config: ResolvedConfig): Promise<SettingsRegistry> {
  migratePluginSettings({
    contentDir: config.contentDir,
    dataDir: config.dataDir,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  const settings = createSettings({ config });
  let registry: PluginRegistry;
  try {
    registry = await loadSitePlugins(config, settings);
  } catch (error) {
    process.stderr.write(`Plugin settings are not listed: ${messageOf(error)}\n`);
    return settings;
  }
  const enabled = readEnabledPlugins(config.contentDir);
  const running = registry.active(enabled);
  for (const entry of registry.plugins) {
    const { name } = entry.plugin;
    const declared = entry.settingsNamespace !== undefined;
    const unremarkable = !declared && !enabled.has(name) && entry.problem === undefined;
    if (running.has(name) || unremarkable) continue;
    const unlisted = declared ? ' Its settings are not listed.' : '';
    process.stderr.write(`${name} ${whyNotRunning(entry, enabled)}${unlisted}\n`);
    if (declared) settings.unregister(name);
  }
  return settings;
}

function whyNotRunning(entry: RegisteredPlugin, enabled: ReadonlySet<string>): string {
  if (entry.problem !== undefined) return `did not load: ${entry.problem}`;
  if (enabled.has(entry.plugin.name)) {
    return 'is enabled but not running, because a plugin it requires is not running.';
  }
  return 'is installed but not enabled.';
}

function settingNamed(settings: SettingsRegistry, name: string): SettingRef<unknown> {
  const dot = name.lastIndexOf('.');
  const found = settings
    .list()
    .find((ref) => ref.namespace === name.slice(0, dot) && ref.key === name.slice(dot + 1));
  if (found === undefined) {
    throw new Error(`There is no setting ${name}. geekity settings list names them.`);
  }
  return found;
}

export async function setOrThrow(
  settings: SettingsRegistry,
  namespace: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const result = await settings.set(namespace, new Map(Object.entries(changes)), 'cli');
  if (!result.ok) throw new Error(Object.values(result.problems).join(' '));
}

function shown(ref: SettingRef<unknown>, value: unknown): string {
  if (ref.declaration.secret === true) {
    return value === ref.declaration.default ? '(not set)' : '(set)';
  }
  return ref.declaration.type.toText(value);
}

async function settingRow(
  settings: SettingsRegistry,
  ref: SettingRef<unknown>,
): Promise<readonly string[]> {
  const resolved = await settings.resolve(ref);
  let source = sourceLabel(resolved.source);
  if (overridden(resolved.source) && resolved.stored !== undefined) {
    source += ` (file: ${shown(ref, resolved.stored)})`;
  }
  if (ref.declaration.env === false) source += ', not overridable';
  return [
    `${ref.namespace}.${ref.key}`,
    shown(ref, resolved.value),
    source,
    ref.declaration.description,
  ];
}
