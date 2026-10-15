import path from 'node:path';

import { LANGUAGE_TAG_PATTERN } from '../content/language.ts';
import { classifyLicense, isLicenseUrl, NO_LICENSE } from '../content/license.ts';
import { canonicalLocale } from '../content/locale.ts';
import { LOCATION_SHARING } from '../content/location.ts';
import {
  DEFAULT_TAXONOMY_BASES,
  taxonomyBaseProblems,
  taxonomyRedirectsOf,
} from '../content/taxonomy.ts';
import type { TaxonomyRedirect } from '../content/taxonomy.ts';
import { parseIconSetting } from '../images/icons.ts';
import { sourceFile } from '../images/paths.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import { declareNamespace } from '../settings/declare.ts';
import {
  boolean,
  jsonValue,
  nonEmptyText,
  oneOf,
  optionalText,
  text,
  wholeNumber,
} from '../settings/kinds.ts';
import { createSettingsRegistry, overridden } from '../settings/registry.ts';
import type { CreateSettingsRegistryOptions } from '../settings/registry.ts';
import type {
  ChangedBy,
  SettingChange,
  SettingsRegistry,
  SettingType,
  ValuesOf,
} from '../settings/types.ts';
import { PACKAGED_THEME, themeNameProblem } from '../theme/themes.ts';
import { isFileSync } from '../util/files.ts';
import { isRecord } from '../util/guards.ts';
import { DEFAULT_FEED_CADENCE, DEFAULT_NOTIFY_SERVER, UPDATE_PERIODS } from './feed-settings.ts';
import { generateIndexNowKey, isIndexNowKey } from './indexnow-key.ts';
import { menusOf } from './navigation.ts';
import type { NavigationMenus } from './navigation.ts';
import { AI_CRAWLER_POLICIES, robotsRuleLines } from './robots.ts';
import {
  clientsWithoutPkceOf,
  EMAIL_PATTERN,
  isLicenseChoice,
  isValidTimezone,
  normalizeBaseUrl,
  normalizeLanguageList,
  normalizeSecurityPolicy,
  relayList,
  securityContactList,
} from './setting-values.ts';
import type { ContentSignalChoice, LicenseChoice } from './settings.ts';

export const DEFAULT_COMMENTS_CLOSE_AFTER_DAYS = 14;

/**
 * What readers may do with the site's posts. `site.json` holds a Creative
 * Commons key, or a custom license's URL, under `license`, and a custom
 * license's name under `licenseName`, the way a post's front matter does.
 */
export interface SiteLicense {
  /** Empty for no license, which is all rights reserved. */
  readonly choice: LicenseChoice;
  /** A custom license's terms, as an absolute URL. Empty unless `choice` is `custom`. */
  readonly url: string;
  /** A custom license's name. Empty unless `choice` is `custom`. */
  readonly name: string;
}

const NO_SITE_LICENSE: SiteLicense = { choice: '', url: '', name: '' };

const license: SettingType<SiteLicense> = {
  fromJson(raw) {
    const file = isRecord(raw) ? raw : {};
    const said = classifyLicense(file['license']);
    if (said === undefined || said === NO_LICENSE) {
      return { ok: false, problem: 'must be a Creative Commons key or the URL of the terms' };
    }
    if ('key' in said) return { ok: true, value: { choice: said.key, url: '', name: '' } };
    const name = file['licenseName'];
    return {
      ok: true,
      value: { choice: 'custom', url: said.url, name: typeof name === 'string' ? name.trim() : '' },
    };
  },
  fromText: (value) => license.fromJson({ license: value }),
  toJson: (value) =>
    value.choice === ''
      ? undefined
      : value.choice === 'custom'
        ? { license: value.url, licenseName: value.name }
        : { license: value.choice },
  toText: (value) => (value.choice === 'custom' ? value.url : value.choice),
};

