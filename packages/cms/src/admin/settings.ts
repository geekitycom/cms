import { statSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_COMMENTS_CLOSE_AFTER_DAYS } from '../comments/policy.ts';
import type { RetentionPolicy } from '../privacy/policy.ts';
import type { ResolvedConfig } from '../config.ts';
import {
  readFileIfPresentSync,
  updateFileAtomically,
  writeFileAtomicallySync,
} from '../files/atomic.ts';
import { parseIconSetting } from '../images/icons.ts';
import { isLocationSharing, LOCATION_SHARING } from '../content/location.ts';
import type { LocationSharing } from '../content/location.ts';
import { sourceFile } from '../images/paths.ts';
import { clientIdentifier } from '../indieauth/client-id.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import type { MailProviderName } from '../mail/provider.ts';
import { SITE_DATA_FILE } from '../web/context.ts';
import { DEFAULT_FEED_CADENCE, isUpdatePeriod, UPDATE_PERIODS } from '../web/feed-source.ts';
import type { UpdatePeriod } from '../web/feed-source.ts';
import { DEFAULT_NOTIFY_SERVER } from '../web/feeds.ts';
import { generateIndexNowKey, isIndexNowKey } from '../web/indexnow.ts';
import { classifyLicense, isCreativeCommonsKey, isLicenseUrl, NO_LICENSE } from '../web/license.ts';
import type { CreativeCommonsKey } from '../web/license.ts';
import { canonicalLocale } from '../web/locale.ts';
import { DEFAULT_MENU_NAME, menuItemsFromText, menusOf } from '../web/navigation.ts';
import { AI_CRAWLER_POLICIES, robotsRuleLines, robotsRuleProblem } from '../web/robots.ts';
import type {
  AiCrawlerPolicy,
  ContentSignal,
  ContentSignalName,
  RobotsPolicy,
} from '../web/robots.ts';
import type { NavigationMenus } from '../web/navigation.ts';
import {
  DEFAULT_TAXONOMY_BASES,
  taxonomyBaseProblems,
  taxonomyRedirectsOf,
} from '../web/taxonomy.ts';
import type { TaxonomyBases, TaxonomyRedirect } from '../web/taxonomy.ts';
import { readTheme, themeNameProblem } from '../web/themes.ts';
import { ADMIN_PREFIX } from './session.ts';
import type { AdminStore, LegacySetting } from './store.ts';

/**
 * Where the settings live: the General page, and the root every other settings
 * page hangs off ({@link settingsPagePath}).
 */
export const SETTINGS_PATH = `${ADMIN_PREFIX}/settings`;

/**
 * What a language tag may look like: BCP 47's shape rather than its registry —
 * a two or three letter primary subtag followed by dash-separated subtags of
 * letters and digits.
 *
 * Checking the shape and not the registry is deliberate. The value ends up in
 * `<html lang>`, an RSS `<language>` and an Atom `xml:lang`, where a
 * well-formed tag a reader has never heard of is harmless and a malformed one
 * is not; refusing a valid tag because this CMS shipped before it was
 * registered would be worse than accepting one nobody uses.
 */
export const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,4}$/;

/**
 * What an email address has to look like before the settings screen will keep
 * it: something, an `@`, and a dotted host.
 *
 * Deliberately loose. The grammar in RFC 5321 allows addresses nobody has ever
 * typed, and the only test that settles whether an address works is sending to
 * it — which is what the Send test email button is for. This catches the
 * typo where a whole field was pasted into the wrong box.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * The settings a site holds, as `content/_data/site.json` says them.
 *
 * The file is the source of truth (decision-9): the settings screen reads it,
 * validates the form and writes it back, and nothing else remembers a setting.
 * That is what makes a hand edit of the file — in an editor, from a git
 * checkout, by an Eleventy build's own tooling — show on the very next
 * request, and what makes `data/geekity.db` a cache a site may delete.
 *
 * This shape is the typed view of the file; {@link settingsFromSiteJson} reads
 * it and {@link siteJsonFor} writes it, so the two stay inverses of each
 * other. The file may hold keys this shape does not model — `feedSize`,
 * anything a site put there — and a save keeps every one of them.
 */
