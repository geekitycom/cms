/**
 * A plugin's settings (decision-33): the fields it declares, where each value
 * lives, and what a save writes.
 *
 * Public values sit under the plugin's key in `content/_data/site.json`,
 * beside `enabled`. Secrets sit in `secrets.json` in the plugin's data folder,
 * mode 0600, and an environment variable named by the package wins over the
 * file, so a Docker operator can keep a key in `.env`. Every value is read
 * from the files and the environment when it is asked for, so a save or a
 * hand edit takes effect on the next request.
 */

import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import type { PluginSettingField } from '../plugin.ts';
import { readPluginEntry, updatePluginEntry } from './enabled.ts';

export const SECRETS_FILE = 'secrets.json';

/** Where a value came from: nowhere, `site.json`, `secrets.json` or the environment. */
export type SettingSource = 'default' | 'site' | 'file' | 'environment';

/** One field and the value it has now. */
export interface ResolvedSetting {
  readonly field: PluginSettingField;
  readonly value: string | boolean | undefined;
  readonly source: SettingSource;
  /** Why the stored value was set aside for the default, or `undefined`. */
  readonly problem: string | undefined;
  /** A secret's environment variable, `undefined` for a public field. */
  readonly variable: string | undefined;
}

/** Where one plugin's settings are read from. */
export interface PluginSettingsPlace {
  readonly contentDir: string;
  readonly dataDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly name: string;
  readonly fields: readonly PluginSettingField[];
}

/** A settings form as submitted: each box by key, and the secrets to forget. */
export interface PluginSettingsSubmission {
  readonly values: Readonly<Record<string, string | undefined>>;
  readonly forget: ReadonlySet<string>;
}

/** `data/plugins/<package name>/`. */
export function pluginFolderPath(dataDir: string, name: string): string {
  return path.join(dataDir, 'plugins', ...name.split('/'));
}

