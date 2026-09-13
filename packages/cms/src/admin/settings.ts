import { statSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_COMMENTS_CLOSE_AFTER_DAYS } from '../comments/policy.ts';
import type { ResolvedConfig } from '../config.ts';
import {
  readFileIfPresentSync,
  updateFileAtomically,
  writeFileAtomicallySync,
} from '../files/atomic.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import type { MailProviderName } from '../mail/provider.ts';
import { SITE_DATA_FILE } from '../web/context.ts';
import { DEFAULT_NOTIFY_SERVER } from '../web/feeds.ts';
import { navigationItemsOf } from '../web/navigation.ts';
import type { NavigationItem } from '../web/navigation.ts';
import {
  DEFAULT_TAXONOMY_BASES,
  taxonomyBaseProblems,
  taxonomyRedirectsOf,
} from '../web/taxonomy.ts';
import type { TaxonomyBases, TaxonomyRedirect } from '../web/taxonomy.ts';
import { ADMIN_PREFIX } from './session.ts';
import type { AdminStore, LegacySetting } from './store.ts';

/**
 * Where the settings live: the General page, and the root every other settings
 * page hangs off ({@link settingsPagePath}).
 */
export const SETTINGS_PATH = `${ADMIN_PREFIX}/settings`;

/**
 * The ActivityPub actor types doc-4 allows a site to be.
 *
 * `Person` is first because it is the default: some clients hide `Service`
 * actors from timelines, which is the wrong thing for a personal blog.
 */
export const ACTOR_TYPES: readonly string[] = [
  'Person',
  'Organization',
  'Service',
  'Group',
  'Application',
];

/**
 * What an actor handle may be made of. Tighter than a username: the handle
 * becomes the local part of `@handle@host` in WebFinger and in every mention
 * somebody types, so it holds no punctuation that would need escaping there.
 */
export const ACTOR_HANDLE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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
  /** How many posts a listing page holds. A positive integer. */
  postsPerPage: number;
  /** Site author, used as the feed author. May be empty. */
  author: string;
  /** The local part of the ActivityPub handle, `@{handle}@{host}` (doc-4). */
  actorHandle: string;
  /** Which ActivityPub actor type the site is, one of {@link ACTOR_TYPES}. */
  actorType: string;
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
   * The site menu: an ordered list of `{ label, url }` the theme renders in
   * the header and an Eleventy build reads out of `site.json`.
   *
   * The list is edited one `Label | URL` per line. A page may put itself on
   * the menu as well, with `navigation: true` in its front matter; those come
   * after these, so the menu a site typed out stays as it was typed.
   */
  navigation: readonly NavigationItem[];
  /**
   * The site's avatar, as the public path the upload endpoint handed back —
   * `/uploads/2026/09/me.png` — or an absolute URL for one hosted elsewhere.
   * Empty when the site has none.
   *
   * It is not a field of the settings form: an image is uploaded and removed
   * through {@link AVATAR_PATH}, because a file cannot travel in a urlencoded
   * body and because a save of the other fields must not silently drop it.
   */
  avatar: string;
  /**
   * The taxonomy archives that have moved: one `{ taxonomy, from, to }` per
   * term the taxonomy screens renamed or merged away, so the URL it used to
   * live at can point at the one it lives at now.
   *
   * Not a field of the settings form either, and for a stronger reason than
   * the avatar: it is a record of what happened rather than a preference, and
   * the taxonomy screens are what write it. Chains are collapsed as they are
   * recorded, so the list answers every old URL in one hop.
   */
  taxonomyRedirects: readonly TaxonomyRedirect[];
}

/**
 * The settings the form on the settings screen carries.
 *
 * Every setting but the avatar, which is a file rather than a field, and the
 * recorded archive renames, which the taxonomy screens write; see
 * {@link SiteSettings.avatar} and {@link SiteSettings.taxonomyRedirects}.
 */
export type SettingsField = Exclude<keyof SiteSettings, 'avatar' | 'taxonomyRedirects'>;

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
  postsPerPage: 10,
  author: '',
  actorHandle: 'blog',
  actorType: 'Person',
  avatar: '',
  tagBase: DEFAULT_TAXONOMY_BASES.tag,
  categoryBase: DEFAULT_TAXONOMY_BASES.category,
  comments: true,
  commentsCloseAfterDays: DEFAULT_COMMENTS_CLOSE_AFTER_DAYS,
  webmentionsSend: true,
  webmentionsReceive: true,
  notifyServer: DEFAULT_NOTIFY_SERVER,
  mailProvider: 'none',
  mailFromName: '',
  mailFromAddress: '',
  mailReplyTo: '',
  contactEmail: '',
  relays: [],
  navigation: [],
  taxonomyRedirects: [],
};

