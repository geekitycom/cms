import { FORM_ROWS, ROWS, SETTING_KEYS, SETTINGS_FIELD_NAMES } from './setting-rows.ts';
import type {
  CarriedSettings,
  FieldValue,
  SettingsContext,
  SettingsField,
  SettingsForm,
} from './setting-rows.ts';
import type { SiteSettings } from './settings.ts';

export { SETTINGS_FIELD_NAMES } from './setting-rows.ts';
export type {
  CarriedSettings,
  SettingsContext,
  SettingsField,
  SettingsForm,
} from './setting-rows.ts';

/** One message per field that is wrong. An empty object is a valid form. */
export type SettingsProblems = Partial<Record<SettingsField, string>>;

function perField<V>(value: (name: SettingsField) => V): Record<SettingsField, V> {
  return Object.fromEntries(SETTINGS_FIELD_NAMES.map((name) => [name, value(name)])) as Record<
    SettingsField,
    V
  >;
}

/** The form field each setting is submitted under. */
export const SETTINGS_FIELDS: Readonly<Record<SettingsField, string>> = perField(
  (name) => FORM_ROWS[name].field,
);

/**
 * What is wrong with a submitted settings form, one message per field.
 *
 * `fields` is what a page carries: it validates its own fields and says
 * nothing about the rest, so a page cannot refuse a save over a field it does
 * not show and gives no way to fix. `context` names the directories the
 * on-disk checks read, and an on-disk check runs only when its directory is
 * named.
 */
export function settingsProblems(
  form: SettingsForm,
  fields: readonly SettingsField[] = SETTINGS_FIELD_NAMES,
  context: SettingsContext = {},
): SettingsProblems {
  const problems: SettingsProblems = {};

  for (const name of fields) {
    const problem = FORM_ROWS[name].check(form) ?? onDiskProblem(name, form, context);
    if (problem !== undefined) problems[name] = problem;
  }

  return problems;
}

function onDiskProblem(
  name: SettingsField,
  form: SettingsForm,
  context: SettingsContext,
): string | undefined {
  const onDisk = FORM_ROWS[name].onDisk;
  if (onDisk === undefined) return undefined;
  const dir = context[onDisk.dir];
  return dir === undefined ? undefined : onDisk.problem(form[name].trim(), dir);
}

/**
 * A validated form as settings. Only call it on a form
 * {@link settingsProblems} found nothing wrong with.
 *
 * The settings no form carries are passed in rather than read off the form:
 * a save of the fields that are on the form keeps whatever is stored, so
 * passing the settings read inside the write is all a caller has to do.
 */
export function settingsFromForm(
  form: SettingsForm,
  carriedOnFile: CarriedSettings = {},
): SiteSettings {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, ROWS[key].submitted(form, carriedOnFile)]),
  ) as SiteSettings;
}

function shownSetting<F extends SettingsField>(settings: SiteSettings, name: F): string {
  const value = (
    name === 'license_url' || name === 'license_name'
      ? settings.license
      : settings[name as keyof SiteSettings]
  ) as FieldValue<F>;
  return FORM_ROWS[name].shown(value);
}

/** The settings as the form shows them. */
export function formFromSettings(settings: SiteSettings): SettingsForm {
  return perField((name) => shownSetting(settings, name));
}
