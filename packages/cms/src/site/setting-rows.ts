/**
 * Every setting, declared once (TASK-354): one row per {@link SiteSettings}
 * key saying how `content/_data/site.json` holds it, how a save of the
 * settings form makes it, and, for a setting the form carries, the form field
 * it is submitted under, how it is shown and what is wrong with it.
 *
 * The site.json converters in `site-json.ts` and the form converters in
 * `settings-form.ts` loop over these rows, so a key without a row is a type
 * error rather than a setting a save silently drops. The rows are in the
 * order a save writes the file's keys.
 */
import path from 'node:path';

import { isLocationSharing, LOCATION_SHARING } from '../content/location.ts';
import { parseIconSetting } from '../images/icons.ts';
import { sourceFile } from '../images/paths.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import { isFileSync } from '../util/files.ts';
import { DEFAULT_FEED_CADENCE, isUpdatePeriod, UPDATE_PERIODS } from '../web/feed-source.ts';
import { generateIndexNowKey, isIndexNowKey } from '../web/indexnow.ts';
import { classifyLicense, isLicenseUrl, NO_LICENSE } from '../web/license.ts';
import { canonicalLocale } from '../web/locale.ts';
import { menusOf } from '../web/navigation.ts';
import { AI_CRAWLER_POLICIES, robotsRuleLines, robotsRuleProblem } from '../web/robots.ts';
import { taxonomyBaseProblems, taxonomyRedirectsOf } from '../web/taxonomy.ts';
import { readTheme, themeNameProblem } from '../web/themes.ts';
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
  LANGUAGE_TAG_PATTERN,
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

/**
 * The settings no settings form carries. Each is a record of what another
 * screen did rather than a preference typed into a box: the taxonomy screens
 * write the archive renames, the Navigation screen the menus, Users >
 * Connected apps the apps let in without PKCE, and the IndexNow key is minted
 * once and kept.
 */
export type CarriedField = 'taxonomyRedirects' | 'menus' | 'indexNowKey' | 'clientsWithoutPkce';

/** The settings the form on the settings screen carries. */
export type SettingsField = Exclude<keyof SiteSettings, CarriedField>;

/**
 * The carried settings as a save takes them from the file: read off
 * `site.json` as it stands inside the write rather than off the form, which is
 * what makes a menu edited while the settings page was open survive the save.
 */
export type CarriedSettings = Partial<Pick<SiteSettings, CarriedField>>;

/** A submitted settings form, before it is known to be valid. */
export type SettingsForm = Record<SettingsField, string>;

/**
 * What a check may need to know beyond the form itself.
 *
 * Whether a name is a theme, or a path an upload, is a question about the
 * file system rather than about the string, and only the config knows where
 * this site's themes and uploads are. A check given no context does what it
 * can, so a caller with no config in hand is not blocked.
 */
export interface SettingsContext {
  /** Where the site's themes are: `ResolvedConfig.themesDir`. */
  themesDir?: string | undefined;
  contentDir?: string | undefined;
}

type SiteJson = Readonly<Record<string, unknown>>;

export interface SettingRow<V> {
  /**
   * Its value as `site.json` says it, or `undefined` where the file says
   * nothing usable and the default stands. Read tolerantly, because the file
   * is public, in git and editable by hand.
   */
  readonly read: (file: SiteJson) => V | undefined;
  /** Write it into, or take it out of, the `site.json` a save writes. */
  readonly write: (file: Record<string, unknown>, settings: SiteSettings) => void;
  /** Its value off a form {@link FormSettingRow.check} found nothing wrong with. */
  readonly submitted: (form: SettingsForm, carried: CarriedSettings) => V;
}

export interface FormSettingRow<V> extends SettingRow<V> {
  /** The form field it is submitted under. */
  readonly field: string;
  readonly shown: (value: V) => string;
  /**
   * What is wrong with it on a submitted form. A setting nothing can be wrong
   * with has a check all the same, so a new row has to say so.
   */
  readonly check: (form: SettingsForm, context: SettingsContext) => string | undefined;
}

type CarriedRow<K extends CarriedField> = SettingRow<SiteSettings[K]> & { readonly field?: never };

type SettingRows = { readonly [K in SettingsField]: FormSettingRow<SiteSettings[K]> } & {
  readonly [K in CarriedField]: CarriedRow<K>;
};

type Writer = SettingRow<unknown>['write'];

/** Written whether or not it has a value, so the file's shape is stable. */
function always(key: string, value: (settings: SiteSettings) => unknown): Writer {
  return (file, settings) => {
    file[key] = value(settings);
  };
}

/** Absent rather than empty when there is nothing to say. */
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

/** A string where the empty string is a hole only the default can fill. */
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

/** The settings typed into a box and held as the text typed. */
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

/**
 * A setting typed into a box and kept trimmed. `empty` says whether the empty
 * string is a value of its own (no tagline, no author) or a hole only the
 * default can fill (no title), and whether a save writes it or leaves the key
 * out.
 */
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