function lines(parse: (typed: string) => string[]): SettingType<readonly string[]> {
  return jsonValue(
    (raw) =>
      Array.isArray(raw)
        ? { ok: true, value: parse(raw.filter((entry) => typeof entry === 'string').join('\n')) }
        : { ok: false, problem: 'must be a list of text' },
    (value) => [...value],
  );
}

function normalized(normalize: (value: string) => string | undefined): SettingType<string> {
  return {
    ...text,
    fromJson: (raw) =>
      typeof raw === 'string'
        ? { ok: true, value: normalize(raw) ?? '' }
        : { ok: false, problem: 'must be text' },
  };
}

const menus: SettingType<NavigationMenus> = jsonValue(
  (raw) => ({ ok: true, value: menusOf(raw) }),
  (value) =>
    Object.fromEntries(
      Object.entries(value).map(([name, items]) => [name, items.map((item) => ({ ...item }))]),
    ),
);

const taxonomyRedirects: SettingType<readonly TaxonomyRedirect[]> = jsonValue(
  (raw) =>
    Array.isArray(raw)
      ? { ok: true, value: taxonomyRedirectsOf(raw) }
      : { ok: false, problem: 'must be a list of redirects' },
  (value) => value.map((entry) => ({ ...entry })),
);

const clientsWithoutPkce: SettingType<readonly string[]> = jsonValue(
  (raw) =>
    Array.isArray(raw)
      ? { ok: true, value: clientsWithoutPkceOf(raw) }
      : { ok: false, problem: 'must be a list of client ids' },
  (value) => (value.length === 0 ? undefined : [...value]),
);

const indexNowKey: SettingType<string> = {
  ...optionalText,
  fromJson: (raw) =>
    typeof raw === 'string' && isIndexNowKey(raw)
      ? { ok: true, value: raw }
      : { ok: false, problem: 'must be 8 to 128 letters, digits or dashes' },
};

const icon: SettingType<string> = {
  ...optionalText,
  fromJson: (raw) =>
    typeof raw === 'string'
      ? { ok: true, value: raw.trim() }
      : { ok: false, problem: 'must be text' },
};

const contentSignal = oneOf<ContentSignalChoice>(['', 'yes', 'no']);

function emailOrEmpty(what: string) {
  return (value: string): string | undefined =>
    value !== '' && !EMAIL_PATTERN.test(value)
      ? `${what} is an email address, or empty.`
      : undefined;
}

function taxonomyBase(which: 'tag' | 'category') {
  return (_value: string, after: Readonly<Record<string, unknown>>): string | undefined =>
    taxonomyBaseProblems({
      tag: String(after['tag_base']),
      category: String(after['category_base']),
    })[which];
}

function frontPage(after: Readonly<Record<string, unknown>>): string | undefined {
  const homepage = String(after['homepage']);
  const postsPage = String(after['posts_page']);
  if (postsPage === '') return undefined;
  if (homepage === '') return 'A posts page needs a homepage.';
  if (postsPage === homepage)
    return 'The homepage and the posts page have to be two different pages.';
  return undefined;
}

const RETIRED_KEYS = ['navigation', 'soloAuthor'];

export function withoutRetiredKeys(
  file: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const kept = { ...file };
  for (const key of RETIRED_KEYS) delete kept[key];
  return kept;
}

export async function mintMissingIndexNowKey(
  settings: SettingsRegistry,
  by: ChangedBy,
): Promise<void> {
  if (!(await settings.get(SITE.index_now))) return;
  const key = await settings.resolve(SITE.index_now_key);
  if (key.value !== '' || overridden(key.source)) return;
  const minted = await settings.set(
    'site',
    new Map([['index_now_key', generateIndexNowKey()]]),
    by,
  );
  if (!minted.ok) {
    console.error(`No IndexNow key was minted: ${Object.values(minted.problems).join(' ')}`);
  }
}

async function mintIndexNowKey({ next, by, settings }: SettingChange<boolean>): Promise<void> {
  if (next) await mintMissingIndexNowKey(settings, by);
}

