import path from 'node:path';

import { LANGUAGE_TAG_PATTERN } from '../content/language.ts';
import { isLocationSharing, LOCATION_SHARING } from '../content/location.ts';
import { parseIconSetting } from '../images/icon-setting.ts';
import { sourceFile } from '../images/paths.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import { isFileSync } from '../util/files.ts';
import { DEFAULT_FEED_CADENCE, isUpdatePeriod, UPDATE_PERIODS } from '../site/feed-settings.ts';
import { isLicenseUrl } from '../content/license.ts';
import { canonicalLocale } from '../content/locale.ts';
import { AI_CRAWLER_POLICIES, robotsRuleLines, robotsRuleProblem } from '../site/robots.ts';
import { taxonomyBaseProblems } from '../content/taxonomy.ts';
import { PACKAGED_THEME, readTheme, themeNameProblem } from '../theme/themes.ts';
import {
  EMAIL_PATTERN,
  isAiCrawlerPolicy,
  isContentSignalChoice,
  isLicenseChoice,
  isMailProvider,
  isPollCount,
  isValidTimezone,
  isWholeDays,
  normalizeBaseUrl,
  normalizeLanguageList,
  normalizeRelayInbox,
  normalizeSecurityContact,
  normalizeSecurityPolicy,
  relayLines,
  relayList,
  securityContactList,
} from '../site/setting-values.ts';

import { DEFAULT_SITE_SETTINGS, SITE } from '../site/settings.ts';
import type { SiteLicense, SiteSettings } from '../site/settings.ts';

type OffTheForm =
  | 'taxonomy_redirects'
  | 'menus'
  | 'index_now_key'
  | 'clients_without_pkce'
  | 'avatar'
  | 'color_scheme'
  | 'color_mode'
  | 'heading_font'
  | 'body_font';

type FormKey = Exclude<keyof SiteSettings, OffTheForm>;

export type SettingsField = FormKey | 'license_url' | 'license_name';

export type SettingsForm = Record<SettingsField, string>;

export interface SettingsDirs {
  readonly themesDir: string;
  readonly contentDir: string;
}

export type SettingsContext = { readonly [D in keyof SettingsDirs]?: string | undefined };

export interface OnDiskCheck {
  readonly dir: keyof SettingsDirs;
  readonly problem: (value: string, dir: string) => string | undefined;
}

interface FieldRow<V> {
  readonly field: string;
  readonly shown: (value: V) => string;
  readonly check: (form: SettingsForm) => string | undefined;
  readonly onDisk?: OnDiskCheck;
}

interface FormSettingRow<V> extends FieldRow<V> {
  readonly submitted: (form: SettingsForm) => V;
}

type FieldValue<F extends SettingsField> = F extends keyof SiteSettings
  ? SiteSettings[F]
  : SiteLicense;

type SettingRows = { readonly [K in FormKey]: FormSettingRow<SiteSettings[K]> };

const checkbox = (value: boolean): string => (value ? '1' : '');
const ticked = (value: string): boolean => value !== '';
const asIs = (value: string): string => value;
const lines = (value: readonly string[]): string => value.join('\n');
const nothingWrong = (): undefined => undefined;

type TextField = {
  [K in FormKey]: string extends SiteSettings[K] ? K : never;
}[FormKey];

type FlagField = {
  [K in FormKey]: SiteSettings[K] extends boolean ? K : never;
}[FormKey];

type ChoiceField =
  'feed_update_period' | 'ai_crawlers' | ContentSignalField | 'mail_provider' | 'location_sharing';

type ContentSignalField =
  'content_signal_search' | 'content_signal_ai_input' | 'content_signal_ai_train';

type RetentionField =
  'comment_email_retention_days' | 'address_hash_retention_days' | 'contact_message_retention_days';

type ListField = 'robots_rules' | 'security_contacts' | 'relays';

function text(
  key: TextField,
  field: string,
  options: { check?: FormSettingRow<string>['check'] } = {},
): FormSettingRow<string> {
  return {
    field,
    submitted: (form) => form[key].trim(),
    shown: asIs,
    check: options.check ?? nothingWrong,
  };
}