/** One of a fixed list, read the way the form checks it. */
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

/**
 * A retention period. Empty is refused rather than read as zero, because zero
 * keeps the data forever and a cleared field should not be how a site says
 * that.
 */
function retention(key: RetentionField, field: string): FormSettingRow<number> {
  return {
    field,
    read: (file) => chosen(file, key, isWholeDays),
    write: always(key, (settings) => settings[key]),
    submitted: (form) => Number(form[key]),
    shown: String,
    check: (form) => {
      const typed = form[key].trim();
      const days = Number(typed);
      return typed === '' || !Number.isInteger(days) || days < 0
        ? 'Keep it for a whole number of days, or 0 to keep it forever.'
        : undefined;
    },
  };
}

/**
 * A Content-Signal preference. Read the way the form checks it, so a hand
 * edit naming a signal this version does not know is the default rather than
 * a line of robots.txt nobody chose.
 */
function contentSignal<K extends ContentSignalField>(
  key: K,
  field: string,
): FormSettingRow<SiteSettings[K]> {
  return choice(key, field, isContentSignalChoice, '', 'A content signal is yes, no, or not said.');
}

/**
 * A list edited one entry per line and held as an array in the file. The file
 * goes through the same normaliser a submitted form does, so the two cannot
 * mean different things by the same line.
 */
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

/** What a site.json `license` and `licenseName` say, as the three settings. */
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

/**
 * What a page slug may be made of on this screen: the shape `slugify`
 * produces, which is what the editor writes. The setting travels no further
 * than a lookup by slug, so this is about catching a hand-typed value rather
 * than about safety.
 */
const PAGE_SLUG_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

/** What is wrong with one page pick, or `undefined`. Empty is a value. */
function slugProblem(value: string, what: string): string | undefined {
  const slug = value.trim();
  return slug === '' || PAGE_SLUG_PATTERN.test(slug)
    ? undefined
    : `${what} is the slug of one of the site's pages, such as about.`;
}

function iconProblem(icon: string, context: SettingsContext): string | undefined {
  if (icon === '') return undefined;

  const parsed = parseIconSetting(icon);
  if ('problem' in parsed) {
    return parsed.problem === 'not-an-upload'
      ? 'The site icon has to be a file in the media library, a path such as /uploads/2026/10/icon.png.'
      : 'The site icon has to be an image: PNG, JPEG, GIF, WebP, AVIF, TIFF or SVG.';
  }
  if (context.contentDir === undefined) return undefined;

  const file = sourceFile({ contentDir: context.contentDir }, parsed.source);
  return file !== undefined && isFileSync(file)
    ? undefined
    : `There is no upload at ${icon}. Upload the picture on the Media screen first.`;
}

/**
 * A whole number read the way `Number` reads it, so a hand-edited `"7"` is
 * seven, and kept when `accept` says so.
 */
function countIn(
  file: SiteJson,
  key: string,
  accept: (count: number) => boolean,
): number | undefined {
  const count = Number(file[key]);
  return Number.isInteger(count) && accept(count) ? count : undefined;
}

/**
 * An email address, or empty for the fallback `empty` names. Only a non-empty
 * one has to look like an address.
 */
function emailCheck(key: TextField, problem: string): FormSettingRow<string>['check'] {
  return (form) =>
    form[key].trim() !== '' && !EMAIL_PATTERN.test(form[key].trim()) ? problem : undefined;
}