const SITE_JSON = path.join('_data', 'site.json');

/**
 * The site's settings: `content/_data/site.json` (decision-9, decision-53).
 *
 * Each key keeps the spelling the file has always used through `fileKey` or
 * `fileKeys`, so themes, Eleventy builds and hand edits read the file as
 * before. Reads are tolerant, key by key: a value of the wrong type is set
 * aside for the default rather than taking the site down. The checks are what
 * a write must pass on top of parsing. A write stores every declared key, so
 * the file a theme or an Eleventy build reads holds each value in effect.
 */
export const SITE = declareNamespace({
  namespace: 'site',
  storage: { kind: 'file', under: 'content', path: SITE_JSON },
  envPrefix: 'GEEKITY_SITE',
  legacy: (raw) => (isRecord(raw) ? withoutRetiredKeys(raw) : raw),
  writtenWhole: true,
  settings: {
    title: {
      type: nonEmptyText,
      default: 'Geekity',
      description: 'The site title, shown in the header, the <title> and the feeds.',
    },
    tagline: { type: text, default: '', description: 'One line under the title.' },
    base_url: {
      fileKey: 'url',
      type: text,
      default: '',
      description: 'The public origin. Empty means the configured one.',
      override: {
        field: 'baseUrl',
        value: (config) => (config.baseUrlSource !== 'default' ? config.baseUrl : undefined),
      },
      check: (value) =>
        value === '' || normalizeBaseUrl(value) !== undefined
          ? undefined
          : 'The base URL has to be an absolute http:// or https:// URL.',
    },
    posts_per_page: {
      fileKey: 'postsPerPage',
      type: wholeNumber(1, { coerced: true }),
      default: 10,
      description: 'How many posts a listing page holds.',
    },
    timezone: {
      type: nonEmptyText,
      default: 'UTC',
      description: 'The IANA zone dates are written in, such as Europe/London.',
      check: (value) =>
        isValidTimezone(value) ? undefined : 'That is not an IANA time zone name.',
    },
    language: {
      type: nonEmptyText,
      default: 'en',
      description: 'The site language as a BCP 47 tag.',
      check: (value) =>
        LANGUAGE_TAG_PATTERN.test(value) ? undefined : 'That is not a language tag.',
    },
    tag_base: {
      fileKey: 'tagBase',
      type: nonEmptyText,
      default: DEFAULT_TAXONOMY_BASES.tag,
      description: 'The first URL segment of the tag archives.',
      check: taxonomyBase('tag'),
    },
    category_base: {
      fileKey: 'categoryBase',
      type: nonEmptyText,
      default: DEFAULT_TAXONOMY_BASES.category,
      description: 'The first URL segment of the category archives.',
      check: taxonomyBase('category'),
    },
    comments: { type: boolean, default: true, description: 'Whether the site takes comments.' },
    comments_close_after_days: {
      fileKey: 'commentsCloseAfterDays',
      type: wholeNumber(0, { coerced: true }),
      default: DEFAULT_COMMENTS_CLOSE_AFTER_DAYS,
      description: 'How many days after its date a post stops taking comments. 0 never closes one.',
    },
    comment_email_retention_days: {
      fileKey: 'commentEmailRetentionDays',
      type: wholeNumber(0),
      default: 0,
      description: 'How many days a comment keeps its author email. 0 keeps it forever.',
    },
    address_hash_retention_days: {
      fileKey: 'addressHashRetentionDays',
      type: wholeNumber(0),
      default: 0,
      description: 'How many days a comment or message keeps its address hash. 0 keeps it forever.',
    },
    contact_message_retention_days: {
      fileKey: 'contactMessageRetentionDays',
      type: wholeNumber(0),
      default: 0,
      description: 'How many days a contact message is kept. 0 keeps it forever.',
    },
    webmentions_send: {
      fileKey: 'webmentionsSend',
      type: boolean,
      default: true,
      description: 'Whether the site tells the pages a post links to.',
    },
    webmentions_receive: {
      fileKey: 'webmentionsReceive',
      type: boolean,
      default: true,
      description: 'Whether the site accepts webmentions.',
    },
    notify_server: {
      fileKey: 'notifyServer',
      type: text,
      default: DEFAULT_NOTIFY_SERVER,
      description: 'The rssCloud and WebSub server told when a feed changes. Empty turns it off.',
      check: (value) =>
        value === '' || normalizeBaseUrl(value) !== undefined
          ? undefined
          : 'A notify server is an absolute http:// or https:// URL, or empty.',
    },
    feed_update_period: {
      fileKey: 'feedUpdatePeriod',
      type: oneOf(UPDATE_PERIODS),
      default: DEFAULT_FEED_CADENCE.period,
      description: 'The period the RSS feeds tell a reader to poll in.',
    },
    feed_update_frequency: {
      fileKey: 'feedUpdateFrequency',
      type: wholeNumber(1),
      default: DEFAULT_FEED_CADENCE.frequency,
      description: 'How many polls per period.',
    },
    ai_crawlers: {
      fileKey: 'aiCrawlers',
      type: oneOf(AI_CRAWLER_POLICIES),
      default: 'allow',
      description: 'How the robots file treats the crawlers that feed AI products.',
    },
    content_signal_search: {
      fileKey: 'contentSignalSearch',
      type: contentSignal,
      default: '',
      description: 'The search Content-Signal: yes, no, or empty for none.',
    },
    content_signal_ai_input: {
      fileKey: 'contentSignalAiInput',
      type: contentSignal,
      default: '',
      description: 'The ai-input Content-Signal: yes, no, or empty for none.',
    },
    content_signal_ai_train: {
      fileKey: 'contentSignalAiTrain',
      type: contentSignal,
      default: '',
      description: 'The ai-train Content-Signal: yes, no, or empty for none.',
    },
    robots_rules: {
      fileKey: 'robotsRules',
      type: lines((typed) => robotsRuleLines([typed])),
      default: [],
      description: 'Lines the robots file carries beyond the CMS own.',
    },
    llms_txt: {
      fileKey: 'llmsTxt',
      type: boolean,
      default: true,
      description: 'Whether the site serves /llms.txt.',
    },
    index_now: {
      fileKey: 'indexNow',
      type: boolean,
      default: false,
      description: 'Whether the site tells the IndexNow search engines what changed.',
      onChange: mintIndexNowKey,
    },
    mail_provider: {
      fileKey: 'mailProvider',
      type: oneOf(MAIL_PROVIDERS),
      default: 'none',
      description: 'How the site sends email.',
    },
    mail_from_name: {
      fileKey: 'mailFromName',
      type: text,
      default: '',
      description: 'The display name on the From line. Empty means the site title.',
    },
    mail_from_address: {
      fileKey: 'mailFromAddress',
      type: text,
      default: '',
      description: 'The address on the From line. Empty means no-reply at the site host.',
      check: emailOrEmpty('A From address'),
    },
    mail_reply_to: {
      fileKey: 'mailReplyTo',
      type: text,
      default: '',
      description: 'Where replies to the site mail go. Empty means the From address.',
      check: emailOrEmpty('A reply-to'),
    },
    contact_email: {
      fileKey: 'contactEmail',
      type: text,
      default: '',
      description: 'Where contact form messages go. Empty means the first admin with an email.',
      check: emailOrEmpty('A contact address'),
    },
    security_contacts: {
      fileKey: 'securityContacts',
      type: lines(securityContactList),
      default: [],
      description: 'The Contact lines of security.txt. Empty answers that path with a 404.',
    },
    security_policy: {
      fileKey: 'securityPolicy',
      type: normalized(normalizeSecurityPolicy),
      default: '',
      description: 'The Policy line of security.txt, an https URL.',
    },
    security_languages: {
      fileKey: 'securityLanguages',
      type: normalized(normalizeLanguageList),
      default: '',
      description: 'The Preferred-Languages line of security.txt.',
    },
    relays: {
      type: lines(relayList),
      default: [],
      description: 'The relay inboxes the site subscribes to.',
    },
    location_sharing: {
      fileKey: 'locationSharing',
      type: oneOf(LOCATION_SHARING),
      default: 'none',
      description: 'What the site publishes of a post location: none, place or exact.',
    },
    menus: {
      type: menus,
      default: {},
      description: 'Every menu the site holds, by name.',
    },
    taxonomy_redirects: {
      fileKey: 'taxonomyRedirects',
      type: taxonomyRedirects,
      default: [],
      description: 'The taxonomy archives that moved, each from an old term to a new one.',
    },
    homepage: {
      type: optionalText,
      default: '',
      description: 'The slug of the page served at /, or empty for the latest posts.',
      check: (_value, after) => frontPage(after),
    },
    posts_page: {
      fileKey: 'postsPage',
      type: optionalText,
      default: '',
      description: 'The slug of the page that carries the post listing beside a homepage.',
      check: (_value, after) => frontPage(after),
    },
    theme: {
      type: optionalText,
      default: PACKAGED_THEME,
      description: 'The theme directory the site renders through. Empty means the packaged one.',
      check: (value) => (value === '' ? undefined : themeNameProblem(value)),
    },
    locale: {
      type: optionalText,
      default: '',
      description: 'The locale dates and counts are written in. Empty means the language.',
      check: (value) =>
        value === '' || canonicalLocale(value) !== undefined ? undefined : 'That is not a locale.',
    },
    author: {
      type: optionalText,
      default: '',
      description: 'The username whose blog this is, or empty for a site with several authors.',
    },
    icon: {
      type: icon,
      default: '',
      description: 'The upload the site icons are derived from, such as /uploads/2026/10/icon.png.',
      check: (value, _after, dirs) => iconProblem(value, dirs.contentDir),
    },
    avatar: {
      type: optionalText,
      default: '',
      description: 'A picture from before every user had one. The site icon falls back to it.',
    },
    license: {
      fileKeys: ['license', 'licenseName'],
      type: license,
      default: NO_SITE_LICENSE,
      description: 'A Creative Commons key, or the URL of custom terms. Empty reserves all rights.',
      check: (value) =>
        value.choice === 'custom' && (!isLicenseUrl(value.url) || value.name === '')
          ? 'A custom license needs the URL of its terms and a name.'
          : !isLicenseChoice(value.choice)
            ? 'Choose a license from the list.'
            : undefined,
    },
    index_now_key: {
      fileKey: 'indexNowKey',
      type: indexNowKey,
      default: '',
      description: 'The key IndexNow verifies the site by, served at /{key}.txt.',
    },
    clients_without_pkce: {
      fileKey: 'clientsWithoutPkce',
      type: clientsWithoutPkce,
      default: [],
      description: 'The IndieAuth apps allowed to sign in without PKCE.',
    },
  },
});

/** The site's settings in effect. */
export type SiteSettings = ValuesOf<typeof SITE>;

function iconProblem(icon: string, contentDir: string): string | undefined {
  if (icon === '') return undefined;
  const parsed = parseIconSetting(icon);
  if ('problem' in parsed) {
    return parsed.problem === 'not-an-upload'
      ? 'The site icon has to be a file in the media library.'
      : 'The site icon has to be an image.';
  }
  const file = sourceFile({ contentDir }, parsed.source);
  return file !== undefined && isFileSync(file) ? undefined : `There is no upload at ${icon}.`;
}

export function createSettings(options: CreateSettingsRegistryOptions): SettingsRegistry {
  return createSettingsRegistry({ ...options, coreDeclaredAbove: [SITE] });
}

export function siteJsonPath(contentDir: string): string {
  return path.join(contentDir, SITE_JSON);
}

export function parseSiteJson(source: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(source);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
