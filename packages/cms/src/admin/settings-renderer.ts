/**
 * The optional generic settings form (decision-53 section 9): a list of
 * settings with a label, a hint and a widget, drawn from what the registry
 * resolves and saved through `set`. A setting the environment or the config
 * sets is drawn with what sets it and no box, and a save leaves it alone.
 */

import { overridden, sourceText } from '../settings/registry.ts';
import { settingVariable } from '../settings/names.ts';
import type { SetResult, SettingRef, SettingsRegistry } from '../settings/types.ts';

export type SettingWidget = 'text' | 'url' | 'select' | 'checkbox' | 'secret';

export interface RenderedSetting {
  readonly ref: SettingRef<unknown>;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly widget: SettingWidget;
  readonly options?: readonly { readonly value: string; readonly label: string }[] | undefined;
}

/** A form as submitted: each box by key, and the secrets to forget. */
export interface SettingsForm {
  readonly values: Readonly<Record<string, string>>;
  readonly forget: ReadonlySet<string>;
}

const SETTING_PREFIX = 'setting.';
const FORGET_PREFIX = 'forget.';

export function settingsForm(body: Readonly<Record<string, unknown>>): SettingsForm {
  const values: Record<string, string> = {};
  const forget = new Set<string>();
  for (const [field, value] of Object.entries(body)) {
    if (typeof value !== 'string') continue;
    if (field.startsWith(SETTING_PREFIX)) values[field.slice(SETTING_PREFIX.length)] = value;
    if (field.startsWith(FORGET_PREFIX)) forget.add(field.slice(FORGET_PREFIX.length));
  }
  return { values, forget };
}

/**
 * Each setting as the form draws it. A secret carries whether it is set and
 * never its value; a refused form shows what was typed.
 */
export async function settingViews(
  settings: SettingsRegistry,
  envPrefix: string,
  fields: readonly RenderedSetting[],
  refused: { problems?: Readonly<Record<string, string>>; submitted?: SettingsForm } = {},
) {
  return await Promise.all(
    fields.map(async (field) => {
      const { ref, widget } = field;
      const resolved = await settings.resolve(ref);
      const typed = refused.submitted?.values;
      const value =
        typed === undefined ? ref.declaration.type.toText(resolved.value) : (typed[ref.key] ?? '');
      const checked = typed === undefined ? resolved.value === true : typed[ref.key] !== undefined;
      return {
        key: ref.key,
        widget,
        id: `setting-${ref.key}`,
        name: `${SETTING_PREFIX}${ref.key}`,
        forgetName: `${FORGET_PREFIX}${ref.key}`,
        label: field.label,
        hint: field.hint,
        value: widget === 'secret' ? '' : value,
        checked,
        options: (field.options ?? []).map((option) => ({
          ...option,
          selected: option.value === value,
        })),
        error: refused.problems?.[ref.key],
        stored:
          resolved.problem === undefined ? undefined : `${resolved.problem}, so it is set aside.`,
        setBy: overridden(resolved.source) ? sourceText(resolved.source) : undefined,
        storedSet: resolved.stored !== undefined,
        variable: ref.declaration.env === false ? undefined : settingVariable(envPrefix, ref.key),
      };
    }),
  );
}

/**
 * Save a submitted form. A value that does not parse refuses the whole save,
 * named by its label, and nothing is written. An empty box removes the key,
 * so the default applies; an empty secret box keeps the stored secret; a
 * setting something else sets is not written.
 */
export async function saveSettings(
  settings: SettingsRegistry,
  namespace: string,
  fields: readonly RenderedSetting[],
  form: SettingsForm,
): Promise<SetResult> {
  const changes = new Map<string, unknown>();
  const problems: Record<string, string> = {};
  for (const { ref, label, widget } of fields) {
    if (overridden((await settings.resolve(ref)).source)) continue;
    const submitted = form.values[ref.key]?.trim();
    if (widget === 'checkbox') {
      changes.set(ref.key, submitted !== undefined);
      continue;
    }
    if (widget === 'secret' && form.forget.has(ref.key)) {
      changes.set(ref.key, undefined);
      continue;
    }
    if (submitted === undefined || (submitted === '' && widget === 'secret')) continue;
    if (submitted === '') {
      changes.set(ref.key, undefined);
      continue;
    }
    const { type } = ref.declaration;
    const parsed = type.fromText(submitted);
    if (parsed.ok) changes.set(ref.key, type.toJson(parsed.value));
    else problems[ref.key] = `${label} ${parsed.problem}.`;
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return await settings.set(namespace, changes, 'admin');
}
