import path from 'node:path';

import { LANGUAGE_TAG_PATTERN } from '../content/language.ts';
import { isLocationSharing, LOCATION_SHARING } from '../content/location.ts';
import { parseIconSetting } from '../images/icons.ts';
import { sourceFile } from '../images/paths.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import { isFileSync } from '../util/files.ts';
import { DEFAULT_FEED_CADENCE, isUpdatePeriod, UPDATE_PERIODS } from './feed-settings.ts';
import { generateIndexNowKey, isIndexNowKey } from './indexnow-key.ts';
import { classifyLicense, isLicenseUrl, NO_LICENSE } from '../content/license.ts';
import { canonicalLocale } from '../content/locale.ts';
import { menusOf } from './navigation.ts';
import { AI_CRAWLER_POLICIES, robotsRuleLines, robotsRuleProblem } from './robots.ts';
import { taxonomyBaseProblems, taxonomyRedirectsOf } from '../content/taxonomy.ts';
import { PACKAGED_THEME, readTheme, themeNameProblem } from '../theme/themes.ts';
import {
  clientsWithoutPkceOf,
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
} from './setting-values.ts';
import { DEFAULT_SITE_SETTINGS } from './settings.ts';
import type { SiteSettings } from './settings.ts';

export type CarriedField = 'taxonomyRedirects' | 'menus' | 'indexNowKey' | 'clientsWithoutPkce';

/** The settings the form on the settings screen carries. */
export type SettingsField = Exclude<keyof SiteSettings, CarriedField>;

export type CarriedSettings = Partial<Pick<SiteSettings, CarriedField>>;

/** A submitted settings form, before it is known to be valid. */
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

type SiteJson = Readonly<Record<string, unknown>>;

export interface SettingRow<V> {
  readonly read: (file: SiteJson) => V | undefined;
  readonly write: (file: Record<string, unknown>, settings: SiteSettings) => void;
  readonly submitted: (form: SettingsForm, onFile: CarriedSettings) => V;
}

export interface FormSettingRow<V> extends SettingRow<V> {
  readonly field: string;
  readonly shown: (value: V) => string;
  readonly check: (form: SettingsForm) => string | undefined;
  readonly onDisk?: OnDiskCheck;
}

type CarriedRow<K extends CarriedField> = SettingRow<SiteSettings[K]> & { readonly field?: never };

type SettingRows = { readonly [K in SettingsField]: FormSettingRow<SiteSettings[K]> } & {
  readonly [K in CarriedField]: CarriedRow<K>;
};

type Writer = SettingRow<unknown>['write'];

function always(key: string, value: (settings: SiteSettings) => unknown): Writer {
  return (file, settings) => {
    file[key] = value(settings);
  };
}

function unlessEmpty(key: TextField | 'indexNowKey' | 'clientsWithoutPkce'): Writer {
  return (file, settings) => {
    const value = settings[key];
    if (value.length === 0) delete file[key];
    else file[key] = typeof value === 'string' ? value : [...value];
  };
}

function stringIn(file: SiteJson, key: string): string | undefined {
  const value = file[key];
  return typeof value === 'string' ? value : undefined;
}

function nonEmptyStringIn(file: SiteJson, key: string): string | undefined {
  const value = stringIn(file, key);
  return value === '' ? undefined : value;
}

function stringsIn(file: SiteJson, key: string): string[] | undefined {
  const value = file[key];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : undefined;
}

function chosen<V>(
  file: SiteJson,
  key: string,
  guard: (value: unknown) => value is V,
): V | undefined {
  const value = file[key];
  return guard(value) ? value : undefined;
}

const checkbox = (value: boolean): string => (value ? '1' : '');
const ticked = (value: string): boolean => value !== '';
const asIs = (value: string): string => value;
const lines = (value: readonly string[]): string => value.join('\n');
const nothingWrong = (): undefined => undefined;

type TextField = {
  [K in SettingsField]: string extends SiteSettings[K] ? K : never;
}[SettingsField];

type FlagField = {
  [K in SettingsField]: SiteSettings[K] extends boolean ? K : never;
}[SettingsField];

type ChoiceField =
  'feedUpdatePeriod' | 'aiCrawlers' | ContentSignalField | 'mailProvider' | 'locationSharing';

type ContentSignalField = 'contentSignalSearch' | 'contentSignalAiInput' | 'contentSignalAiTrain';

type RetentionField =
  'commentEmailRetentionDays' | 'addressHashRetentionDays' | 'contactMessageRetentionDays';