export interface SiteSettings {
  /** Site title, shown in the header, the `<title>` and the feeds. */
  title: string;
  /** One-line description under the title. May be empty. */
  tagline: string;
  /**
   * Public origin. Whether it is the one in effect depends on
   * {@link ResolvedConfig.baseUrlSource}; see {@link effectiveBaseUrl}.
   */
  baseUrl: string;
  /** An IANA zone name, e.g. `Europe/London`. */
  timezone: string;
  /**
   * The site's language as a BCP 47 tag, `en` by default. It is the
   * `<html lang>` the theme writes, the RSS channel's `<language>` and the
   * Atom feed's `xml:lang`.
   */
  language: string;
  /**
   * The locale the public site's dates and counts are written in, when it is
   * not the language: `en-US` on an `en` site, say. Empty, the default, means
   * the language.
   */
  locale: string;
  /** How many posts a listing page holds. A positive integer. */
  postsPerPage: number;
  /**
   * The slug of the page served at `/`, or empty when the site shows its
   * latest posts there. WordPress's Reading choice.
   *
   * A slug rather than a permalink, because a permalink is a thing the editor
   * may change and the setting should follow the page rather than the URL it
   * happened to have. A slug naming nothing published — a page drafted,
   * trashed or deleted since — is a site back on its latest posts: the pick is
   * kept so putting the page back puts the front page back with it.
   */
  homepage: string;
  /**
   * The slug of the page whose permalink carries the post listing, or empty
   * for none. Only meaningful beside a {@link SiteSettings.homepage}, and the
   * settings screen refuses one without it, exactly as WordPress does.
   */
  postsPage: string;
  /**
   * Who the site is: one user's username, or empty for a site with several
   * authors (TASK-192). A username makes it that user's blog: the homepage
   * carries their bio card and their `rel="me"` links, it and their archive
   * claim each other, and the root is their IndieAuth identity (decision-23).
   *
   * A file written before the Site author select may hold a display name or a
   * name nobody has. It is read as stored and resolved where it is used, by
   * `userForAuthor`, so a display name still names its user and anything else
   * names nobody; the General page writes the username at its next save.
   */
  author: string;
  /**
   * The theme the site renders through: the name of one directory under the
   * configured themes directory, or empty for the theme the package ships
   * (decision-15).
   *
   * A setting rather than a deployment fact, for the reason the tagline is: it
   * is a look somebody chooses on the Appearance screen, and a site moved from
   * one host to another should arrive looking the same. A name that is not a
   * theme is refused here and falls back to the packaged theme out on the
   * site, so a hand-edited file is a warning in the log rather than a 500.
   */
  theme: string;
  /**
   * The upload the site's icons are derived from, as a path such as
   * `/uploads/2026/10/icon.png`, or empty for none. Read from and written
   * to the `icon` key of `site.json` only.
   */
  icon: string;
  /**
   * What readers may do with the site's posts: empty for no
   * license, which is all rights reserved, a Creative Commons key, or
   * `custom` for the URL and name beside it. `site.json` writes a key, or a
   * custom license's URL, under `license`, so the file says it the way a
   * post's front matter does.
   */
  license: LicenseChoice;
  /** A custom license's terms, as an absolute URL. Empty unless `license` is `custom`. */
  licenseUrl: string;
  /** A custom license's name. Empty unless `license` is `custom`. */
  licenseName: string;
  /**
   * The first URL segment the tag archives live under, `tag` by default: one
   * URL-safe path segment, no slashes. WordPress's own base, so a site
   * imported from it keeps every archive URL it published.
   */
  tagBase: string;
  /** The same for the category archives, `category` by default. */
  categoryBase: string;
  /**
   * Whether the site takes native comments at all (TASK-50).
   *
   * Off means off everywhere: no form under any post, and every submission
   * refused. It does not touch the fediverse — a reply, a like or a boost
   * arrives because a remote server sent it, and a site cannot stop that or
   * pretend it did not happen.
   */
  comments: boolean;
  /**
   * How many days after its `date` a post stops taking comments. Zero never
   * closes one.
   *
   * The age at which a post stops being a conversation and starts being a spam
   * target; fourteen days is WordPress's own default. A post may say otherwise
   * for itself with `comments: true` or `comments: false` in its front matter.
   */
  commentsCloseAfterDays: number;
  /**
   * How many days a comment keeps its author's email (TASK-135). Zero keeps it
   * forever. Past it the email is removed from the comment file and the index,
   * and with it the author's subscription to replies.
   */
  commentEmailRetentionDays: number;
  /**
   * How many days a comment or a contact message keeps the salted hash of the
   * address it came from. Zero keeps it forever.
   */
  addressHashRetentionDays: number;
  /** How many days a contact message is kept at all. Zero keeps it forever. */
  contactMessageRetentionDays: number;
  /**
   * Whether the site tells the pages a post links to that it has (TASK-51).
   *
   * On by default, because a link nobody is told about is half a conversation.
   * Off means no webmention is ever sent, including by the Resend button.
   */
  webmentionsSend: boolean;
  /**
   * Whether the site accepts webmentions sent to it (TASK-51).
   *
   * On by default. Off takes the endpoint off every page and answers the
   * endpoint itself with a 404, which is what a site that does not receive
   * them looks like from outside. It does not touch the fediverse, and it does
   * not touch what has already arrived: a webmention already in the queue is
   * still there for a moderator.
   */
  webmentionsReceive: boolean;
  /**
   * Where the site announces that a feed changed, and the server its feeds
   * advertise as their rssCloud endpoint and their WebSub hub. An absolute
   * http(s) URL, {@link DEFAULT_NOTIFY_SERVER} by default; empty turns
   * real-time notification off altogether.
   */
  notifyServer: string;
  /**
   * How often the RSS feeds tell a reader to poll them: `feedUpdateFrequency`
   * times a `feedUpdatePeriod`, in the Syndication module's two elements
   * (TASK-152). Once an hour by default, which is what WordPress declares.
   */
  feedUpdatePeriod: UpdatePeriod;
  /** How many polls per {@link SiteSettings.feedUpdatePeriod}: a whole number, at least one. */
  feedUpdateFrequency: number;
  /**
   * How the site treats the crawlers that feed AI products, as the robots file
   * spells it in per-agent groups (TASK-148). `allow` by default.
   */
  aiCrawlers: AiCrawlerPolicy;
  /**
   * The three Content-Signal preferences the robots file declares: `yes`,
   * `no`, or empty for a signal the site says nothing about.
   */
  contentSignalSearch: ContentSignalChoice;
  /** Whether the site's pages may be fed to an AI answer live. */
  contentSignalAiInput: ContentSignalChoice;
  /** Whether the site's pages may be used to train a model. */
  contentSignalAiTrain: ContentSignalChoice;
  /**
   * Lines the robots file carries beyond the CMS's own: groups of
   * `User-agent` lines and their rules, one line per entry, blank lines
   * between groups. Every group still keeps crawlers out of the admin.
   */
  robotsRules: readonly string[];
  /**
   * Whether the site serves `/llms.txt` and advertises it from the home page
   * (TASK-149). On by default. A site that wants to write the file itself
   * leaves this on and puts it at `content/llms.txt`.
   */
  llmsTxt: boolean;
  /**
   * Whether the site tells the IndexNow search engines about every URL a
   * publish, an edit or a deletion moved (TASK-151). Off by default: it sends
   * the site's URLs to a third party, which is the site's call to make.
   */
  indexNow: boolean;
  /**
   * The key IndexNow verifies the site by, served at `/{key}.txt`. Generated
   * the first time IndexNow is turned on and kept when it is turned off, so
   * turning it back on keeps the key the search engines already checked. It
   * is no secret: the whole point of it is that anybody can fetch it.
   */
  indexNowKey: string;
  /**
   * How the site sends email, or `none` for a site that does not (TASK-53).
   *
   * The name of the provider only. The key or the SMTP password that makes it
   * work is a credential and lives in `data/mail.json`, never here: this file
   * is public, in git and published with the site.
   */
  mailProvider: MailProviderName;
  /** The display name on the From line. Falls back to the site title. */
  mailFromName: string;
  /**
   * The address on the From line. Empty falls back to `no-reply@` at the base
   * URL's host, which is what an unconfigured site would have to send as
   * anyway — but a provider will only accept a sender it has verified, so a
   * site that sends anything real sets this.
   */
  mailFromAddress: string;
  /** Where a reply to the site's mail should go. Empty means the From address. */
  mailReplyTo: string;
  /**
   * Where a message from the contact form is sent (TASK-56).
   *
   * Empty falls back to the first admin with an email, so a site that has
   * never visited this field still has somewhere to write. It is read when a
   * message arrives and is never put on a render context, so it cannot appear
   * in the HTML of the page the form is on however a theme is written.
   */
  contactEmail: string;
  /**
   * Where a security researcher reports a vulnerability: the `Contact` lines
   * of `/.well-known/security.txt` (RFC 9116, TASK-133), each a `mailto:`,
   * `https:` or `tel:` URI, in the order the site prefers them.
   *
   * Empty means the site answers that path with a 404. There is no fallback
   * to {@link SiteSettings.contactEmail}: that address is promised never to
   * appear on the public site, and this one is published by definition.
   */
  securityContacts: readonly string[];
  /** The `Policy` line of security.txt: an https URL, or empty for none. */
  securityPolicy: string;
  /**
   * The `Preferred-Languages` line of security.txt: language tags joined by
   * `, `, or empty for none.
   */
  securityLanguages: string;
  /**
   * The relay inboxes the site subscribes to (FEP-ae0c): a Mastodon-style
   * relay boosts every public post it is sent, which is how a small site
   * reaches instances nobody on it follows.
   *
   * Each is the relay's own inbox URL, absolute and whole — a relay's inbox is
   * a path like `/user/_____relay_____/inbox`, not an origin. The list is
   * edited one per line on the settings screen and held as an array in the
   * file; where each subscription stands is in the database, because the
   * handshake is not the site's to decide.
   */
  relays: readonly string[];
  /**
   * Every menu the site holds, by name: `site.json`'s `menus`, each an ordered
   * list of items a theme renders wherever it declares an area of that name
   * and an Eleventy build reads out of the same file.
   *
   * Not a field of the settings form, and deliberately: a menu is content a
   * site arranges rather than a switch it sets, and which menus there are to
   * edit comes from the active theme. The Navigation screen is what writes
   * them (TASK-108); a settings page carries them through a save untouched,
   * the way it carries the archive renames.
   */
  menus: NavigationMenus;
  /**
   * The taxonomy archives that have moved: one `{ taxonomy, from, to }` per
   * term the taxonomy screens renamed or merged away, so the URL it used to
   * live at can point at the one it lives at now.
   *
   * Not a field of the settings form: it is a record of what happened rather
   * than a preference, and the taxonomy screens are what write it. Chains are collapsed as they are
   * recorded, so the list answers every old URL in one hop.
   */
  taxonomyRedirects: readonly TaxonomyRedirect[];
  /**
   * What the site publishes of a post's location (TASK-223, decision-29):
   * nothing, the place's words, or the coordinates too. `none` by default,
   * because the location is personal data and the author chooses to share it.
   * Chosen on Settings > Privacy.
   */
  locationSharing: LocationSharing;
  /**
   * The IndieAuth apps the owner lets sign in without PKCE (TASK-225), each a
   * client_id. Empty, the default, means every app needs PKCE, as the
   * IndieAuth spec says. Not a field of the settings form: Users > Connected
   * apps edits it, and a settings save carries it, like the menus.
   */
  clientsWithoutPkce: readonly string[];
}

/** What a site says about one Content-Signal: yes, no, or nothing. */
export type ContentSignalChoice = '' | 'yes' | 'no';

export type LicenseChoice = '' | CreativeCommonsKey | 'custom';

/** Whether a string is a {@link ContentSignalChoice}. */
function isContentSignalChoice(value: unknown): value is ContentSignalChoice {
  return value === '' || value === 'yes' || value === 'no';
}

/** Whether a value is a count of polls the Syndication module allows: a whole number from 1. */
function isPollCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Whether a string is an {@link AiCrawlerPolicy}. */
function isAiCrawlerPolicy(value: unknown): value is AiCrawlerPolicy {
  return (AI_CRAWLER_POLICIES as readonly unknown[]).includes(value);
}