function flag(key: FlagField, field: string): FormSettingRow<boolean> {
  return {
    field,
    submitted: (form) => ticked(form[key]),
    shown: checkbox,
    check: nothingWrong,
  };
}

function choice<K extends ChoiceField>(
  key: K,
  field: string,
  guard: (value: unknown) => value is SiteSettings[K],
  fallback: SiteSettings[K],
  problem: string,
): FormSettingRow<SiteSettings[K]> {
  return {
    field,
    submitted: (form) => (guard(form[key]) ? form[key] : fallback),
    shown: (value) => value,
    check: (form) => (guard(form[key]) ? undefined : problem),
  };
}

export function requiredWholeDays(typed: string): number | undefined {
  const trimmed = typed.trim();
  if (trimmed === '') return undefined;
  const days = Number(trimmed);
  return isWholeDays(days) ? days : undefined;
}

function retention(key: RetentionField, field: string): FormSettingRow<number> {
  return {
    field,
    submitted: (form) => Number(form[key]),
    shown: String,
    check: (form) =>
      requiredWholeDays(form[key]) === undefined
        ? 'Keep it for a whole number of days, or 0 to keep it forever.'
        : undefined,
  };
}

function contentSignal<K extends ContentSignalField>(
  key: K,
  field: string,
): FormSettingRow<SiteSettings[K]> {
  return choice(key, field, isContentSignalChoice, '', 'A content signal is yes, no, or not said.');
}

function list(
  key: ListField,
  field: string,
  parse: (typed: string) => string[],
  check: FormSettingRow<readonly string[]>['check'],
): FormSettingRow<readonly string[]> {
  return {
    field,
    submitted: (form) => parse(form[key]),
    shown: lines,
    check,
  };
}

const isCustomLicense = (form: SettingsForm): boolean => form.license.trim() === 'custom';

const PAGE_SLUG_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

function slugProblem(value: string, what: string): string | undefined {
  const slug = value.trim();
  return slug === '' || PAGE_SLUG_PATTERN.test(slug)
    ? undefined
    : `${what} is the slug of one of the site's pages, such as about.`;
}

function iconProblem(icon: string): string | undefined {
  if (icon === '') return undefined;

  const parsed = parseIconSetting(icon);
  if (!('problem' in parsed)) return undefined;
  return parsed.problem === 'not-an-upload'
    ? 'The site icon has to be a file in the media library, a path such as /uploads/2026/10/icon.png.'
    : 'The site icon has to be an image: PNG, JPEG, GIF, WebP, AVIF, TIFF or SVG.';
}

const ICON_UPLOADED: OnDiskCheck = {
  dir: 'contentDir',
  problem: (icon, contentDir) => {
    const parsed = parseIconSetting(icon);
    if ('problem' in parsed) return undefined;
    const file = sourceFile({ contentDir }, parsed.source);
    return file !== undefined && isFileSync(file)
      ? undefined
      : `There is no upload at ${icon}. Upload the picture on the Media screen first.`;
  },
};

export type FrontPage = Pick<SiteSettings, 'homepage' | 'posts_page'>;

export function frontPageOf(form: SettingsForm): FrontPage {
  const homepage = form.homepage.trim();
  return { homepage, posts_page: homepage === '' ? '' : form.posts_page.trim() };
}

export function frontPageProblems(form: SettingsForm): {
  readonly [K in keyof FrontPage]?: string | undefined;
} {
  const homepage = form.homepage.trim();
  return {
    homepage: slugProblem(homepage, 'A homepage'),
    posts_page: postsPageProblem(homepage, form.posts_page.trim()),
  };
}

function postsPageProblem(homepage: string, posts_page: string): string | undefined {
  if (posts_page === '') return undefined;
  if (homepage === '') {
    return 'A posts page needs a homepage: pick the page the front page shows first.';
  }
  if (posts_page === homepage) {
    return 'The homepage and the posts page have to be two different pages.';
  }
  return slugProblem(posts_page, 'A posts page');
}