type ListField = 'robotsRules' | 'securityContacts' | 'relays';

function text(
  key: TextField,
  field: string,
  options: {
    empty: 'value' | 'default' | 'absent';
    check?: FormSettingRow<string>['check'];
  },
): FormSettingRow<string> {
  return {
    field,
    read: (file) =>
      options.empty === 'default' ? nonEmptyStringIn(file, key) : stringIn(file, key),
    write: options.empty === 'absent' ? unlessEmpty(key) : always(key, (settings) => settings[key]),
    submitted: (form) => form[key].trim(),
    shown: asIs,
    check: options.check ?? nothingWrong,
  };
}

/** A checkbox, which submits nothing at all when it is clear. */
function flag(key: FlagField, field: string): FormSettingRow<boolean> {
  return {
    field,
    read: (file) => chosen(file, key, (value) => typeof value === 'boolean'),
    write: always(key, (settings) => settings[key]),
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
    read: (file) => chosen(file, key, guard),
    write: always(key, (settings) => settings[key]),
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
    read: (file) => chosen(file, key, isWholeDays),
    write: always(key, (settings) => settings[key]),
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
    read: (file) => {
      const entries = stringsIn(file, key);
      return entries === undefined ? undefined : parse(entries.join('\n'));
    },
    write: always(key, (settings) => [...settings[key]]),
    submitted: (form) => parse(form[key]),
    shown: lines,
    check,
  };
}

function licenseIn(
  file: SiteJson,
): Pick<SiteSettings, 'license' | 'licenseUrl' | 'licenseName'> | undefined {
  const said = classifyLicense(file['license']);
  if (said === undefined || said === NO_LICENSE) return undefined;
  if ('key' in said) return { license: said.key, licenseUrl: '', licenseName: '' };
  return {
    license: 'custom',
    licenseUrl: said.url,
    licenseName: stringIn(file, 'licenseName')?.trim() ?? '',
  };
}

const isCustomLicense = (form: SettingsForm): boolean => form.license.trim() === 'custom';

const PAGE_SLUG_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

/** What is wrong with one page pick, or `undefined`. Empty is a value. */
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

export type FrontPage = Pick<SiteSettings, 'homepage' | 'postsPage'>;

export function frontPageOf(form: SettingsForm): FrontPage {
  const homepage = form.homepage.trim();
  return { homepage, postsPage: homepage === '' ? '' : form.postsPage.trim() };
}

export function frontPageProblems(form: SettingsForm): {
  readonly [K in keyof FrontPage]?: string | undefined;
} {
  const homepage = form.homepage.trim();
  return {
    homepage: slugProblem(homepage, 'A homepage'),
    postsPage: postsPageProblem(homepage, form.postsPage.trim()),
  };
}

function postsPageProblem(homepage: string, postsPage: string): string | undefined {
  if (postsPage === '') return undefined;
  if (homepage === '') {
    return 'A posts page needs a homepage: pick the page the front page shows first.';
  }
  if (postsPage === homepage) {
    return 'The homepage and the posts page have to be two different pages.';
  }
  return slugProblem(postsPage, 'A posts page');
}

function frontPageRows(): { readonly [K in keyof FrontPage]: FormSettingRow<string> } {
  const row = (key: keyof FrontPage, field: string): FormSettingRow<string> => ({
    ...text(key, field, { empty: 'absent' }),
    submitted: (form) => frontPageOf(form)[key],
    check: (form) => frontPageProblems(form)[key],
  });
  return { homepage: row('homepage', 'homepage'), postsPage: row('postsPage', 'posts_page') };
}