/** What the settings say the robots file should carry. */
export function robotsPolicyOf(settings: SiteSettings): RobotsPolicy {
  const choices: [ContentSignalName, ContentSignalChoice][] = [
    ['search', settings.contentSignalSearch],
    ['ai-input', settings.contentSignalAiInput],
    ['ai-train', settings.contentSignalAiTrain],
  ];
  const contentSignal: ContentSignal = {};
  for (const [name, choice] of choices) if (choice !== '') contentSignal[name] = choice;

  return { aiCrawlers: settings.aiCrawlers, contentSignal, rules: settings.robotsRules };
}

/**
 * The settings the form on the settings screen carries.
 *
 * Every setting but the two that a screen of its own writes: the recorded
 * archive renames, which the taxonomy screens write, and the menus, which the
 * Navigation screen writes. See {@link CarriedSettings}.
 */
export type SettingsField = Exclude<
  keyof SiteSettings,
  'taxonomyRedirects' | 'menus' | 'indexNowKey' | 'clientsWithoutPkce'
>;

/**
 * The settings no settings form carries, as a save takes them from the file.
 *
 * Both are records of what another screen did rather than preferences typed
 * into a box, so a save of the title reads them off `site.json` as it stands
 * inside the write rather than off the form — which is what makes a menu
 * edited while the settings page was open survive the save.
 */
export type CarriedSettings = Partial<
  Pick<SiteSettings, 'taxonomyRedirects' | 'menus' | 'indexNowKey' | 'clientsWithoutPkce'>
>;

/**
 * What a site is worth before anybody has said otherwise.
 *
 * `baseUrl` is empty rather than a guess: only the resolved config knows what
 * port the site is on, so the fallback is applied where the config is in hand.
 */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  title: 'Geekity',
  tagline: '',
  baseUrl: '',
  timezone: 'UTC',
  language: 'en',
  locale: '',
  postsPerPage: 10,
  homepage: '',
  postsPage: '',
  author: '',
  theme: '',
  icon: '',
  license: '',
  licenseUrl: '',
  licenseName: '',
  tagBase: DEFAULT_TAXONOMY_BASES.tag,
  categoryBase: DEFAULT_TAXONOMY_BASES.category,
  comments: true,
  commentsCloseAfterDays: DEFAULT_COMMENTS_CLOSE_AFTER_DAYS,
  // Forever, so a site that upgrades loses nothing it never chose to lose.
  // `geekity init` writes the recommended periods for a new site.
  commentEmailRetentionDays: 0,
  addressHashRetentionDays: 0,
  contactMessageRetentionDays: 0,
  webmentionsSend: true,
  webmentionsReceive: true,
  notifyServer: DEFAULT_NOTIFY_SERVER,
  feedUpdatePeriod: DEFAULT_FEED_CADENCE.period,
  feedUpdateFrequency: DEFAULT_FEED_CADENCE.frequency,
  aiCrawlers: 'allow',
  contentSignalSearch: '',
  contentSignalAiInput: '',
  contentSignalAiTrain: '',
  robotsRules: [],
  llmsTxt: true,
  indexNow: false,
  indexNowKey: '',
  mailProvider: 'none',
  mailFromName: '',
  mailFromAddress: '',
  mailReplyTo: '',
  contactEmail: '',
  securityContacts: [],
  securityPolicy: '',
  securityLanguages: '',
  relays: [],
  locationSharing: 'none',
  menus: {},
  taxonomyRedirects: [],
  clientsWithoutPkce: [],
};

/** The form field each setting is submitted under. */
export const SETTINGS_FIELDS = {
  title: 'title',
  tagline: 'tagline',
  baseUrl: 'base_url',
  timezone: 'timezone',
  language: 'language',
  locale: 'locale',
  postsPerPage: 'posts_per_page',
  homepage: 'homepage',
  postsPage: 'posts_page',
  author: 'author',
  theme: 'theme',
  icon: 'icon',
  license: 'license',
  licenseUrl: 'license_url',
  licenseName: 'license_name',
  tagBase: 'tag_base',
  categoryBase: 'category_base',
  comments: 'comments',
  commentsCloseAfterDays: 'comments_close_after_days',
  commentEmailRetentionDays: 'comment_email_retention_days',
  addressHashRetentionDays: 'address_hash_retention_days',
  contactMessageRetentionDays: 'contact_message_retention_days',
  webmentionsSend: 'webmentions_send',
  webmentionsReceive: 'webmentions_receive',
  notifyServer: 'notify_server',
  feedUpdatePeriod: 'feed_update_period',
  feedUpdateFrequency: 'feed_update_frequency',
  aiCrawlers: 'ai_crawlers',
  contentSignalSearch: 'content_signal_search',
  contentSignalAiInput: 'content_signal_ai_input',
  contentSignalAiTrain: 'content_signal_ai_train',
  robotsRules: 'robots_rules',
  llmsTxt: 'llms_txt',
  indexNow: 'index_now',
  mailProvider: 'mail_provider',
  mailFromName: 'mail_from_name',
  mailFromAddress: 'mail_from_address',
  mailReplyTo: 'mail_reply_to',
  contactEmail: 'contact_email',
  securityContacts: 'security_contacts',
  securityPolicy: 'security_policy',
  securityLanguages: 'security_languages',
  relays: 'relays',
  locationSharing: 'location_sharing',
} as const satisfies Record<SettingsField, string>;

/** A submitted settings form, before it is known to be valid. */
export type SettingsForm = Record<SettingsField, string>;

/** One message per field that is wrong. An empty object is a valid form. */
export type SettingsProblems = Partial<Record<SettingsField, string>>;

/**
 * A site's settings, as its `content/_data/site.json` says them right now.
 *
 * Read on every request that needs one rather than cached, which is what a
 * source of truth being a file is worth: a hand edit shows on the public site,
 * on the settings screen and in the actor document without a restart and
 * without anything being told. The file is a few hundred bytes, so the read
 * costs less than the parse of the template that is about to use it.
 *
 * A file that is missing, or one that will not parse, is the defaults rather
 * than an error: a typo in `site.json` should leave a site up and answerable,
 * with the settings screen there to put it right.
 */
export function readSiteSettings(contentDir: string): SiteSettings {
  return settingsFromSiteJson(readSiteJson(contentDir));
}

export function readSiteJson(contentDir: string): Record<string, unknown> {
  return readSiteJsonSync(siteDataPath(contentDir));
}

/**
 * `content/_data/site.json` as the settings it names, defaults filled in.
 *
 * Read tolerantly, key by key, because the file is public, in git and editable
 * by hand: a key of the wrong type, or one a site has never written, falls
 * back to the default rather than taking the site down. The empty string is a
 * value of its own for `tagline`, `author` and `notifyServer`, where empty is
 * a decision — no tagline, no author, notifications off — and not for
 * `title`, `timezone`, `language` or the two archive bases, where it is a hole
 * only a default can fill.
 */