/** The form field each setting is submitted under. */
export const SETTINGS_FIELDS = {
  title: 'title',
  tagline: 'tagline',
  baseUrl: 'base_url',
  timezone: 'timezone',
  language: 'language',
  postsPerPage: 'posts_per_page',
  author: 'author',
  actorHandle: 'actor_handle',
  actorType: 'actor_type',
  tagBase: 'tag_base',
  categoryBase: 'category_base',
  comments: 'comments',
  commentsCloseAfterDays: 'comments_close_after_days',
  webmentionsSend: 'webmentions_send',
  webmentionsReceive: 'webmentions_receive',
  notifyServer: 'notify_server',
  mailProvider: 'mail_provider',
  mailFromName: 'mail_from_name',
  mailFromAddress: 'mail_from_address',
  mailReplyTo: 'mail_reply_to',
  contactEmail: 'contact_email',
  relays: 'relays',
  navigation: 'navigation',
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
  return settingsFromSiteJson(readSiteJsonSync(siteDataPath(contentDir)));
}

/**
 * `content/_data/site.json` as the settings it names, defaults filled in.
 *
 * Read tolerantly, key by key, because the file is public, in git and editable
 * by hand: a key of the wrong type, or one a site has never written, falls
 * back to the default rather than taking the site down. The empty string is a
 * value of its own for `tagline`, `author`, `avatar` and `notifyServer`, where
 * empty is a decision — no tagline, no avatar, notifications off — and not for
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
    ...(typeof file['avatar'] === 'string' ? { avatar: file['avatar'] } : {}),
    ...(typeof file['actorHandle'] === 'string' && file['actorHandle'] !== ''
      ? { actorHandle: file['actorHandle'] }
      : {}),
    // Only a type this version knows, because it becomes a vocabulary class: a
    // file naming one it does not is the default actor rather than a 500 on
    // the actor URL.
    ...(typeof file['actorType'] === 'string' && ACTOR_TYPES.includes(file['actorType'])
      ? { actorType: file['actorType'] }
      : {}),
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
    ...(typeof file['webmentionsSend'] === 'boolean'
      ? { webmentionsSend: file['webmentionsSend'] }
      : {}),
    ...(typeof file['webmentionsReceive'] === 'boolean'
      ? { webmentionsReceive: file['webmentionsReceive'] }
      : {}),
    ...(typeof file['notifyServer'] === 'string' ? { notifyServer: file['notifyServer'] } : {}),
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
    // Through the same normaliser a submitted form goes through, so the file
    // and the screen cannot mean different things by the same line.
    ...(Array.isArray(file['relays'])
      ? {
          relays: relayList(file['relays'].filter((entry) => typeof entry === 'string').join('\n')),
        }
      : {}),
    ...(Array.isArray(file['navigation'])
      ? { navigation: navigationItemsOf(file['navigation']) }
      : {}),
    // The renames a site has published redirects for: facts about its URLs
    // rather than preferences, which is why a content directory restored on
    // its own keeps answering the archive URLs it used to.
    ...(Array.isArray(file['taxonomyRedirects'])
      ? { taxonomyRedirects: taxonomyRedirectsOf(file['taxonomyRedirects']) }
      : {}),
    ...(Number.isInteger(postsPerPage) && postsPerPage > 0 ? { postsPerPage } : {}),
    ...(typeof file['url'] === 'string' ? { baseUrl: file['url'] } : {}),
  };
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
 * `site.author` without guarding it. Every other key the file already had is
 * kept: a site may put anything in there and reach it from its templates, and
 * the settings form is not going to be the thing that throws it away.
 */
export function siteJsonFor(
  settings: SiteSettings,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...existing,
    title: settings.title,
    tagline: settings.tagline,
    url: settings.baseUrl,
    author: settings.author,
    postsPerPage: settings.postsPerPage,
    timezone: settings.timezone,
    language: settings.language,
    avatar: settings.avatar,
    // The two the file did not carry while SQLite held the settings. It has to
    // now: nothing else remembers which handle `@you@example.com` resolves to,
    // and an actor whose handle changed is one every follower has to find
    // again.
    actorHandle: settings.actorHandle,
    actorType: settings.actorType,
    tagBase: settings.tagBase,
    categoryBase: settings.categoryBase,
    comments: settings.comments,
    commentsCloseAfterDays: settings.commentsCloseAfterDays,
    webmentionsSend: settings.webmentionsSend,
    webmentionsReceive: settings.webmentionsReceive,
    notifyServer: settings.notifyServer,
    mailProvider: settings.mailProvider,
    mailFromName: settings.mailFromName,
    mailFromAddress: settings.mailFromAddress,
    mailReplyTo: settings.mailReplyTo,
    contactEmail: settings.contactEmail,
    relays: [...settings.relays],
    navigation: settings.navigation.map((item) => ({ ...item })),
    taxonomyRedirects: settings.taxonomyRedirects.map((entry) => ({ ...entry })),
  };
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
    const settings = fileWasEditedLast(file, rows)
      ? {
          ...settingsFromSiteJson(existing),
          actorHandle: stored.actorHandle,
          actorType: stored.actorType,
        }
      : stored;

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
    navigation: navigationList(stored['navigation'] ?? ''),
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
 * What is wrong with each field of a submitted form: one check per field, so a
 * page can run the checks for the fields it carries and no others.
 *
 * A field nothing can be wrong with — a tagline, an author, a checkbox — has a
 * check all the same, because a table with a hole in it is a field somebody
 * added and forgot to think about.
 */