function countIn(
  file: SiteJson,
  key: string,
  accept: (count: number) => boolean,
): number | undefined {
  const count = Number(file[key]);
  return Number.isInteger(count) && accept(count) ? count : undefined;
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
    empty: 'default',
    check: (form) => (form.title.trim() === '' ? 'The site needs a title.' : undefined),
  }),

  tagline: text('tagline', 'tagline', { empty: 'value' }),

  baseUrl: {
    field: 'base_url',
    read: (file) => stringIn(file, 'url'),
    write: always('url', (settings) => settings.baseUrl),
    submitted: (form) => normalizeBaseUrl(form.baseUrl) ?? '',
    shown: asIs,
    check: (form) =>
      normalizeBaseUrl(form.baseUrl) === undefined
        ? 'The base URL has to be an absolute http:// or https:// URL.'
        : undefined,
  },

  postsPerPage: {
    field: 'posts_per_page',
    read: (file) => countIn(file, 'postsPerPage', (count) => count > 0),
    write: always('postsPerPage', (settings) => settings.postsPerPage),
    submitted: (form) => Number(form.postsPerPage),
    shown: String,
    check: (form) => {
      const perPage = Number(form.postsPerPage);
      return !Number.isInteger(perPage) || perPage < 1
        ? 'Posts per page has to be a whole number of one or more.'
        : undefined;
    },
  },

  timezone: text('timezone', 'timezone', {
    empty: 'default',
    check: (form) =>
      isValidTimezone(form.timezone)
        ? undefined
        : 'That is not an IANA time zone name, such as Europe/London.',
  }),

  language: text('language', 'language', {
    empty: 'default',
    check: (form) =>
      LANGUAGE_TAG_PATTERN.test(form.language.trim())
        ? undefined
        : 'That is not a language tag, such as en, en-GB or pt-BR.',
  }),

  // The two archive bases are checked as a pair, because two of the rules —
  // that they differ, and that neither takes a path the site already answers
  // on — are about the pair rather than either one. They are on one page for
  // exactly that reason.
  tagBase: text('tagBase', 'tag_base', {
    empty: 'default',
    check: (form) => taxonomyBaseProblems({ tag: form.tagBase, category: form.categoryBase }).tag,
  }),

  categoryBase: text('categoryBase', 'category_base', {
    empty: 'default',
    check: (form) =>
      taxonomyBaseProblems({ tag: form.tagBase, category: form.categoryBase }).category,
  }),

  comments: flag('comments', 'comments'),

  // The empty string is refused rather than read as zero, which is what
  // `Number('')` would make it: a cleared field is a mistake, and "never close
  // comments" should have to be typed.
  commentsCloseAfterDays: {
    field: 'comments_close_after_days',
    read: (file) => countIn(file, 'commentsCloseAfterDays', (days) => days >= 0),
    write: always('commentsCloseAfterDays', (settings) => settings.commentsCloseAfterDays),
    submitted: (form) => Number(form.commentsCloseAfterDays),
    shown: String,
    check: (form) => {
      const typed = form.commentsCloseAfterDays.trim();
      const days = Number(typed);
      return typed === '' || !Number.isInteger(days) || days < 0
        ? 'Comments close after a whole number of days, or 0 for never.'
        : undefined;
    },
  },

  commentEmailRetentionDays: retention('commentEmailRetentionDays', 'comment_email_retention_days'),

  addressHashRetentionDays: retention('addressHashRetentionDays', 'address_hash_retention_days'),

  contactMessageRetentionDays: retention(
    'contactMessageRetentionDays',
    'contact_message_retention_days',
  ),

  webmentionsSend: flag('webmentionsSend', 'webmentions_send'),

  webmentionsReceive: flag('webmentionsReceive', 'webmentions_receive'),

  // Empty is a value here — it is how a site turns real-time notification off
  // — so only a non-empty one has to be a URL. http as well as https, because
  // a notify server on a private network or a loopback port is a real one.
  notifyServer: {
    ...text('notifyServer', 'notify_server', { empty: 'value' }),
    submitted: (form) => normalizeBaseUrl(form.notifyServer) ?? '',
    check: (form) =>
      form.notifyServer.trim() !== '' && normalizeBaseUrl(form.notifyServer) === undefined
        ? 'A notify server is an absolute http:// or https:// URL, or empty for none.'
        : undefined,
  },

  feedUpdatePeriod: choice(
    'feedUpdatePeriod',
    'feed_update_period',
    isUpdatePeriod,
    DEFAULT_FEED_CADENCE.period,
    `An update period is one of ${UPDATE_PERIODS.join(', ')}.`,
  ),

  feedUpdateFrequency: {
    field: 'feed_update_frequency',
    read: (file) => chosen(file, 'feedUpdateFrequency', isPollCount),
    write: always('feedUpdateFrequency', (settings) => settings.feedUpdateFrequency),
    submitted: (form) => Number(form.feedUpdateFrequency),
    shown: String,
    check: (form) =>
      form.feedUpdateFrequency.trim() !== '' && isPollCount(Number(form.feedUpdateFrequency))
        ? undefined
        : 'Polls per period is a whole number, 1 or more.',
  },

  aiCrawlers: choice(
    'aiCrawlers',
    'ai_crawlers',
    isAiCrawlerPolicy,
    'allow',
    `An AI-crawler policy is one of ${AI_CRAWLER_POLICIES.join(', ')}.`,
  ),

  contentSignalSearch: contentSignal('contentSignalSearch', 'content_signal_search'),

  contentSignalAiInput: contentSignal('contentSignalAiInput', 'content_signal_ai_input'),

  contentSignalAiTrain: contentSignal('contentSignalAiTrain', 'content_signal_ai_train'),

  robotsRules: list(
    'robotsRules',
    'robots_rules',
    (typed) => robotsRuleLines([typed]),
    (form) => robotsRuleProblem([form.robotsRules]),
  ),

  llmsTxt: flag('llmsTxt', 'llms_txt'),

  indexNow: flag('indexNow', 'index_now'),

  mailProvider: choice(
    'mailProvider',
    'mail_provider',
    isMailProvider,
    'none',
    `A mail provider is one of ${MAIL_PROVIDERS.join(', ')}.`,
  ),

  mailFromName: text('mailFromName', 'mail_from_name', { empty: 'value' }),

  mailFromAddress: text('mailFromAddress', 'mail_from_address', {
    empty: 'value',
    check: emailCheck(
      'mailFromAddress',
      'A From address is an email address, such as blog@example.com, or empty for the default.',
    ),
  }),

  mailReplyTo: text('mailReplyTo', 'mail_reply_to', {
    empty: 'value',
    check: emailCheck(
      'mailReplyTo',
      'A reply-to is an email address, such as hello@example.com, or empty to reply to the From address.',
    ),
  }),

  contactEmail: text('contactEmail', 'contact_email', {
    empty: 'value',
    check: emailCheck(
      'contactEmail',
      'A contact address is an email address, such as hello@example.com, or empty for the first admin with one.',
    ),
  }),

  // These three are printed line by line into security.txt, so a hand edit
  // with a line break in it must not become a field nobody set.
  securityContacts: list('securityContacts', 'security_contacts', securityContactList, (form) => {
    const bad = relayLines(form.securityContacts).find(
      (line) => normalizeSecurityContact(line) === undefined,
    );
    return bad === undefined
      ? undefined
      : 'A security contact is an email address, an https:// URL or a tel: number, one per line. ' +
          `"${bad}" is not one.`;
  }),

  // RFC 9116 wants every web URI in the file to be https.
  securityPolicy: {
    ...text('securityPolicy', 'security_policy', { empty: 'value' }),
    read: (file) => {
      const policy = stringIn(file, 'securityPolicy');
      return policy === undefined ? undefined : (normalizeSecurityPolicy(policy) ?? '');
    },
    submitted: (form) => normalizeSecurityPolicy(form.securityPolicy) ?? '',
    check: (form) =>
      form.securityPolicy.trim() !== '' &&
      normalizeSecurityPolicy(form.securityPolicy) === undefined
        ? 'A security policy is an https:// URL, or empty for none.'
        : undefined,
  },

  securityLanguages: {
    ...text('securityLanguages', 'security_languages', { empty: 'value' }),
    read: (file) => {
      const languages = stringIn(file, 'securityLanguages');
      return languages === undefined ? undefined : (normalizeLanguageList(languages) ?? '');
    },
    submitted: (form) => normalizeLanguageList(form.securityLanguages) ?? '',
    check: (form) =>
      normalizeLanguageList(form.securityLanguages) === undefined
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

  locationSharing: choice(
    'locationSharing',
    'location_sharing',
    isLocationSharing,
    'none',
    `Location sharing is one of ${LOCATION_SHARING.join(', ')}.`,
  ),

  menus: {
    read: (file) => (file['menus'] === undefined ? undefined : menusOf(file['menus'])),
    write: always('menus', (settings) =>
      Object.fromEntries(
        Object.entries(settings.menus).map(([name, items]) => [
          name,
          items.map((item) => ({ ...item })),
        ]),
      ),
    ),
    submitted: (_form, onFile) => onFile.menus ?? DEFAULT_SITE_SETTINGS.menus,
  },

  taxonomyRedirects: {
    read: (file) =>
      Array.isArray(file['taxonomyRedirects'])
        ? taxonomyRedirectsOf(file['taxonomyRedirects'])
        : undefined,
    write: always('taxonomyRedirects', (settings) =>
      settings.taxonomyRedirects.map((entry) => ({ ...entry })),
    ),
    submitted: (_form, onFile) =>
      onFile.taxonomyRedirects ?? DEFAULT_SITE_SETTINGS.taxonomyRedirects,
  },

  ...frontPageRows(),

  theme: {
    ...text('theme', 'theme', {
      empty: 'absent',
      check: (form) => themeNameProblem(form.theme),
    }),
    onDisk: THEME_INSTALLED,
  },

  locale: text('locale', 'locale', {
    empty: 'absent',
    check: (form) => {
      const locale = form.locale.trim();
      return locale === '' ||
        (LANGUAGE_TAG_PATTERN.test(locale) && canonicalLocale(locale) !== undefined)
        ? undefined
        : 'That is not a locale, such as en-US, fr-CA or pt-BR, or empty for the language.';
    },
  }),

  author: text('author', 'author', { empty: 'absent' }),

  icon: {
    ...text('icon', 'icon', {
      empty: 'absent',
      check: (form) => iconProblem(form.icon.trim()),
    }),
    onDisk: ICON_UPLOADED,
    read: (file) => stringIn(file, 'icon')?.trim(),
  },

  license: {
    field: 'license',
    read: (file) => licenseIn(file)?.license,
    write: (file, settings) => {
      if (settings.license === '') delete file['license'];
      else file['license'] = settings.license === 'custom' ? settings.licenseUrl : settings.license;
    },
    submitted: (form) => {
      const license = form.license.trim();
      return isLicenseChoice(license) ? license : '';
    },
    shown: asIs,
    check: (form) =>
      isLicenseChoice(form.license.trim()) ? undefined : 'Choose a license from the list.',
  },

  licenseUrl: {
    field: 'license_url',
    read: (file) => licenseIn(file)?.licenseUrl,
    write: () => undefined,
    submitted: (form) => (isCustomLicense(form) ? form.licenseUrl.trim() : ''),
    shown: asIs,
    check: (form) =>
      isCustomLicense(form) && !isLicenseUrl(form.licenseUrl.trim())
        ? 'A custom license needs the URL of its terms, starting http:// or https://.'
        : undefined,
  },

  licenseName: {
    field: 'license_name',
    read: (file) => licenseIn(file)?.licenseName,
    write: (file, settings) => {
      delete file['licenseName'];
      if (settings.license === 'custom') file['licenseName'] = settings.licenseName;
    },
    submitted: (form) => (isCustomLicense(form) ? form.licenseName.trim() : ''),
    shown: asIs,
    check: (form) =>
      isCustomLicense(form) && form.licenseName.trim() === ''
        ? 'A custom license needs a name for the footer to show.'
        : undefined,
  },

  // Minted the first time IndexNow is turned on and never again, so the key
  // the search engines verified outlives turning it off and on. A key IndexNow
  // would refuse is no key: the site then has none to serve or send, which is
  // IndexNow off rather than a stream of 403s.
  indexNowKey: {
    read: (file) => {
      const key = stringIn(file, 'indexNowKey');
      return key !== undefined && isIndexNowKey(key) ? key : undefined;
    },
    write: unlessEmpty('indexNowKey'),
    submitted: (form, onFile) =>
      onFile.indexNowKey !== undefined && onFile.indexNowKey !== ''
        ? onFile.indexNowKey
        : ticked(form.indexNow)
          ? generateIndexNowKey()
          : '',
  },

  clientsWithoutPkce: {
    read: (file) =>
      Array.isArray(file['clientsWithoutPkce'])
        ? clientsWithoutPkceOf(file['clientsWithoutPkce'])
        : undefined,
    write: unlessEmpty('clientsWithoutPkce'),
    submitted: (_form, onFile) =>
      onFile.clientsWithoutPkce ?? DEFAULT_SITE_SETTINGS.clientsWithoutPkce,
  },
};

export const ROWS: { readonly [K in keyof SiteSettings]: SettingRow<SiteSettings[K]> } =
  SETTING_ROWS;

export const FORM_ROWS: { readonly [K in SettingsField]: FormSettingRow<SiteSettings[K]> } =
  SETTING_ROWS;

export const SETTING_KEYS = Object.keys(SETTING_ROWS) as readonly (keyof SiteSettings)[];

function isFormKey(key: keyof SiteSettings): key is SettingsField {
  return SETTING_ROWS[key].field !== undefined;
}

export const SETTINGS_FIELD_NAMES: readonly SettingsField[] = SETTING_KEYS.filter(isFormKey);