export function settingsFromSiteJson(file: Record<string, unknown>): SiteSettings {
  const postsPerPage = Number(file['postsPerPage']);
  const closeAfterDays = Number(file['commentsCloseAfterDays']);

  return {
    ...DEFAULT_SITE_SETTINGS,
    ...(typeof file['title'] === 'string' && file['title'] !== '' ? { title: file['title'] } : {}),
    ...(typeof file['tagline'] === 'string' ? { tagline: file['tagline'] } : {}),
    ...(typeof file['author'] === 'string' ? { author: file['author'] } : {}),
    ...(typeof file['timezone'] === 'string' && file['timezone'] !== ''
      ? { timezone: file['timezone'] }
      : {}),
    ...(typeof file['language'] === 'string' && file['language'] !== ''
      ? { language: file['language'] }
      : {}),
    ...(typeof file['locale'] === 'string' ? { locale: file['locale'] } : {}),
    // Absent is the ordinary state of this one: a site on the packaged theme
    // has never written the key, so anything but a string is that site.
    ...(typeof file['theme'] === 'string' ? { theme: file['theme'] } : {}),
    ...(typeof file['icon'] === 'string' ? { icon: file['icon'].trim() } : {}),
    ...licenseFromSiteJson(file),
    // Absent is the ordinary state of these two: a site showing its latest
    // posts writes neither key, so anything but a string is read as none.
    ...(typeof file['homepage'] === 'string' ? { homepage: file['homepage'] } : {}),
    ...(typeof file['postsPage'] === 'string' ? { postsPage: file['postsPage'] } : {}),
    ...(typeof file['tagBase'] === 'string' && file['tagBase'] !== ''
      ? { tagBase: file['tagBase'] }
      : {}),
    ...(typeof file['categoryBase'] === 'string' && file['categoryBase'] !== ''
      ? { categoryBase: file['categoryBase'] }
      : {}),
    ...(typeof file['comments'] === 'boolean' ? { comments: file['comments'] } : {}),
    ...(Number.isInteger(closeAfterDays) && closeAfterDays >= 0
      ? { commentsCloseAfterDays: closeAfterDays }
      : {}),
    ...wholeDays(file, 'commentEmailRetentionDays'),
    ...wholeDays(file, 'addressHashRetentionDays'),
    ...wholeDays(file, 'contactMessageRetentionDays'),
    ...(typeof file['webmentionsSend'] === 'boolean'
      ? { webmentionsSend: file['webmentionsSend'] }
      : {}),
    ...(typeof file['webmentionsReceive'] === 'boolean'
      ? { webmentionsReceive: file['webmentionsReceive'] }
      : {}),
    ...(typeof file['notifyServer'] === 'string' ? { notifyServer: file['notifyServer'] } : {}),
    ...(isUpdatePeriod(file['feedUpdatePeriod'])
      ? { feedUpdatePeriod: file['feedUpdatePeriod'] }
      : {}),
    ...(isPollCount(file['feedUpdateFrequency'])
      ? { feedUpdateFrequency: file['feedUpdateFrequency'] }
      : {}),
    // Read the way the form checks them, so a hand edit naming a policy or a
    // signal this version does not know is the default rather than a line of
    // robots.txt nobody chose, and a rule the form would refuse is left out.
    ...(isAiCrawlerPolicy(file['aiCrawlers']) ? { aiCrawlers: file['aiCrawlers'] } : {}),
    ...(isContentSignalChoice(file['contentSignalSearch'])
      ? { contentSignalSearch: file['contentSignalSearch'] }
      : {}),
    ...(isContentSignalChoice(file['contentSignalAiInput'])
      ? { contentSignalAiInput: file['contentSignalAiInput'] }
      : {}),
    ...(isContentSignalChoice(file['contentSignalAiTrain'])
      ? { contentSignalAiTrain: file['contentSignalAiTrain'] }
      : {}),
    ...(Array.isArray(file['robotsRules'])
      ? {
          robotsRules: robotsRuleLines(
            file['robotsRules'].filter((entry) => typeof entry === 'string'),
          ),
        }
      : {}),
    ...(typeof file['llmsTxt'] === 'boolean' ? { llmsTxt: file['llmsTxt'] } : {}),
    ...(typeof file['indexNow'] === 'boolean' ? { indexNow: file['indexNow'] } : {}),
    // A key IndexNow would refuse is no key: the site then has none to serve
    // or send, which is IndexNow off rather than a stream of 403s.
    ...(typeof file['indexNowKey'] === 'string' && isIndexNowKey(file['indexNowKey'])
      ? { indexNowKey: file['indexNowKey'] }
      : {}),
    // Only a provider this version ships, for the reason the actor type is
    // read that way: a file naming one it has never heard of is a site that
    // sends no mail rather than a boot that fails.
    ...(typeof file['mailProvider'] === 'string' &&
    (MAIL_PROVIDERS as readonly string[]).includes(file['mailProvider'])
      ? { mailProvider: file['mailProvider'] as MailProviderName }
      : {}),
    ...(typeof file['mailFromName'] === 'string' ? { mailFromName: file['mailFromName'] } : {}),
    ...(typeof file['mailFromAddress'] === 'string'
      ? { mailFromAddress: file['mailFromAddress'] }
      : {}),
    ...(typeof file['mailReplyTo'] === 'string' ? { mailReplyTo: file['mailReplyTo'] } : {}),
    ...(typeof file['contactEmail'] === 'string' ? { contactEmail: file['contactEmail'] } : {}),
    // Through the form's own normalisers, and dropped when they refuse: these
    // three are printed line by line into security.txt, so a hand edit with a
    // line break in it must not become a field nobody set.
    ...(Array.isArray(file['securityContacts'])
      ? {
          securityContacts: securityContactList(
            file['securityContacts'].filter((entry) => typeof entry === 'string').join('\n'),
          ),
        }
      : {}),
    ...(typeof file['securityPolicy'] === 'string'
      ? { securityPolicy: normalizeSecurityPolicy(file['securityPolicy']) ?? '' }
      : {}),
    ...(typeof file['securityLanguages'] === 'string'
      ? { securityLanguages: normalizeLanguageList(file['securityLanguages']) ?? '' }
      : {}),
    // Through the same normaliser a submitted form goes through, so the file
    // and the screen cannot mean different things by the same line.
    ...(Array.isArray(file['relays'])
      ? {
          relays: relayList(file['relays'].filter((entry) => typeof entry === 'string').join('\n')),
        }
      : {}),
    ...(isLocationSharing(file['locationSharing'])
      ? { locationSharing: file['locationSharing'] }
      : {}),
    // Every menu the site holds, whether or not the theme in use renders it.
    // The `navigation` key the one menu used to live under is not read at all:
    // menus were renamed rather than migrated (TASK-107).
    ...(file['menus'] === undefined ? {} : { menus: menusOf(file['menus']) }),
    // The renames a site has published redirects for: facts about its URLs
    // rather than preferences, which is why a content directory restored on
    // its own keeps answering the archive URLs it used to.
    ...(Array.isArray(file['taxonomyRedirects'])
      ? { taxonomyRedirects: taxonomyRedirectsOf(file['taxonomyRedirects']) }
      : {}),
    ...(Array.isArray(file['clientsWithoutPkce'])
      ? { clientsWithoutPkce: clientsWithoutPkceOf(file['clientsWithoutPkce']) }
      : {}),
    ...(Number.isInteger(postsPerPage) && postsPerPage > 0 ? { postsPerPage } : {}),
    ...(typeof file['url'] === 'string' ? { baseUrl: file['url'] } : {}),
  };
}

function clientsWithoutPkceOf(entries: readonly unknown[]): string[] {
  const valid = entries.filter(
    (entry): entry is string => typeof entry === 'string' && clientIdentifier(entry) !== undefined,
  );
  return [...new Set(valid)];
}

/** The two archive bases the settings hold, as the URL builders want them. */
export function taxonomyBasesFromSettings(settings: SiteSettings): TaxonomyBases {
  return { tag: settings.tagBase, category: settings.categoryBase };
}

/**
 * `content/_data/site.json` as it should read for these settings.
 *
 * Every key the settings model is written whether or not it has a value, so
 * the file's shape is stable and an Eleventy template may reference
 * `site.tagline` without guarding it. Every other key the file already had is
 * kept: a site may put anything in there and reach it from its templates, and
 * the settings form is not going to be the thing that throws it away.
 *
 * `homepage` and `postsPage` are the one exception, and they earn it: a site
 * showing its latest posts has no static front page at all rather than an
 * empty one, so the keys are absent rather than empty — which is also how a
 * `site.json` written before this version reads, and what it should mean.
 */