const SETTING_ROWS: SettingRows = {
  title: text('title', 'title', {
    empty: 'default',
    check: (form) => (form.title.trim() === '' ? 'The site needs a title.' : undefined),
  }),

  tagline: text('tagline', 'tagline', { empty: 'value' }),

  // Whether the base URL is the one in effect depends on the config; see
  // `effectiveBaseUrl`. The file has always called it `url`.
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

  // A rule the form would refuse is left out of a hand-edited file.
  robotsRules: list(
    'robotsRules',
    'robots_rules',
    (typed) => robotsRuleLines([typed]),
    (form) => robotsRuleProblem([form.robotsRules]),
  ),

  llmsTxt: flag('llmsTxt', 'llms_txt'),

  indexNow: flag('indexNow', 'index_now'),

  // Only a provider this version ships: a file naming one it has never heard
  // of is a site that sends no mail rather than a boot that fails.
  mailProvider: choice(
    'mailProvider',
    'mail_provider',
    isMailProvider,
    'none',
    `A mail provider is one of ${MAIL_PROVIDERS.join(', ')}.`,
  ),

  mailFromName: text('mailFromName', 'mail_from_name', { empty: 'value' }),

  // Empty is a value for both of these — no From address falls back to
  // `no-reply@` at the site's host, and no reply-to means replies go to the
  // From address.
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

  // Empty is a value here too — it is how a site says "whichever admin has an
  // address".
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

  // Checked line by line, and the first bad line is what the field says: a
  // textarea has one message, and pointing at the line somebody has to fix is
  // more use than counting how many are wrong.
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

  // Every menu the site holds, whether or not the theme in use renders it,
  // written whole. The `navigation` key the one menu used to live under is not
  // read at all: menus were renamed rather than migrated (TASK-107).
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
    submitted: (_form, carried) => carried.menus ?? DEFAULT_SITE_SETTINGS.menus,
  },

  // Facts about the site's URLs rather than preferences, which is why a
  // content directory restored on its own keeps answering the archive URLs it
  // used to.
  taxonomyRedirects: {
    read: (file) =>
      Array.isArray(file['taxonomyRedirects'])
        ? taxonomyRedirectsOf(file['taxonomyRedirects'])
        : undefined,
    write: always('taxonomyRedirects', (settings) =>
      settings.taxonomyRedirects.map((entry) => ({ ...entry })),
    ),
    submitted: (_form, carried) =>
      carried.taxonomyRedirects ?? DEFAULT_SITE_SETTINGS.taxonomyRedirects,
  },

  // The page picks are absent rather than empty for a site showing its latest
  // posts, which has no static front page at all rather than an empty one.
  //
  // They are checked as a pair, the way the archive bases are. Neither check
  // asks whether the slug still names a published page — the select only
  // offers ones that do, and a page drafted after it was picked is a site back
  // on its latest posts rather than a settings screen that will not save.
  homepage: text('homepage', 'homepage', {
    empty: 'absent',
    check: (form) => slugProblem(form.homepage, 'A homepage'),
  }),

  postsPage: {
    ...text('postsPage', 'posts_page', { empty: 'absent' }),
    // Clearing the homepage clears the listing's own page with it rather than
    // leave it stranded.
    submitted: (form) => (form.homepage.trim() === '' ? '' : form.postsPage.trim()),
    check: (form) => {
      if (form.postsPage.trim() === '') return undefined;
      if (form.homepage.trim() === '') {
        return 'A posts page needs a homepage: pick the page the front page shows first.';
      }
      if (form.postsPage.trim() === form.homepage.trim()) {
        return 'The homepage and the posts page have to be two different pages.';
      }
      return slugProblem(form.postsPage, 'A posts page');
    },
  },

  // Absent for a site on the packaged theme: running what the package ships
  // is not a choice a site should have to write down, and a `theme` of `""`
  // would be a name no directory has.
  //
  // A name that is not a theme is refused rather than saved and warned about
  // later: the screen lists the themes that are there, so the only way to
  // type one that is not is a theme deleted between drawing the list and
  // saving it, and the person is in front of the form and can be told.
  theme: text('theme', 'theme', {
    empty: 'absent',
    check: (form, context) => {
      const name = form.theme.trim();
      if (name === '') return undefined;

      const badName = themeNameProblem(name);
      if (badName !== undefined) return badName;
      if (context.themesDir === undefined) return undefined;

      const read = readTheme(path.join(context.themesDir, name));
      return read.ok ? undefined : `There is no theme called "${name}": ${read.reason}`;
    },
  }),

  // Absent for a site whose dates follow its language, which has made no
  // choice to write down.
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

  // Absent for a site with several authors, which names nobody (TASK-192).
  author: text('author', 'author', { empty: 'absent' }),

  icon: {
    ...text('icon', 'icon', {
      empty: 'absent',
      check: (form, context) => iconProblem(form.icon.trim(), context),
    }),
    read: (file) => stringIn(file, 'icon')?.trim(),
  },

  // The file says a license the way a post's front matter does: a Creative
  // Commons key, or a custom license's URL with its name beside it.
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
    // `license` carries it.
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
    submitted: (form, carried) =>
      carried.indexNowKey !== undefined && carried.indexNowKey !== ''
        ? carried.indexNowKey
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
    submitted: (_form, carried) =>
      carried.clientsWithoutPkce ?? DEFAULT_SITE_SETTINGS.clientsWithoutPkce,
  },
};

/** Every row, by the key it describes. */
export const ROWS: { readonly [K in keyof SiteSettings]: SettingRow<SiteSettings[K]> } =
  SETTING_ROWS;

/** The rows the settings form carries. */
export const FORM_ROWS: { readonly [K in SettingsField]: FormSettingRow<SiteSettings[K]> } =
  SETTING_ROWS;

/** Every setting, in the order a save writes them. */
export const SETTING_KEYS = Object.keys(SETTING_ROWS) as readonly (keyof SiteSettings)[];

function isFormKey(key: keyof SiteSettings): key is SettingsField {
  return SETTING_ROWS[key].field !== undefined;
}

/** Every field of the form, in the order a save writes them. */
export const SETTINGS_FIELD_NAMES: readonly SettingsField[] = SETTING_KEYS.filter(isFormKey);