function frontPageRows(): { readonly [K in keyof FrontPage]: FormSettingRow<string> } {
  const row = (key: keyof FrontPage, field: string): FormSettingRow<string> => ({
    ...text(key, field),
    submitted: (form) => frontPageOf(form)[key],
    check: (form) => frontPageProblems(form)[key],
  });
  return { homepage: row('homepage', 'homepage'), posts_page: row('posts_page', 'posts_page') };
}

function emailCheck(key: TextField, problem: string): FormSettingRow<string>['check'] {
  return (form) =>
    form[key].trim() !== '' && !EMAIL_PATTERN.test(form[key].trim()) ? problem : undefined;
}

const THEME_INSTALLED: OnDiskCheck = {
  dir: 'themesDir',
  problem: (name, themesDir) => {
    if (name === PACKAGED_THEME) return undefined;
    const read = readTheme(path.join(themesDir, name));
    return read.ok ? undefined : `There is no theme called "${name}": ${read.reason}`;
  },
};

const SETTING_ROWS: SettingRows = {
  title: text('title', 'title', {
    check: (form) => (form.title.trim() === '' ? 'The site needs a title.' : undefined),
  }),

  tagline: text('tagline', 'tagline'),

  base_url: {
    field: 'base_url',
    submitted: (form) => normalizeBaseUrl(form.base_url) ?? '',
    shown: asIs,
    check: (form) =>
      normalizeBaseUrl(form.base_url) === undefined
        ? 'The base URL has to be an absolute http:// or https:// URL.'
        : undefined,
  },

  posts_per_page: {
    field: 'posts_per_page',
    submitted: (form) => Number(form.posts_per_page),
    shown: String,
    check: (form) => {
      const perPage = Number(form.posts_per_page);
      return !Number.isInteger(perPage) || perPage < 1
        ? 'Posts per page has to be a whole number of one or more.'
        : undefined;
    },
  },

  timezone: text('timezone', 'timezone', {
    check: (form) =>
      isValidTimezone(form.timezone)
        ? undefined
        : 'That is not an IANA time zone name, such as Europe/London.',
  }),

  language: text('language', 'language', {
    check: (form) =>
      LANGUAGE_TAG_PATTERN.test(form.language.trim())
        ? undefined
        : 'That is not a language tag, such as en, en-GB or pt-BR.',
  }),

  tag_base: text('tag_base', 'tag_base', {
    check: (form) => taxonomyBaseProblems({ tag: form.tag_base, category: form.category_base }).tag,
  }),

  category_base: text('category_base', 'category_base', {
    check: (form) =>
      taxonomyBaseProblems({ tag: form.tag_base, category: form.category_base }).category,
  }),

  comments: flag('comments', 'comments'),

  comments_on_posts: flag('comments_on_posts', 'comments_on_posts'),

  comments_on_pages: flag('comments_on_pages', 'comments_on_pages'),

  comments_close_after_days: {
    field: 'comments_close_after_days',
    submitted: (form) => Number(form.comments_close_after_days),
    shown: String,
    check: (form) => {
      const typed = form.comments_close_after_days.trim();
      const days = Number(typed);
      return typed === '' || !Number.isInteger(days) || days < 0
        ? 'Comments close after a whole number of days, or 0 for never.'
        : undefined;
    },
  },

  comment_email_retention_days: retention(
    'comment_email_retention_days',
    'comment_email_retention_days',
  ),

  address_hash_retention_days: retention(
    'address_hash_retention_days',
    'address_hash_retention_days',
  ),

  contact_message_retention_days: retention(
    'contact_message_retention_days',
    'contact_message_retention_days',
  ),

  webmentions_send: flag('webmentions_send', 'webmentions_send'),

  webmentions_receive: flag('webmentions_receive', 'webmentions_receive'),

  notify_server: {
    ...text('notify_server', 'notify_server'),
    submitted: (form) => normalizeBaseUrl(form.notify_server) ?? '',
    check: (form) =>
      form.notify_server.trim() !== '' && normalizeBaseUrl(form.notify_server) === undefined
        ? 'A notify server is an absolute http:// or https:// URL, or empty for none.'
        : undefined,
  },

  feed_update_period: choice(
    'feed_update_period',
    'feed_update_period',
    isUpdatePeriod,
    DEFAULT_FEED_CADENCE.period,
    `An update period is one of ${UPDATE_PERIODS.join(', ')}.`,
  ),

  feed_update_frequency: {
    field: 'feed_update_frequency',
    submitted: (form) => Number(form.feed_update_frequency),
    shown: String,
    check: (form) =>
      form.feed_update_frequency.trim() !== '' && isPollCount(Number(form.feed_update_frequency))
        ? undefined
        : 'Polls per period is a whole number, 1 or more.',
  },

  ai_crawlers: choice(
    'ai_crawlers',
    'ai_crawlers',
    isAiCrawlerPolicy,
    'allow',
    `An AI-crawler policy is one of ${AI_CRAWLER_POLICIES.join(', ')}.`,
  ),

  content_signal_search: contentSignal('content_signal_search', 'content_signal_search'),

  content_signal_ai_input: contentSignal('content_signal_ai_input', 'content_signal_ai_input'),

  content_signal_ai_train: contentSignal('content_signal_ai_train', 'content_signal_ai_train'),

  robots_rules: list(
    'robots_rules',
    'robots_rules',
    (typed) => robotsRuleLines([typed]),
    (form) => robotsRuleProblem([form.robots_rules]),
  ),

  llms_txt: flag('llms_txt', 'llms_txt'),

  header_icon: flag('header_icon', 'header_icon'),

  index_now: flag('index_now', 'index_now'),

  mail_provider: choice(
    'mail_provider',
    'mail_provider',
    isMailProvider,
    'none',
    `A mail provider is one of ${MAIL_PROVIDERS.join(', ')}.`,
  ),

  mail_from_name: text('mail_from_name', 'mail_from_name'),

  mail_from_address: text('mail_from_address', 'mail_from_address', {
    check: emailCheck(
      'mail_from_address',
      'A From address is an email address, such as blog@example.com, or empty for the default.',
    ),
  }),

  mail_reply_to: text('mail_reply_to', 'mail_reply_to', {
    check: emailCheck(
      'mail_reply_to',
      'A reply-to is an email address, such as hello@example.com, or empty to reply to the From address.',
    ),
  }),

  contact_email: text('contact_email', 'contact_email', {
    check: emailCheck(
      'contact_email',
      'A contact address is an email address, such as hello@example.com, or empty for the first admin with one.',
    ),
  }),

  security_contacts: list('security_contacts', 'security_contacts', securityContactList, (form) => {
    const bad = relayLines(form.security_contacts).find(
      (line) => normalizeSecurityContact(line) === undefined,
    );
    return bad === undefined
      ? undefined
      : 'A security contact is an email address, an https:// URL or a tel: number, one per line. ' +
          `"${bad}" is not one.`;
  }),

  // RFC 9116 wants every web URI in the file to be https.
  security_policy: {
    ...text('security_policy', 'security_policy'),
    submitted: (form) => normalizeSecurityPolicy(form.security_policy) ?? '',
    check: (form) =>
      form.security_policy.trim() !== '' &&
      normalizeSecurityPolicy(form.security_policy) === undefined
        ? 'A security policy is an https:// URL, or empty for none.'
        : undefined,
  },

  security_languages: {
    ...text('security_languages', 'security_languages'),
    submitted: (form) => normalizeLanguageList(form.security_languages) ?? '',
    check: (form) =>
      normalizeLanguageList(form.security_languages) === undefined
        ? 'Preferred languages are language tags separated by commas, such as en, fr, or empty for none.'
        : undefined,
  },

  relays: list('relays', 'relays', relayList, (form) => {
    const bad = relayLines(form.relays).find((line) => normalizeRelayInbox(line) === undefined);
    return bad === undefined
      ? undefined
      : `A relay is its inbox as an absolute http:// or https:// URL, one per line. ` +
          `"${bad}" is not one.`;
  }),

  location_sharing: choice(
    'location_sharing',
    'location_sharing',
    isLocationSharing,
    'none',
    `Location sharing is one of ${LOCATION_SHARING.join(', ')}.`,
  ),

  ...frontPageRows(),

  theme: {
    ...text('theme', 'theme', { check: (form) => themeNameProblem(form.theme) }),
    onDisk: THEME_INSTALLED,
  },

  locale: text('locale', 'locale', {
    check: (form) => {
      const locale = form.locale.trim();
      return locale === '' ||
        (LANGUAGE_TAG_PATTERN.test(locale) && canonicalLocale(locale) !== undefined)
        ? undefined
        : 'That is not a locale, such as en-US, fr-CA or pt-BR, or empty for the language.';
    },
  }),

  author: text('author', 'author'),

  icon: {
    ...text('icon', 'icon', { check: (form) => iconProblem(form.icon.trim()) }),
    onDisk: ICON_UPLOADED,
  },

  license: {
    field: 'license',
    submitted: (form) => {
      const choice = form.license.trim();
      if (!isLicenseChoice(choice) || choice === '') return DEFAULT_SITE_SETTINGS.license;
      return choice === 'custom'
        ? { choice, url: form.license_url.trim(), name: form.license_name.trim() }
        : { choice, url: '', name: '' };
    },
    shown: (value) => value.choice,
    check: (form) =>
      isLicenseChoice(form.license.trim()) ? undefined : 'Choose a license from the list.',
  },
};