export function siteJsonFor(
  settings: SiteSettings,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const file: Record<string, unknown> = {
    ...existing,
    title: settings.title,
    tagline: settings.tagline,
    url: settings.baseUrl,
    postsPerPage: settings.postsPerPage,
    timezone: settings.timezone,
    language: settings.language,
    tagBase: settings.tagBase,
    categoryBase: settings.categoryBase,
    comments: settings.comments,
    commentsCloseAfterDays: settings.commentsCloseAfterDays,
    commentEmailRetentionDays: settings.commentEmailRetentionDays,
    addressHashRetentionDays: settings.addressHashRetentionDays,
    contactMessageRetentionDays: settings.contactMessageRetentionDays,
    webmentionsSend: settings.webmentionsSend,
    webmentionsReceive: settings.webmentionsReceive,
    notifyServer: settings.notifyServer,
    feedUpdatePeriod: settings.feedUpdatePeriod,
    feedUpdateFrequency: settings.feedUpdateFrequency,
    aiCrawlers: settings.aiCrawlers,
    contentSignalSearch: settings.contentSignalSearch,
    contentSignalAiInput: settings.contentSignalAiInput,
    contentSignalAiTrain: settings.contentSignalAiTrain,
    robotsRules: [...settings.robotsRules],
    llmsTxt: settings.llmsTxt,
    indexNow: settings.indexNow,
    mailProvider: settings.mailProvider,
    mailFromName: settings.mailFromName,
    mailFromAddress: settings.mailFromAddress,
    mailReplyTo: settings.mailReplyTo,
    contactEmail: settings.contactEmail,
    securityContacts: [...settings.securityContacts],
    securityPolicy: settings.securityPolicy,
    securityLanguages: settings.securityLanguages,
    relays: [...settings.relays],
    locationSharing: settings.locationSharing,
    // Every menu the site holds, written whole. A settings page never has
    // them off its own form — it reads them out of the file inside the write
    // and hands them straight back — so the one screen that models them is the
    // one that edits them (TASK-108).
    menus: Object.fromEntries(
      Object.entries(settings.menus).map(([name, items]) => [
        name,
        items.map((item) => ({ ...item })),
      ]),
    ),
    taxonomyRedirects: settings.taxonomyRedirects.map((entry) => ({ ...entry })),
  };

  // The key the menu lived under before menus had names. A rename leaves
  // nothing behind: a `navigation` array sitting beside `menus` in a file
  // nothing reads it from is the kind of thing somebody edits for an hour
  // before noticing.
  delete file['navigation'];
  // The Solo author switch, which the author setting now says on its own
  // (TASK-192): a username is a solo author site and no author is not.
  delete file['soloAuthor'];

  // `theme` is absent for a site on the packaged theme, on the same rule and
  // for the same reason as the two above: running what the package ships is
  // not a choice a site should have to write down, and a `theme` of `""` would
  // be a name no directory has. `locale` too: a site whose dates follow its
  // language has made no choice to write down.
  // `author` too: a site with several authors names nobody (TASK-192).
  for (const key of ['homepage', 'postsPage', 'theme', 'locale', 'author', 'icon'] as const) {
    if (settings[key] === '') delete file[key];
    else file[key] = settings[key];
  }

  delete file['licenseName'];
  if (settings.license === '') delete file['license'];
  else if (settings.license !== 'custom') file['license'] = settings.license;
  else {
    file['license'] = settings.licenseUrl;
    file['licenseName'] = settings.licenseName;
  }

  // A site that has never turned IndexNow on has no key to write down.
  if (settings.indexNowKey !== '') file['indexNowKey'] = settings.indexNowKey;
  else delete file['indexNowKey'];

  if (settings.clientsWithoutPkce.length > 0) {
    file['clientsWithoutPkce'] = [...settings.clientsWithoutPkce];
  } else delete file['clientsWithoutPkce'];

  return file;
}

/** The absolute path of one site's `content/_data/site.json`. */
export function siteDataPath(contentDir: string): string {
  return path.join(contentDir, ...SITE_DATA_FILE.split('/'));
}

/** The bytes of one settings object, as the file holds them. */
function siteJsonText(settings: SiteSettings, existing: Record<string, unknown>): string {
  return `${JSON.stringify(siteJsonFor(settings, existing), null, 2)}\n`;
}

/**
 * Rewrite `content/_data/site.json` as these settings, keeping the keys they
 * do not model.
 *
 * {@link updateSiteSettings} for a caller whose new settings depend on the old
 * ones, which every screen's is: this is for the callers that have the whole
 * object already, a test's set-up among them.
 */
export async function writeSiteJson(options: {
  contentDir: string;
  settings: SiteSettings;
}): Promise<void> {
  await updateSiteSettings({ contentDir: options.contentDir, change: () => options.settings });
}

/**
 * Change the settings: re-read the file, apply the change, write it back, with
 * nothing able to write that file in between ({@link updateFileAtomically}).
 *
 * The re-read is what makes the file win the way it wins for a post
 * (decision-9). Two people with the settings screen open both save what they
 * see, and the second save is applied to what the first one actually wrote
 * rather than to what the second one had on screen — so a change to a field
 * the second person did not touch survives. The write is a temporary file and
 * a rename, so a reader — an Eleventy build, the site data source, another
 * process entirely — never sees a half-written file. Keys the settings do not
 * model, `feedSize` and anything a site added, are kept.
 */
export async function updateSiteSettings(options: {
  contentDir: string;
  change: (current: SiteSettings) => SiteSettings;
}): Promise<SiteSettings> {
  let written = DEFAULT_SITE_SETTINGS;

  await updateFileAtomically(siteDataPath(options.contentDir), (current) => {
    const existing = parseSiteJson(current ?? '');
    written = options.change(settingsFromSiteJson(existing));
    return siteJsonText(written, existing);
  });

  return written;
}

/**
 * Turn an older site's settings rows into `content/_data/site.json`, once, and
 * drop the table.
 *
 * TASK-14 made SQLite the source and the file its mirror; decision-9 reversed
 * that, and a site upgrading across the two has rows nothing would ever read
 * again. So the first boot of this version writes them out. Which side wins
 * when both have something to say is decided the way it is decided everywhere
 * else: the file wins when it was written after the last save, because that is
 * a hand edit or a restored checkout, and the rows win otherwise. Either way
 * the actor handle and type come from the rows, because `site.json` never
 * carried them and losing them would rename the site's actor.
 *
 * Synchronous because `createCms` is: it runs before the server is listening
 * and before anything else has touched the file.
 */
export function migrateSettingsToFile(options: { admin: AdminStore; contentDir: string }): void {
  const { admin, contentDir } = options;
  const rows = admin.legacySettings();

  if (rows !== undefined && rows.length > 0) {
    const stored = settingsFromRows(rows);
    const file = siteDataPath(contentDir);
    const existing = parseSiteJson(readFileIfPresentSync(file) ?? '');
    const settings = fileWasEditedLast(file, rows) ? settingsFromSiteJson(existing) : stored;

    writeFileAtomicallySync(file, siteJsonText(settings, existing));
  }

  // Dropped whether or not it had rows: a fresh database gets the table from
  // migration 3, which has shipped and so is never edited, and a site that has
  // been migrated must not be asked again on the next boot.
  admin.dropLegacyTable('settings');
}

/** The old key/value rows as settings, defaults filled in. */
function settingsFromRows(rows: readonly LegacySetting[]): SiteSettings {
  const stored: Record<string, string> = {};
  for (const row of rows) stored[row.key] = row.value;

  // Through the file's own reader, so one description of what a setting is
  // worth serves both: the rows are spelled as the file spells them and read
  // back the same way. `relays`, `navigation` and `taxonomyRedirects` were
  // stored one entry per line, which is not how the file holds them.
  return settingsFromSiteJson({
    ...stored,
    ...(stored['baseUrl'] === undefined ? {} : { url: stored['baseUrl'] }),
    ...(stored['postsPerPage'] === undefined
      ? {}
      : { postsPerPage: Number(stored['postsPerPage']) }),
    relays: relayList(stored['relays'] ?? ''),
    menus: { [DEFAULT_MENU_NAME]: menuItemsFromText(stored['navigation'] ?? '') },
    taxonomyRedirects: redirectList(stored['taxonomyRedirects'] ?? ''),
  });
}

/**
 * Whether `site.json` has been written since the newest settings row was.
 *
 * A missing file has not, so the rows win. A file whose modification time
 * cannot be read is treated the same way: the rows are the only thing that is
 * certainly there.
 */
function fileWasEditedLast(file: string, rows: readonly LegacySetting[]): boolean {
  let modified: number;
  try {
    modified = statSync(file).mtimeMs;
  } catch {
    return false;
  }

  const newest = rows.reduce((latest, row) => {
    const at = Date.parse(row.updatedAt);
    return Number.isNaN(at) ? latest : Math.max(latest, at);
  }, 0);

  return modified > newest;
}

/**
 * The base URL actually in effect, and why.
 *
 * A base URL is a deployment fact before it is a preference: it decides the
 * absolute URLs in the feeds, the ActivityPub ids, and whether the session
 * cookie is `Secure`. So `GEEKITY_BASE_URL` and a `baseUrl` in the config file
 * both win over the stored setting, and the settings form says so rather than
 * offering a field that would quietly do nothing.
 */