const FIELD_CHECKS: Record<SettingsField, (form: SettingsForm) => string | undefined> = {
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

  timezone: (form) =>
    isValidTimezone(form.timezone)
      ? undefined
      : 'That is not an IANA time zone name, such as Europe/London.',

  language: (form) =>
    LANGUAGE_TAG_PATTERN.test(form.language.trim())
      ? undefined
      : 'That is not a language tag, such as en, en-GB or pt-BR.',

  actorHandle: (form) =>
    ACTOR_HANDLE_PATTERN.test(form.actorHandle)
      ? undefined
      : 'An actor handle is 1 to 64 letters, digits, dashes or underscores, with no @ and no dots.',

  actorType: (form) =>
    ACTOR_TYPES.includes(form.actorType)
      ? undefined
      : `An actor type is one of ${ACTOR_TYPES.join(', ')}.`,

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

  webmentionsSend: () => undefined,

  webmentionsReceive: () => undefined,

  // Empty is a value here — it is how a site turns real-time notification off
  // — so only a non-empty one has to be a URL. http as well as https, because
  // a notify server on a private network or a loopback port is a real one.
  notifyServer: (form) =>
    form.notifyServer.trim() !== '' && normalizeBaseUrl(form.notifyServer) === undefined
      ? 'A notify server is an absolute http:// or https:// URL, or empty for none.'
      : undefined,

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

  // A menu is checked line by line like the relays, and for the same reason:
  // one message on a textarea is more use pointing at the line to fix than
  // counting how many are wrong.
  navigation: (form) => {
    const bad = navigationLines(form.navigation).find((line) => navigationItem(line) === undefined);
    return bad === undefined
      ? undefined
      : `A menu item is "Label | URL", one per line, where the URL is a path ` +
          `like /about/ or an absolute http:// or https:// URL. "${bad}" is not one.`;
  },

  // The two archive bases are checked as a pair, because two of the rules —
  // that they differ, and that neither takes a path the site already answers
  // on — are about the pair rather than either one. They are on one page for
  // exactly that reason.
  tagBase: (form) => taxonomyBaseProblems({ tag: form.tagBase, category: form.categoryBase }).tag,

  categoryBase: (form) =>
    taxonomyBaseProblems({ tag: form.tagBase, category: form.categoryBase }).category,
};

/** Every field of the settings, in the order the form fields name them. */
export const SETTINGS_FIELD_NAMES: readonly SettingsField[] = Object.keys(
  SETTINGS_FIELDS,
) as SettingsField[];

/**
 * What is wrong with a submitted settings form, one message per field.
 *
 * `fields` is what a page carries: it validates its own fields and says
 * nothing about the rest, so a page cannot refuse a save over a field it does
 * not show and gives no way to fix.
 */
export function settingsProblems(
  form: SettingsForm,
  fields: readonly SettingsField[] = SETTINGS_FIELD_NAMES,
): SettingsProblems {
  const problems: SettingsProblems = {};

  for (const name of fields) {
    const problem = FIELD_CHECKS[name](form);
    if (problem !== undefined) problems[name] = problem;
  }

  return problems;
}

/**
 * A validated form as settings. Only call it on a form
 * {@link settingsProblems} found nothing wrong with.
 *
 * The avatar and the recorded archive renames are carried in rather than read
 * off the form, because neither is on it: the image is uploaded and removed
 * through {@link AVATAR_PATH}, the renames are written by the taxonomy
 * screens, and a save of the other fields keeps whatever is stored.
 */