const LICENSE_FIELD_ROWS: {
  readonly [F in 'license_url' | 'license_name']: FieldRow<SiteLicense>;
} = {
  license_url: {
    field: 'license_url',
    shown: (value) => value.url,
    check: (form) =>
      isCustomLicense(form) && !isLicenseUrl(form.license_url.trim())
        ? 'A custom license needs the URL of its terms, starting http:// or https://.'
        : undefined,
  },
  license_name: {
    field: 'license_name',
    shown: (value) => value.name,
    check: (form) =>
      isCustomLicense(form) && form.license_name.trim() === ''
        ? 'A custom license needs a name for the footer to show.'
        : undefined,
  },
};

const FORM_ROWS: { readonly [F in SettingsField]: FieldRow<FieldValue<F>> } = {
  ...SETTING_ROWS,
  ...LICENSE_FIELD_ROWS,
};

export const SETTINGS_FIELD_NAMES = Object.keys(FORM_ROWS) as readonly SettingsField[];

export type SettingsProblems = Partial<Record<SettingsField, string>>;

function perField<V>(value: (name: SettingsField) => V): Record<SettingsField, V> {
  return Object.fromEntries(SETTINGS_FIELD_NAMES.map((name) => [name, value(name)])) as Record<
    SettingsField,
    V
  >;
}