export function effectiveBaseUrl(
  config: Pick<ResolvedConfig, 'baseUrl' | 'baseUrlSource'>,
  settings: SiteSettings,
): string {
  if (config.baseUrlSource !== 'default') return config.baseUrl;
  return settings.baseUrl === '' ? config.baseUrl : settings.baseUrl;
}

/**
 * What a check may need to know beyond the form itself.
 *
 * One field has anything here, and it is the theme: whether a name is a theme
 * is a question about the file system rather than about the string, and only
 * the config knows where this site's themes are. A check given no context does
 * what it can — the theme's is still a name it can refuse — so a caller with
 * no config in hand is not blocked.
 */
export interface SettingsContext {
  /** Where the site's themes are: {@link ResolvedConfig.themesDir}. */
  themesDir?: string | undefined;
  contentDir?: string | undefined;
}

/**
 * What is wrong with each field of a submitted form: one check per field, so a
 * page can run the checks for the fields it carries and no others.
 *
 * A field nothing can be wrong with — a tagline, an author, a checkbox — has a
 * check all the same, because a table with a hole in it is a field somebody
 * added and forgot to think about.
 */
const FIELD_CHECKS: Record<
  SettingsField,
  (form: SettingsForm, context: SettingsContext) => string | undefined
> = {
  title: (form) => (form.title.trim() === '' ? 'The site needs a title.' : undefined),

  tagline: () => undefined,

  author: () => undefined,

  baseUrl: (form) =>
    normalizeBaseUrl(form.baseUrl) === undefined
      ? 'The base URL has to be an absolute http:// or https:// URL.'
      : undefined,

  postsPerPage: (form) => {
    const perPage = Number(form.postsPerPage);
    return !Number.isInteger(perPage) || perPage < 1
      ? 'Posts per page has to be a whole number of one or more.'
      : undefined;
  },

  // The two picks are checked as a pair, the way the archive bases are, and
  // for the same reason: two of the three rules are about the pair. Neither
  // check asks whether the slug still names a published page — the select only
  // offers ones that do, and a page drafted after it was picked is a site back
  // on its latest posts rather than a settings screen that will not save.
  homepage: (form) => slugProblem(form.homepage, 'A homepage'),

  postsPage: (form) => {
    if (form.postsPage.trim() === '') return undefined;
    if (form.homepage.trim() === '') {
      return 'A posts page needs a homepage: pick the page the front page shows first.';
    }
    if (form.postsPage.trim() === form.homepage.trim()) {
      return 'The homepage and the posts page have to be two different pages.';
    }
    return slugProblem(form.postsPage, 'A posts page');
  },

  timezone: (form) =>
    isValidTimezone(form.timezone)
      ? undefined
      : 'That is not an IANA time zone name, such as Europe/London.',

  language: (form) =>
    LANGUAGE_TAG_PATTERN.test(form.language.trim())
      ? undefined
      : 'That is not a language tag, such as en, en-GB or pt-BR.',

  // Empty is the ordinary value: the dates follow the language.
  locale: (form) => {
    const locale = form.locale.trim();
    return locale === '' ||
      (LANGUAGE_TAG_PATTERN.test(locale) && canonicalLocale(locale) !== undefined)
      ? undefined
      : 'That is not a locale, such as en-US, fr-CA or pt-BR, or empty for the language.';
  },

  // Empty is a value here — it is how a site says "the theme the package
  // ships" — so only a name has anything to check. A name that is not a theme
  // is refused rather than saved and warned about later: the screen has a list
  // of the themes that are there, so the only way to type one that is not is a
  // theme deleted between drawing the list and saving it, and the person is in
  // front of the form and can be told.
  theme: (form, context) => {
    const name = form.theme.trim();
    if (name === '') return undefined;

    const badName = themeNameProblem(name);
    if (badName !== undefined) return badName;
    if (context.themesDir === undefined) return undefined;

    const read = readTheme(path.join(context.themesDir, name));
    return read.ok ? undefined : `There is no theme called "${name}": ${read.reason}`;
  },

  icon: (form, context) => iconProblem(form.icon.trim(), context),

  license: (form) =>
    isLicenseChoice(form.license.trim()) ? undefined : 'Choose a license from the list.',

  licenseUrl: (form) =>
    form.license.trim() === 'custom' && !isLicenseUrl(form.licenseUrl.trim())
      ? 'A custom license needs the URL of its terms, starting http:// or https://.'
      : undefined,

  licenseName: (form) =>
    form.license.trim() === 'custom' && form.licenseName.trim() === ''
      ? 'A custom license needs a name for the footer to show.'
      : undefined,

  comments: () => undefined,

  // The empty string is refused rather than read as zero, which is what
  // `Number('')` would make it: a cleared field is a mistake, and "never close
  // comments" should have to be typed.
  commentsCloseAfterDays: (form) => {
    const typed = form.commentsCloseAfterDays.trim();
    const days = Number(typed);
    return typed === '' || !Number.isInteger(days) || days < 0
      ? 'Comments close after a whole number of days, or 0 for never.'
      : undefined;
  },

  commentEmailRetentionDays: (form) => retentionProblem(form.commentEmailRetentionDays),

  addressHashRetentionDays: (form) => retentionProblem(form.addressHashRetentionDays),

  contactMessageRetentionDays: (form) => retentionProblem(form.contactMessageRetentionDays),

  webmentionsSend: () => undefined,

  webmentionsReceive: () => undefined,

  // Empty is a value here — it is how a site turns real-time notification off
  // — so only a non-empty one has to be a URL. http as well as https, because
  // a notify server on a private network or a loopback port is a real one.
  notifyServer: (form) =>
    form.notifyServer.trim() !== '' && normalizeBaseUrl(form.notifyServer) === undefined
      ? 'A notify server is an absolute http:// or https:// URL, or empty for none.'
      : undefined,

  feedUpdatePeriod: (form) =>
    isUpdatePeriod(form.feedUpdatePeriod)
      ? undefined
      : `An update period is one of ${UPDATE_PERIODS.join(', ')}.`,

  feedUpdateFrequency: (form) =>
    form.feedUpdateFrequency.trim() !== '' && isPollCount(Number(form.feedUpdateFrequency))
      ? undefined
      : 'Polls per period is a whole number, 1 or more.',

  aiCrawlers: (form) =>
    isAiCrawlerPolicy(form.aiCrawlers)
      ? undefined
      : `An AI-crawler policy is one of ${AI_CRAWLER_POLICIES.join(', ')}.`,

  contentSignalSearch: (form) => contentSignalProblem(form.contentSignalSearch),

  contentSignalAiInput: (form) => contentSignalProblem(form.contentSignalAiInput),

  contentSignalAiTrain: (form) => contentSignalProblem(form.contentSignalAiTrain),

  robotsRules: (form) => robotsRuleProblem([form.robotsRules]),

  llmsTxt: () => undefined,

  indexNow: () => undefined,

  mailProvider: (form) =>
    (MAIL_PROVIDERS as readonly string[]).includes(form.mailProvider)
      ? undefined
      : `A mail provider is one of ${MAIL_PROVIDERS.join(', ')}.`,

  mailFromName: () => undefined,

  // Empty is a value for both of these — no From address falls back to
  // `no-reply@` at the site's host, and no reply-to means replies go to the
  // From address — so only a non-empty one has to look like an address.
  mailFromAddress: (form) =>
    form.mailFromAddress.trim() !== '' && !EMAIL_PATTERN.test(form.mailFromAddress.trim())
      ? 'A From address is an email address, such as blog@example.com, or empty for the default.'
      : undefined,

  mailReplyTo: (form) =>
    form.mailReplyTo.trim() !== '' && !EMAIL_PATTERN.test(form.mailReplyTo.trim())
      ? 'A reply-to is an email address, such as hello@example.com, or empty to reply to the From address.'
      : undefined,

  // Empty is a value here too — it is how a site says "whichever admin has an
  // address" — so only a non-empty one has to look like one.
  contactEmail: (form) =>
    form.contactEmail.trim() !== '' && !EMAIL_PATTERN.test(form.contactEmail.trim())
      ? 'A contact address is an email address, such as hello@example.com, or empty for the first admin with one.'
      : undefined,

  // Line by line, like the relays, and for the same reason.
  securityContacts: (form) => {
    const bad = relayLines(form.securityContacts).find(
      (line) => normalizeSecurityContact(line) === undefined,
    );
    return bad === undefined
      ? undefined
      : 'A security contact is an email address, an https:// URL or a tel: number, one per line. ' +
          `"${bad}" is not one.`;
  },

  // RFC 9116 wants every web URI in the file to be https.
  securityPolicy: (form) =>
    form.securityPolicy.trim() !== '' && normalizeSecurityPolicy(form.securityPolicy) === undefined
      ? 'A security policy is an https:// URL, or empty for none.'
      : undefined,

  securityLanguages: (form) =>
    normalizeLanguageList(form.securityLanguages) === undefined
      ? 'Preferred languages are language tags separated by commas, such as en, fr, or empty for none.'
      : undefined,

  // A relay list is checked line by line, and the first bad line is what the
  // field says: a textarea has one message, and pointing at the line somebody
  // has to fix is more use than counting how many are wrong.
  relays: (form) => {
    const bad = relayLines(form.relays).find((line) => normalizeRelayInbox(line) === undefined);
    return bad === undefined
      ? undefined
      : `A relay is its inbox as an absolute http:// or https:// URL, one per line. ` +
          `"${bad}" is not one.`;
  },

  locationSharing: (form) =>
    isLocationSharing(form.locationSharing)
      ? undefined
      : `Location sharing is one of ${LOCATION_SHARING.join(', ')}.`,

  // The two archive bases are checked as a pair, because two of the rules —
  // that they differ, and that neither takes a path the site already answers
  // on — are about the pair rather than either one. They are on one page for
  // exactly that reason.
  tagBase: (form) => taxonomyBaseProblems({ tag: form.tagBase, category: form.categoryBase }).tag,

  categoryBase: (form) =>
    taxonomyBaseProblems({ tag: form.tagBase, category: form.categoryBase }).category,
};

