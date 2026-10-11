/**
 * The settings as the settings screens' form carries them: what each field is
 * submitted under, how a setting is shown, what is wrong with a submitted one
 * and the settings a valid form saves.
 */
import { FORM_ROWS, ROWS, SETTING_KEYS, SETTINGS_FIELD_NAMES } from './setting-rows.ts';
import type {
  CarriedSettings,
  SettingsContext,
  SettingsField,
  SettingsForm,
} from './setting-rows.ts';
import { DEFAULT_SITE_SETTINGS } from './settings.ts';
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

/** One value per form field. */
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
 * not show and gives no way to fix. `context` is what a check needs beyond the
 * form; see {@link SettingsContext}.
 */
export function settingsProblems(
  form: SettingsForm,
  fields: readonly SettingsField[] = SETTINGS_FIELD_NAMES,
  context: SettingsContext = {},
): SettingsProblems {
  const problems: SettingsProblems = {};

  for (const name of fields) {
    const problem = FORM_ROWS[name].check(form, context);
    if (problem !== undefined) problems[name] = problem;
  }

  return problems;
}

function submitSetting<K extends keyof SiteSettings>(
  settings: SiteSettings,
  key: K,
  form: SettingsForm,
  carried: CarriedSettings,
): void {
  settings[key] = ROWS[key].submitted(form, carried);
}

/**
 * A validated form as settings. Only call it on a form
 * {@link settingsProblems} found nothing wrong with.
 *
 * The settings no form carries are passed in rather than read off the form:
 * a save of the fields that are on the form keeps whatever is stored, so
 * passing the settings read inside the write is all a caller has to do.
 */
export function settingsFromForm(form: SettingsForm, carried: CarriedSettings = {}): SiteSettings {
  const settings = { ...DEFAULT_SITE_SETTINGS };
  for (const key of SETTING_KEYS) submitSetting(settings, key, form, carried);
  return settings;
}

function shownSetting<K extends SettingsField>(settings: SiteSettings, key: K): string {
  return FORM_ROWS[key].shown(settings[key]);
}

/** The settings as the form shows them. */
export function formFromSettings(settings: SiteSettings): SettingsForm {
  return perField((name) => shownSetting(settings, name));
}