export const SETTINGS_FIELDS: Readonly<Record<SettingsField, string>> = perField(
  (name) => FORM_ROWS[name].field,
);

export function settingOf(field: SettingsField): FormKey {
  return field === 'license_url' || field === 'license_name' ? 'license' : field;
}

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

export function submittedSettings(
  form: SettingsForm,
  fields: readonly SettingsField[],
): Partial<SiteSettings> {
  const keys = [...new Set(fields.map(settingOf))];
  return Object.fromEntries(keys.map((key) => [key, SETTING_ROWS[key].submitted(form)]));
}

export function siteChanges(settings: Partial<SiteSettings>): Map<string, unknown> {
  const changes = new Map<string, unknown>();
  for (const declaration of SITE.declaration.settings) {
    if (!(declaration.key in settings)) continue;
    const value = (settings as Readonly<Record<string, unknown>>)[declaration.key];
    changes.set(declaration.key, declaration.type.toJson(value));
  }
  return changes;
}

function shownSetting<F extends SettingsField>(settings: SiteSettings, name: F): string {
  const value = settings[settingOf(name)] as FieldValue<F>;
  return FORM_ROWS[name].shown(value);
}

export function formFromSettings(settings: SiteSettings): SettingsForm {
  return perField((name) => shownSetting(settings, name));
}