function upperSnake(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * What every environment variable of a package starts with, before `__`:
 * `GEEKITY_PLUGIN_LLM` for `@geekity/plugin-llm`. It never contains `__`, so
 * no plugin variable can shadow a core one.
 */
export function pluginEnvPrefix(name: string): string {
  return upperSnake(name);
}

/** The environment variable that sets one setting, such as `GEEKITY_PLUGIN_LLM__API_KEY`. */
export function pluginVariable(name: string, key: string): string {
  return `${pluginEnvPrefix(name)}__${upperSnake(key)}`;
}

const SETTING_KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Why these fields cannot be stored, or `undefined` when they can. */
export function settingFieldsProblem(fields: readonly PluginSettingField[]): string | undefined {
  const seen = new Set<string>();
  for (const field of fields) {
    const key = JSON.stringify(field.key);
    if (!SETTING_KEY.test(field.key)) {
      return `The setting ${key} is not lower case words joined by "_".`;
    }
    if (field.key === 'enabled') return `The setting ${key} is the key that enables the plugin.`;
    if (seen.has(field.key)) return `The setting ${key} is declared twice.`;
    seen.add(field.key);
    if (
      field.type === 'select' &&
      !field.options.some((option) => option.value === field.default)
    ) {
      return `The setting ${key} has a default that is not one of its options.`;
    }
    if (field.type === 'url' && field.default !== undefined && !isWebUrl(field.default)) {
      return `The setting ${key} has a default that is not an http or https URL.`;
    }
  }
  return undefined;
}

/** Every field with its value now, in the order declared. */
export function resolvePluginSettings(place: PluginSettingsPlace): ResolvedSetting[] {
  const stored = readPluginEntry(place.contentDir, place.name);
  const secrets = readSecrets(place.dataDir, place.name);

  return place.fields.map((field): ResolvedSetting => {
    if (field.type === 'secret') {
      const variable = pluginVariable(place.name, field.key);
      const fromEnv = place.env[variable];
      if (fromEnv !== undefined && fromEnv !== '') {
        return { field, value: fromEnv, source: 'environment', problem: undefined, variable };
      }
      const fromFile = secrets[field.key];
      return typeof fromFile === 'string' && fromFile !== ''
        ? { field, value: fromFile, source: 'file', problem: undefined, variable }
        : { field, value: undefined, source: 'default', problem: undefined, variable };
    }

    const fallback = { field, value: defaultOf(field), variable: undefined };
    const raw = stored[field.key];
    if (raw === undefined) return { ...fallback, source: 'default', problem: undefined };
    if (accepts(field, raw)) {
      return { field, value: raw, source: 'site', problem: undefined, variable: undefined };
    }
    return {
      ...fallback,
      source: 'default',
      problem: `The value in site.json is not ${EXPECTED[field.type]}, so the default is in use.`,
    };
  });
}

/** The values a plugin is handed, keyed by field key. */
export function settingValues(
  resolved: readonly ResolvedSetting[],
): Record<string, string | boolean | undefined> {
  return Object.fromEntries(resolved.map((entry) => [entry.field.key, entry.value]));
}

/**
 * Save a submitted form. A field with a value it does not accept refuses the
 * whole save, named in `problems`, and nothing is written. An empty public
 * box removes the key, so the default applies; an empty secret box keeps the
 * stored secret; a secret the environment sets is never written.
 */
export async function savePluginSettings(
  options: PluginSettingsPlace & PluginSettingsSubmission,
): Promise<{ problems: Record<string, string> }> {
  const { fields, values, forget } = options;

  const problems: Record<string, string> = {};
  for (const field of fields) {
    const submitted = values[field.key]?.trim();
    if (submitted === undefined || submitted === '') continue;
    if (field.type === 'url' && !isWebUrl(submitted)) {
      problems[field.key] = `${field.label} must be an http:// or https:// URL.`;
    }
    if (field.type === 'select' && !field.options.some((option) => option.value === submitted)) {
      problems[field.key] = `${field.label} must be one of its choices.`;
    }
  }
  if (Object.keys(problems).length > 0) return { problems };

  const publicFields = fields.filter((field) => field.type !== 'secret');
  if (publicFields.length > 0) {
    await updatePluginEntry(options.contentDir, options.name, (entry) => {
      const next = { ...entry };
      for (const field of publicFields) {
        const submitted = values[field.key];
        if (field.type === 'checkbox') {
          next[field.key] = submitted !== undefined;
          continue;
        }
        if (submitted === undefined) continue;
        const trimmed = submitted.trim();
        if (trimmed === '') delete next[field.key];
        else next[field.key] = trimmed;
      }
      return next;
    });
  }

  const changes = new Map<string, string | undefined>();
  for (const field of fields) {
    if (field.type !== 'secret') continue;
    if (options.env[pluginVariable(options.name, field.key)]) continue;
    const submitted = values[field.key]?.trim() ?? '';
    if (forget.has(field.key)) changes.set(field.key, undefined);
    else if (submitted !== '') changes.set(field.key, submitted);
  }
  if (changes.size > 0) {
    await updateFileAtomically(
      secretsPath(options.dataDir, options.name),
      (current) => {
        const next = parseRecord(current);
        for (const [key, value] of changes) {
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        return `${JSON.stringify(next, null, 2)}\n`;
      },
      { mode: 0o600 },
    );
  }

  return { problems };
}

const EXPECTED: Readonly<Record<Exclude<PluginSettingField['type'], 'secret'>, string>> = {
  text: 'text',
  url: 'an http or https URL',
  select: 'one of its choices',
  checkbox: 'true or false',
};

function defaultOf(field: Exclude<PluginSettingField, { type: 'secret' }>): string | boolean {
  switch (field.type) {
    case 'checkbox':
      return field.default ?? false;
    case 'select':
      return field.default;
    case 'text':
    case 'url':
      return field.default ?? '';
  }
}

function accepts(
  field: Exclude<PluginSettingField, { type: 'secret' }>,
  raw: unknown,
): raw is string | boolean {
  switch (field.type) {
    case 'checkbox':
      return typeof raw === 'boolean';
    case 'select':
      return field.options.some((option) => option.value === raw);
    case 'text':
      return typeof raw === 'string';
    case 'url':
      return typeof raw === 'string' && isWebUrl(raw);
  }
}

function isWebUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === 'http:' || protocol === 'https:';
}

function secretsPath(dataDir: string, name: string): string {
  return path.join(pluginFolderPath(dataDir, name), SECRETS_FILE);
}

function readSecrets(dataDir: string, name: string): Record<string, unknown> {
  return parseRecord(readFileIfPresentSync(secretsPath(dataDir, name)));
}

function parseRecord(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