function isLicenseChoice(value: string): value is LicenseChoice {
  return value === '' || value === 'custom' || isCreativeCommonsKey(value);
}

function licenseFromSiteJson(
  file: Record<string, unknown>,
): Pick<SiteSettings, 'license' | 'licenseUrl' | 'licenseName'> | Record<string, never> {
  const said = classifyLicense(file['license']);
  if (said === undefined || said === NO_LICENSE) return {};
  if ('key' in said) return { license: said.key, licenseUrl: '', licenseName: '' };

  const name = typeof file['licenseName'] === 'string' ? file['licenseName'].trim() : '';
  return { license: 'custom', licenseUrl: said.url, licenseName: name };
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
  return file !== undefined && isFile(file)
    ? undefined
    : `There is no upload at ${icon}. Upload the picture on the Media screen first.`;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** What is wrong with a submitted Content-Signal choice. */
function contentSignalProblem(value: string): string | undefined {
  return isContentSignalChoice(value) ? undefined : 'A content signal is yes, no, or not said.';
}

/** Every field of the settings, in the order the form fields name them. */
export const SETTINGS_FIELD_NAMES: readonly SettingsField[] = Object.keys(
  SETTINGS_FIELDS,
) as SettingsField[];

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
    const problem = FIELD_CHECKS[name](form, context);
    if (problem !== undefined) problems[name] = problem;
  }

  return problems;
}

/**
 * A validated form as settings. Only call it on a form
 * {@link settingsProblems} found nothing wrong with.
 *
 * The archive renames and the menus are carried in rather than read off the
 * form, because they are not on it: the taxonomy screens write the one and the
 * Navigation screen the other, and a save of the fields that are on the form
 * keeps whatever is stored. Passing the settings read inside the write is all
 * a caller has to do, since they hold both.
 */
export function settingsFromForm(form: SettingsForm, carried: CarriedSettings = {}): SiteSettings {
  return {
    taxonomyRedirects: carried.taxonomyRedirects ?? DEFAULT_SITE_SETTINGS.taxonomyRedirects,
    menus: carried.menus ?? DEFAULT_SITE_SETTINGS.menus,
    clientsWithoutPkce: carried.clientsWithoutPkce ?? DEFAULT_SITE_SETTINGS.clientsWithoutPkce,
    title: form.title.trim(),
    tagline: form.tagline.trim(),
    baseUrl: normalizeBaseUrl(form.baseUrl) ?? '',
    timezone: form.timezone.trim(),
    language: form.language.trim(),
    locale: form.locale.trim(),
    postsPerPage: Number(form.postsPerPage),
    homepage: form.homepage.trim(),
    // A posts page means nothing without a homepage, and the validator has
    // already refused the pair; this is what makes clearing the homepage clear
    // the listing's own page with it rather than leave it stranded.
    postsPage: form.homepage.trim() === '' ? '' : form.postsPage.trim(),
    author: form.author.trim(),
    theme: form.theme.trim(),
    icon: form.icon.trim(),
    ...licenseFromForm(form),
    tagBase: form.tagBase.trim(),
    categoryBase: form.categoryBase.trim(),
    // A checkbox submits nothing at all when it is clear, which is what the
    // empty string here means.
    comments: form.comments !== '',
    commentsCloseAfterDays: Number(form.commentsCloseAfterDays),
    commentEmailRetentionDays: Number(form.commentEmailRetentionDays),
    addressHashRetentionDays: Number(form.addressHashRetentionDays),
    contactMessageRetentionDays: Number(form.contactMessageRetentionDays),
    webmentionsSend: form.webmentionsSend !== '',
    webmentionsReceive: form.webmentionsReceive !== '',
    notifyServer: normalizeBaseUrl(form.notifyServer) ?? '',
    feedUpdatePeriod: isUpdatePeriod(form.feedUpdatePeriod)
      ? form.feedUpdatePeriod
      : DEFAULT_FEED_CADENCE.period,
    feedUpdateFrequency: Number(form.feedUpdateFrequency),
    aiCrawlers: isAiCrawlerPolicy(form.aiCrawlers) ? form.aiCrawlers : 'allow',
    contentSignalSearch: isContentSignalChoice(form.contentSignalSearch)
      ? form.contentSignalSearch
      : '',
    contentSignalAiInput: isContentSignalChoice(form.contentSignalAiInput)
      ? form.contentSignalAiInput
      : '',
    contentSignalAiTrain: isContentSignalChoice(form.contentSignalAiTrain)
      ? form.contentSignalAiTrain
      : '',
    robotsRules: robotsRuleLines([form.robotsRules]),
    llmsTxt: form.llmsTxt !== '',
    indexNow: form.indexNow !== '',
    // Minted the first time IndexNow is turned on and never again, so the key
    // the search engines verified outlives turning it off and on.
    indexNowKey:
      carried.indexNowKey !== undefined && carried.indexNowKey !== ''
        ? carried.indexNowKey
        : form.indexNow !== ''
          ? generateIndexNowKey()
          : '',
    mailProvider: (MAIL_PROVIDERS as readonly string[]).includes(form.mailProvider)
      ? (form.mailProvider as MailProviderName)
      : 'none',
    mailFromName: form.mailFromName.trim(),
    mailFromAddress: form.mailFromAddress.trim(),
    mailReplyTo: form.mailReplyTo.trim(),
    contactEmail: form.contactEmail.trim(),
    securityContacts: securityContactList(form.securityContacts),
    securityPolicy: normalizeSecurityPolicy(form.securityPolicy) ?? '',
    securityLanguages: normalizeLanguageList(form.securityLanguages) ?? '',
    relays: relayList(form.relays),
    locationSharing: isLocationSharing(form.locationSharing) ? form.locationSharing : 'none',
  };
}

function licenseFromForm(
  form: SettingsForm,
): Pick<SiteSettings, 'license' | 'licenseUrl' | 'licenseName'> {
  const license = form.license.trim();
  if (license === 'custom') {
    return { license, licenseUrl: form.licenseUrl.trim(), licenseName: form.licenseName.trim() };
  }
  return {
    license: isLicenseChoice(license) ? license : '',
    licenseUrl: '',
    licenseName: '',
  };
}

