import path from 'node:path';

import type { PluginSettingField } from '../plugin.ts';
import { boolean, nonEmptyText, oneOf, text } from '../settings/kinds.ts';
import { pluginEnvPrefix, SETTING_NAME } from '../settings/names.ts';
import type { DeclaredNamespace, SettingDeclaration, SettingType } from '../settings/types.ts';

export const SETTINGS_FILE = 'settings.json';
export const SECRETS_FILE = 'secrets.json';

export function pluginsFolderPath(dataDir: string): string {
  return path.join(dataDir, 'plugins');
}

/** `data/plugins/<package name>/`. */
export function pluginFolderPath(dataDir: string, name: string): string {
  return path.join(pluginsFolderPath(dataDir), ...name.split('/'));
}

/** Why these fields cannot be stored, or `undefined` when they can. */
export function settingFieldsProblem(fields: readonly PluginSettingField[]): string | undefined {
  const seen = new Set<string>();
  for (const field of fields) {
    const key = JSON.stringify(field.key);
    if (!SETTING_NAME.test(field.key)) {
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

export function pluginNamespace(
  name: string,
  settings: readonly SettingDeclaration<unknown>[],
): DeclaredNamespace {
  return {
    declaration: {
      namespace: name,
      storage: {
        kind: 'folder',
        under: 'data',
        path: path.posix.join('plugins', name),
        publicFile: SETTINGS_FILE,
        secretFile: SECRETS_FILE,
      },
      envPrefix: pluginEnvPrefix(name),
      settings,
    },
  };
}

export function pluginSetting(field: PluginSettingField): SettingDeclaration<unknown> {
  const described = { key: field.key, description: field.hint ?? field.label };
  switch (field.type) {
    case 'text':
      return { ...described, type: text, default: field.default ?? '' };
    case 'url':
      return { ...described, type: webUrl, default: field.default ?? '' };
    case 'select':
      return {
        ...described,
        type: oneOf(field.options.map((option) => option.value)),
        default: field.default,
      };
    case 'checkbox':
      return { ...described, type: boolean, default: field.default ?? false };
    case 'secret':
      return { ...described, type: nonEmptyText, default: undefined, secret: true };
  }
}

const webUrl: SettingType<string> = {
  fromJson: (raw) =>
    typeof raw === 'string' && isWebUrl(raw)
      ? { ok: true, value: raw }
      : { ok: false, problem: 'must be an http:// or https:// URL' },
  fromText: (value) => webUrl.fromJson(value.trim()),
  toJson: (value) => value,
  toText: (value) => value,
};

function isWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === 'http:' || protocol === 'https:';
}