export function settingsFromForm(
  form: SettingsForm,
  avatar: string = DEFAULT_SITE_SETTINGS.avatar,
  taxonomyRedirects: readonly TaxonomyRedirect[] = DEFAULT_SITE_SETTINGS.taxonomyRedirects,
): SiteSettings {
  return {
    avatar,
    taxonomyRedirects,
    title: form.title.trim(),
    tagline: form.tagline.trim(),
    baseUrl: normalizeBaseUrl(form.baseUrl) ?? '',
    timezone: form.timezone.trim(),
    language: form.language.trim(),
    postsPerPage: Number(form.postsPerPage),
    author: form.author.trim(),
    actorHandle: form.actorHandle.trim(),
    actorType: form.actorType,
    tagBase: form.tagBase.trim(),
    categoryBase: form.categoryBase.trim(),
    // A checkbox submits nothing at all when it is clear, which is what the
    // empty string here means.
    comments: form.comments !== '',
    commentsCloseAfterDays: Number(form.commentsCloseAfterDays),
    webmentionsSend: form.webmentionsSend !== '',
    webmentionsReceive: form.webmentionsReceive !== '',
    notifyServer: normalizeBaseUrl(form.notifyServer) ?? '',
    mailProvider: (MAIL_PROVIDERS as readonly string[]).includes(form.mailProvider)
      ? (form.mailProvider as MailProviderName)
      : 'none',
    mailFromName: form.mailFromName.trim(),
    mailFromAddress: form.mailFromAddress.trim(),
    mailReplyTo: form.mailReplyTo.trim(),
    contactEmail: form.contactEmail.trim(),
    relays: relayList(form.relays),
    navigation: navigationList(form.navigation),
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
    postsPerPage: String(settings.postsPerPage),
    author: settings.author,
    actorHandle: settings.actorHandle,
    actorType: settings.actorType,
    tagBase: settings.tagBase,
    categoryBase: settings.categoryBase,
    comments: settings.comments ? '1' : '',
    commentsCloseAfterDays: String(settings.commentsCloseAfterDays),
    webmentionsSend: settings.webmentionsSend ? '1' : '',
    webmentionsReceive: settings.webmentionsReceive ? '1' : '',
    notifyServer: settings.notifyServer,
    mailProvider: settings.mailProvider,
    mailFromName: settings.mailFromName,
    mailFromAddress: settings.mailFromAddress,
    mailReplyTo: settings.mailReplyTo,
    contactEmail: settings.contactEmail,
    relays: settings.relays.join('\n'),
    navigation: navigationText(settings.navigation),
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
 * Whether a save moved something the ActivityPub actor carries, which is what
 * decides whether the followers are told (doc-4: the profile fields come from
 * the settings). The rest — the time zone, the page size — is the site's own
 * business and nobody else's.
 *
 * The base URL is not here either, though the profile is built on it: it is
 * settled at boot ({@link effectiveBaseUrl}), so an actor built the moment it
 * is saved would carry the old one and say nothing new.
 */
export function profileChanged(before: SiteSettings, after: SiteSettings): boolean {
  return (
    before.title !== after.title ||
    before.tagline !== after.tagline ||
    before.actorHandle !== after.actorHandle ||
    before.actorType !== after.actorType ||
    before.avatar !== after.avatar
  );
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
function parseSiteJson(source: string): Record<string, unknown> {
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

/**
 * The non-empty lines of the navigation textarea, trimmed.
 *
 * Blank lines are not an error, exactly as they are not in the relay list: a
 * pasted menu leaves them, and a blank line asks for nothing.
 */
function navigationLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * One `Label | URL` line as a menu item, or `undefined` when it is not one.
 *
 * The split is at the first bar, so a URL holding one — a query string, say —
 * survives and a label cannot hold one. The URL is either a site-root path or
 * an absolute http(s) URL: a bare `about/` would be resolved against whatever
 * page it was printed on, which is never what a menu means.
 */
function navigationItem(line: string): NavigationItem | undefined {
  const bar = line.indexOf('|');
  if (bar === -1) return undefined;

  const label = line.slice(0, bar).trim();
  const url = line.slice(bar + 1).trim();
  if (label === '' || url === '') return undefined;
  if (url.startsWith('/')) return { label, url };

  return normalizeRelayInbox(url) === undefined ? undefined : { label, url };
}

/**
 * A navigation textarea as the ordered items it names.
 *
 * Exported nowhere: the same parsing turns the stored setting and the
 * submitted form into one list, and `site.json` is read by
 * {@link navigationItemsOf} instead, because the file holds objects rather
 * than lines.
 */
function navigationList(value: string): NavigationItem[] {
  const items: NavigationItem[] = [];
  for (const line of navigationLines(value)) {
    const item = navigationItem(line);
    if (item !== undefined) items.push(item);
  }
  return items;
}

/** The items as the textarea shows them, and as the settings table holds them. */
function navigationText(items: readonly NavigationItem[]): string {
  return items.map((item) => `${item.label} | ${item.url}`).join('\n');
}