/** The settings as the form shows them. */
export function formFromSettings(settings: SiteSettings): SettingsForm {
  return {
    title: settings.title,
    tagline: settings.tagline,
    baseUrl: settings.baseUrl,
    timezone: settings.timezone,
    language: settings.language,
    locale: settings.locale,
    postsPerPage: String(settings.postsPerPage),
    homepage: settings.homepage,
    postsPage: settings.postsPage,
    author: settings.author,
    theme: settings.theme,
    icon: settings.icon,
    license: settings.license,
    licenseUrl: settings.licenseUrl,
    licenseName: settings.licenseName,
    tagBase: settings.tagBase,
    categoryBase: settings.categoryBase,
    comments: settings.comments ? '1' : '',
    commentsCloseAfterDays: String(settings.commentsCloseAfterDays),
    commentEmailRetentionDays: String(settings.commentEmailRetentionDays),
    addressHashRetentionDays: String(settings.addressHashRetentionDays),
    contactMessageRetentionDays: String(settings.contactMessageRetentionDays),
    webmentionsSend: settings.webmentionsSend ? '1' : '',
    webmentionsReceive: settings.webmentionsReceive ? '1' : '',
    notifyServer: settings.notifyServer,
    feedUpdatePeriod: settings.feedUpdatePeriod,
    feedUpdateFrequency: String(settings.feedUpdateFrequency),
    aiCrawlers: settings.aiCrawlers,
    contentSignalSearch: settings.contentSignalSearch,
    contentSignalAiInput: settings.contentSignalAiInput,
    contentSignalAiTrain: settings.contentSignalAiTrain,
    robotsRules: settings.robotsRules.join('\n'),
    llmsTxt: settings.llmsTxt ? '1' : '',
    indexNow: settings.indexNow ? '1' : '',
    mailProvider: settings.mailProvider,
    mailFromName: settings.mailFromName,
    mailFromAddress: settings.mailFromAddress,
    mailReplyTo: settings.mailReplyTo,
    contactEmail: settings.contactEmail,
    securityContacts: settings.securityContacts.join('\n'),
    securityPolicy: settings.securityPolicy,
    securityLanguages: settings.securityLanguages,
    relays: settings.relays.join('\n'),
    locationSharing: settings.locationSharing,
  };
}
/**
 * A `taxonomy|from|to` block as the renames it names, which is how the old
 * settings table spelled them ({@link migrateSettingsToFile}).
 *
 * The same tolerance the rest of this file reads its lists with: a line that
 * is not three non-empty parts naming a real taxonomy is dropped rather than
 * failing the read.
 */
function redirectList(value: string): TaxonomyRedirect[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of value.split('\n')) {
    const parts = line.split('|');
    if (parts.length !== 3) continue;
    entries.push({
      taxonomy: (parts[0] ?? '').trim(),
      from: (parts[1] ?? '').trim(),
      to: (parts[2] ?? '').trim(),
    });
  }
  // Through the same reader `site.json` goes through, so the two spellings of
  // the list cannot mean different things.
  return taxonomyRedirectsOf(entries);
}

/**
 * A base URL, normalised the way `resolveConfig` normalises the configured
 * one, or `undefined` when it is not an absolute http(s) URL.
 */
function normalizeBaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

  const pathname = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
  return parsed.origin + pathname;
}

/**
 * The non-empty lines of a relay textarea, trimmed.
 *
 * Blank lines are not an error: somebody pasting a list leaves them, and a
 * blank line asks for nothing.
 */
function relayLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * A relay textarea as the list of inboxes it names: normalised, in the order
 * they were given, with repeats dropped.
 *
 * Exported because the same parsing turns a stored setting, a submitted form
 * and a `site.json` array into the one list; a second spelling of it would let
 * the file and the database disagree about what a site subscribes to.
 */
export function relayList(value: string): string[] {
  const relays: string[] = [];
  for (const line of relayLines(value)) {
    const inbox = normalizeRelayInbox(line);
    if (inbox !== undefined && !relays.includes(inbox)) relays.push(inbox);
  }
  return relays;
}

/**
 * A relay inbox URL, or `undefined` when it is not an absolute http(s) one.
 *
 * Unlike {@link normalizeBaseUrl} this keeps the whole URL bar a trailing
 * slash: a relay inbox is a path — `/user/_____relay_____/inbox` — rather than
 * an origin, and some relays hang one off a query string.
 */
export function normalizeRelayInbox(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

  const href = parsed.href;
  return href.endsWith('/') && parsed.pathname !== '/' ? href.slice(0, -1) : href;
}

/** A security contact textarea as its URIs, in order, repeats dropped. */
function securityContactList(value: string): string[] {
  const contacts: string[] = [];
  for (const line of relayLines(value)) {
    const contact = normalizeSecurityContact(line);
    if (contact !== undefined && !contacts.includes(contact)) contacts.push(contact);
  }
  return contacts;
}

/** A phone number as a `tel:` URI writes it: digits and visual separators. */
const TEL_PATTERN = /^tel:\+?[0-9][0-9().-]*$/i;

/**
 * One security contact as the URI security.txt carries, or `undefined`.
 *
 * A bare address is taken as the `mailto:` it means, since that is what
 * somebody filling in a settings form types.
 */
function normalizeSecurityContact(value: string): string | undefined {
  const trimmed = value.trim();
  const address = trimmed.toLowerCase().startsWith('mailto:') ? trimmed.slice(7) : trimmed;
  if (EMAIL_PATTERN.test(address)) return `mailto:${address}`;
  if (TEL_PATTERN.test(trimmed)) return `tel:${trimmed.slice(4)}`;
  return httpsUrl(trimmed);
}

/** A security policy URL, or `undefined` when it is not an https one. */
function normalizeSecurityPolicy(value: string): string | undefined {
  return httpsUrl(value.trim());
}

/** An absolute https URL as `URL` spells it, or `undefined`. */
function httpsUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  return parsed.protocol === 'https:' ? parsed.href : undefined;
}

/**
 * A comma-separated list of language tags, joined the way RFC 9116's example
 * writes them, or `undefined` when one of them is not a tag. Empty is a value.
 */
function normalizeLanguageList(value: string): string | undefined {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return tags.every((tag) => LANGUAGE_TAG_PATTERN.test(tag)) ? tags.join(', ') : undefined;
}

/**
 * What a page slug may be made of on this screen: the shape
 * {@link slugify} produces, which is what the editor writes.
 *
 * The setting travels no further than a lookup by slug, so this is about
 * catching a hand-typed value rather than about safety.
 */
const PAGE_SLUG_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

/** What is wrong with one page pick, or `undefined`. Empty is a value. */
function slugProblem(value: string, what: string): string | undefined {
  const slug = value.trim();
  return slug === '' || PAGE_SLUG_PATTERN.test(slug)
    ? undefined
    : `${what} is the slug of one of the site's pages, such as about.`;
}

/** Whether `Intl` knows the zone. An empty name is not a zone. */
function isValidTimezone(value: string): boolean {
  const zone = value.trim();
  if (zone === '') return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** One site.json as an object, empty when it is missing or will not parse. */
function readSiteJsonSync(file: string): Record<string, unknown> {
  return parseSiteJson(readFileIfPresentSync(file) ?? '');
}

/** The same, from bytes already in hand. */
export function parseSiteJson(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {};
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** The three retention periods, as the sweep reads them. */
export function retentionPolicyOf(settings: SiteSettings): RetentionPolicy {
  return {
    commentEmailDays: settings.commentEmailRetentionDays,
    addressHashDays: settings.addressHashRetentionDays,
    contactMessageDays: settings.contactMessageRetentionDays,
  };
}

/** A retention key from `site.json`, when it holds a whole number of days. */
function wholeDays(
  file: Record<string, unknown>,
  key: 'commentEmailRetentionDays' | 'addressHashRetentionDays' | 'contactMessageRetentionDays',
): Partial<SiteSettings> {
  const days = file[key];
  return typeof days === 'number' && Number.isInteger(days) && days >= 0 ? { [key]: days } : {};
}

/**
 * What is wrong with a typed retention period, if anything. Empty is refused
 * rather than read as zero, because zero keeps the data forever and a cleared
 * field should not be how a site says that.
 */
function retentionProblem(typed: string): string | undefined {
  const days = Number(typed.trim());
  return typed.trim() === '' || !Number.isInteger(days) || days < 0
    ? 'Keep it for a whole number of days, or 0 to keep it forever.'
    : undefined;
}
