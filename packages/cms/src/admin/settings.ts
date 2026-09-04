import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import type { DeliveryReport } from '../federation/delivery.ts';
import type { RelaySyncReport } from '../federation/relays.ts';
import { SITE_DATA_FILE } from '../web/context.ts';
import { DEFAULT_NOTIFY_SERVER } from '../web/feeds.ts';
import type { SiteData } from '../web/context.ts';
import { navigationItemsOf } from '../web/navigation.ts';
import type { NavigationItem } from '../web/navigation.ts';
import {
  DEFAULT_TAXONOMY_BASES,
  taxonomyBaseProblems,
  taxonomyRedirectsOf,
} from '../web/taxonomy.ts';
import type { TaxonomyBases, TaxonomyRedirect } from '../web/taxonomy.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import type { AdminStore } from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { refusedUpload, storeUpload } from './uploads.ts';

/** Where the settings screen lives. */
export const SETTINGS_PATH = `${ADMIN_PREFIX}/settings`;

/** Where the avatar's upload form and its Remove button post. */
export const AVATAR_PATH = `${SETTINGS_PATH}/avatar`;

/** The fields those two forms submit. */
export const AVATAR_FIELDS = { file: 'avatar', action: 'action' } as const;

/** The {@link AVATAR_FIELDS.action} that takes the avatar down again. */
export const AVATAR_REMOVE = 'remove';

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
 * The settings the admin owns, doc-1's "data that lives only in SQLite".
 *
 * They are the source of truth once a site has booted once. The public subset
 * is mirrored to `content/_data/site.json` on every save so an Eleventy build
 * of the same content directory renders with the same values.
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
   * Where the site announces that a feed changed, and the server its feeds
   * advertise as their rssCloud endpoint and their WebSub hub. An absolute
   * http(s) URL, {@link DEFAULT_NOTIFY_SERVER} by default; empty turns
   * real-time notification off altogether.
   */
  notifyServer: string;
  /**
   * The relay inboxes the site subscribes to (FEP-ae0c): a Mastodon-style
   * relay boosts every public post it is sent, which is how a small site
   * reaches instances nobody on it follows.
   *
   * Each is the relay's own inbox URL, absolute and whole — a relay's inbox is
   * a path like `/user/_____relay_____/inbox`, not an origin. The list is
   * edited one per line and mirrored to `site.json`; where each subscription
   * stands is in the database, because the handshake is not the site's to
   * decide.
   */
  relays: readonly string[];
  /**
   * The site menu: an ordered list of `{ label, url }` the theme renders in
   * the header, and the mirror of it in `site.json` an Eleventy build reads.
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
  notifyServer: DEFAULT_NOTIFY_SERVER,
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
  notifyServer: 'notify_server',
  relays: 'relays',
  navigation: 'navigation',
} as const satisfies Record<SettingsField, string>;

/** A submitted settings form, before it is known to be valid. */
export type SettingsForm = Record<SettingsField, string>;

/** One message per field that is wrong. An empty object is a valid form. */
export type SettingsProblems = Partial<Record<SettingsField, string>>;

/** The stored settings, with every default filled in. */
export function readSiteSettings(store: AdminStore): SiteSettings {
  const stored = store.allSettings();
  const postsPerPage = Number(stored['postsPerPage']);

  return {
    title: stored['title'] ?? DEFAULT_SITE_SETTINGS.title,
    tagline: stored['tagline'] ?? DEFAULT_SITE_SETTINGS.tagline,
    baseUrl: stored['baseUrl'] ?? DEFAULT_SITE_SETTINGS.baseUrl,
    timezone: stored['timezone'] ?? DEFAULT_SITE_SETTINGS.timezone,
    language: stored['language'] ?? DEFAULT_SITE_SETTINGS.language,
    postsPerPage:
      Number.isInteger(postsPerPage) && postsPerPage > 0
        ? postsPerPage
        : DEFAULT_SITE_SETTINGS.postsPerPage,
    author: stored['author'] ?? DEFAULT_SITE_SETTINGS.author,
    actorHandle: stored['actorHandle'] ?? DEFAULT_SITE_SETTINGS.actorHandle,
    actorType: ACTOR_TYPES.includes(stored['actorType'] ?? '')
      ? (stored['actorType'] as string)
      : DEFAULT_SITE_SETTINGS.actorType,
    avatar: stored['avatar'] ?? DEFAULT_SITE_SETTINGS.avatar,
    tagBase: stored['tagBase'] ?? DEFAULT_SITE_SETTINGS.tagBase,
    categoryBase: stored['categoryBase'] ?? DEFAULT_SITE_SETTINGS.categoryBase,
    notifyServer: stored['notifyServer'] ?? DEFAULT_SITE_SETTINGS.notifyServer,
    relays: relayList(stored['relays'] ?? ''),
    navigation: navigationList(stored['navigation'] ?? ''),
    taxonomyRedirects: redirectList(stored['taxonomyRedirects'] ?? ''),
  };
}

/** The two archive bases the settings hold, as the URL builders want them. */
export function taxonomyBasesFromSettings(settings: SiteSettings): TaxonomyBases {
  return { tag: settings.tagBase, category: settings.categoryBase };
}

/** Write a whole settings object back to the store. */
export function writeSiteSettings(store: AdminStore, settings: SiteSettings): void {
  store.setSettings({
    title: settings.title,
    tagline: settings.tagline,
    baseUrl: settings.baseUrl,
    timezone: settings.timezone,
    language: settings.language,
    postsPerPage: String(settings.postsPerPage),
    author: settings.author,
    actorHandle: settings.actorHandle,
    actorType: settings.actorType,
    avatar: settings.avatar,
    tagBase: settings.tagBase,
    categoryBase: settings.categoryBase,
    notifyServer: settings.notifyServer,
    // One per line, which is the shape the form submits and the shape the
    // list reads in: the settings table holds strings, and a delimiter that
    // cannot appear inside a URL costs nothing to parse back.
    relays: settings.relays.join('\n'),
    // The same `Label | URL` lines the textarea submits, for the same reason
    // the relays are stored as their own lines: the settings table holds
    // strings, and a value that reads back through the parser the form went
    // through cannot mean something different in the two places.
    navigation: navigationText(settings.navigation),
    // One `taxonomy|from|to` line per rename, for the reason the menu is
    // lines: the settings table holds strings, and a value that reads back
    // through the parser it was written with cannot mean two things.
    taxonomyRedirects: redirectText(settings.taxonomyRedirects),
  });
}

/**
 * The settings as the `site` global, for the theme and for the JSON mirror.
 *
 * Empty strings are left out rather than written as empty values, so a key a
 * site keeps in `site.json` by hand and leaves blank in the form is overlaid
 * rather than blanked.
 */
export function settingsSiteData(settings: SiteSettings): Partial<SiteData> {
  return {
    ...(settings.title === '' ? {} : { title: settings.title }),
    ...(settings.tagline === '' ? {} : { tagline: settings.tagline }),
    ...(settings.baseUrl === '' ? {} : { url: settings.baseUrl }),
    ...(settings.author === '' ? {} : { author: settings.author }),
    ...(settings.timezone === '' ? {} : { timezone: settings.timezone }),
    ...(settings.language === '' ? {} : { language: settings.language }),
    ...(settings.avatar === '' ? {} : { avatar: settings.avatar }),
    postsPerPage: settings.postsPerPage,
    tagBase: settings.tagBase,
    categoryBase: settings.categoryBase,
    // Written even when it is empty, unlike the other strings above: empty is
    // what turns the notifications off, so it has to reach the mirror as a
    // value rather than as an absence a default would fill back in.
    notifyServer: settings.notifyServer,
    relays: [...settings.relays],
    navigation: settings.navigation.map((item) => ({ ...item })),
    taxonomyRedirects: settings.taxonomyRedirects.map((entry) => ({ ...entry })),
  };
}

/**
 * `content/_data/site.json` as it should read for these settings.
 *
 * Every key the form manages is written whether or not it has a value, so the
 * file's shape is stable and an Eleventy template may reference `site.author`
 * without guarding it. Every other key the file already had is kept: a site
 * may put anything in there and reach it from its templates, and the settings
 * form is not going to be the thing that throws it away.
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
    tagBase: settings.tagBase,
    categoryBase: settings.categoryBase,
    notifyServer: settings.notifyServer,
    relays: [...settings.relays],
    navigation: settings.navigation.map((item) => ({ ...item })),
    taxonomyRedirects: settings.taxonomyRedirects.map((entry) => ({ ...entry })),
  };
}

/** The absolute path of one site's `content/_data/site.json`. */
export function siteDataPath(contentDir: string): string {
  return path.join(contentDir, ...SITE_DATA_FILE.split('/'));
}

/**
 * Rewrite `content/_data/site.json` from the settings.
 *
 * Written to a temporary file in the same directory and renamed over the old
 * one, so a reader — an Eleventy build, or the CMS's own site data source —
 * sees either the whole old file or the whole new one and never a half-written
 * one.
 */
export async function writeSiteJson(options: {
  contentDir: string;
  settings: SiteSettings;
}): Promise<void> {
  const file = siteDataPath(options.contentDir);
  await mkdir(path.dirname(file), { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    existing = parseSiteJson(await readFile(file, 'utf8'));
  } catch {
    // No file yet, or one that will not parse. Either way the settings are
    // what the file is about to say.
  }

  const temporary = `${file}.${process.pid.toString(36)}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(siteJsonFor(options.settings, existing), null, 2)}\n`,
    'utf8',
  );
  await rename(temporary, file);
}

/**
 * Fill an empty settings table from `content/_data/site.json`, so a site that
 * existed before this screen did — or one `geekity init` just wrote — keeps
 * the values it already had.
 *
 * Runs once, on the boot that finds the table empty. After that SQLite is the
 * source and the file is the mirror, so a later hand edit of the file no
 * longer wins.
 */
export function seedSiteSettings(options: {
  store: AdminStore;
  config: Pick<ResolvedConfig, 'contentDir' | 'baseUrl' | 'baseUrlSource'>;
}): SiteSettings {
  const { store, config } = options;
  if (store.countSettings() > 0) return readSiteSettings(store);

  const file = readSiteJsonSync(siteDataPath(config.contentDir));
  const postsPerPage = Number(file['postsPerPage']);

  const seeded: SiteSettings = {
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
    ...(typeof file['tagBase'] === 'string' && file['tagBase'] !== ''
      ? { tagBase: file['tagBase'] }
      : {}),
    ...(typeof file['categoryBase'] === 'string' && file['categoryBase'] !== ''
      ? { categoryBase: file['categoryBase'] }
      : {}),
    // The empty string counts here, unlike the bases above: a file that says
    // the notify server is empty is a site that turned the feature off.
    ...(typeof file['notifyServer'] === 'string' ? { notifyServer: file['notifyServer'] } : {}),
    // The file is where a site that predates this screen — or one restored
    // from its content directory — says which relays it belongs to, and the
    // relay service turns a listed relay with no record into a fresh Follow.
    ...(Array.isArray(file['relays'])
      ? {
          relays: relayList(file['relays'].filter((entry) => typeof entry === 'string').join('\n')),
        }
      : {}),
    // The menu a site already had, read the same tolerant way a render reads
    // it, so a hand-written entry that is not an item is dropped here rather
    // than stored and mirrored back out.
    ...(Array.isArray(file['navigation'])
      ? { navigation: navigationItemsOf(file['navigation']) }
      : {}),
    // The renames a site already published redirects for. They are facts about
    // its URLs rather than preferences, so a content directory restored on its
    // own keeps answering the archive URLs it used to.
    ...(Array.isArray(file['taxonomyRedirects'])
      ? { taxonomyRedirects: taxonomyRedirectsOf(file['taxonomyRedirects']) }
      : {}),
    ...(Number.isInteger(postsPerPage) && postsPerPage > 0 ? { postsPerPage } : {}),
    // The file's `url` only becomes the setting when the deployment has not
    // named one; otherwise the setting records what is actually in effect.
    baseUrl:
      config.baseUrlSource === 'default' && typeof file['url'] === 'string' && file['url'] !== ''
        ? file['url']
        : config.baseUrl,
  };

  writeSiteSettings(store, seeded);
  return seeded;
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

/** What is wrong with a submitted settings form, one message per field. */
export function settingsProblems(form: SettingsForm): SettingsProblems {
  const problems: SettingsProblems = {};

  if (form.title.trim() === '') problems.title = 'The site needs a title.';

  const url = normalizeBaseUrl(form.baseUrl);
  if (url === undefined) {
    problems.baseUrl = 'The base URL has to be an absolute http:// or https:// URL.';
  }

  const perPage = Number(form.postsPerPage);
  if (!Number.isInteger(perPage) || perPage < 1) {
    problems.postsPerPage = 'Posts per page has to be a whole number of one or more.';
  }

  if (!isValidTimezone(form.timezone)) {
    problems.timezone = 'That is not an IANA time zone name, such as Europe/London.';
  }

  if (!LANGUAGE_TAG_PATTERN.test(form.language.trim())) {
    problems.language = 'That is not a language tag, such as en, en-GB or pt-BR.';
  }

  if (!ACTOR_HANDLE_PATTERN.test(form.actorHandle)) {
    problems.actorHandle =
      'An actor handle is 1 to 64 letters, digits, dashes or underscores, with no @ and no dots.';
  }

  if (!ACTOR_TYPES.includes(form.actorType)) {
    problems.actorType = `An actor type is one of ${ACTOR_TYPES.join(', ')}.`;
  }

  // Empty is a value here — it is how a site turns real-time notification off
  // — so only a non-empty one has to be a URL. http as well as https, because
  // a notify server on a private network or a loopback port is a real one.
  if (form.notifyServer.trim() !== '' && normalizeBaseUrl(form.notifyServer) === undefined) {
    problems.notifyServer =
      'A notify server is an absolute http:// or https:// URL, or empty for none.';
  }

  // A relay list is checked line by line, and the first bad line is what the
  // field says: a textarea has one message, and pointing at the line somebody
  // has to fix is more use than counting how many are wrong.
  const badRelay = relayLines(form.relays).find((line) => normalizeRelayInbox(line) === undefined);
  if (badRelay !== undefined) {
    problems.relays =
      `A relay is its inbox as an absolute http:// or https:// URL, one per line. ` +
      `"${badRelay}" is not one.`;
  }

  // A menu is checked line by line like the relays, and for the same reason:
  // one message on a textarea is more use pointing at the line to fix than
  // counting how many are wrong.
  const badItem = navigationLines(form.navigation).find(
    (line) => navigationItem(line) === undefined,
  );
  if (badItem !== undefined) {
    problems.navigation =
      `A menu item is "Label | URL", one per line, where the URL is a path ` +
      `like /about/ or an absolute http:// or https:// URL. "${badItem}" is not one.`;
  }

  // The two archive bases are checked as a pair: two of the rules — that they
  // differ, and that neither takes a path the site already answers on — are
  // about the pair rather than either one.
  const bases = taxonomyBaseProblems({ tag: form.tagBase, category: form.categoryBase });
  if (bases.tag !== undefined) problems.tagBase = bases.tag;
  if (bases.category !== undefined) problems.categoryBase = bases.category;

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
    notifyServer: normalizeBaseUrl(form.notifyServer) ?? '',
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
    notifyServer: settings.notifyServer,
    relays: settings.relays.join('\n'),
    navigation: navigationText(settings.navigation),
  };
}

/** What {@link mountSettings} needs from the admin around it. */
export interface MountSettingsOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register the settings screen.
 *
 * A save writes SQLite and `content/_data/site.json` in that order, so the
 * store — which is what the theme reads — is never behind the file. A form the
 * validator has anything to say about is a 400 that writes neither.
 */
export function mountSettings(app: Hono<GeekityEnv>, options: MountSettingsOptions): void {
  const { render } = options;

  app.get(SETTINGS_PATH, (c) =>
    render(c, ADMIN_TEMPLATES.settings, screen(c.var.config, readSiteSettings(c.var.admin))),
  );

  app.post(SETTINGS_PATH, async (c) => {
    const body = await c.req.parseBody();
    const stored = readSiteSettings(c.var.admin);
    const submitted: SettingsForm = {
      title: field(body[SETTINGS_FIELDS.title]),
      tagline: field(body[SETTINGS_FIELDS.tagline]),
      // A field the form rendered read-only is not submitted, so an overridden
      // base URL keeps the value it had rather than being cleared by a save.
      baseUrl:
        c.var.config.baseUrlSource === 'default'
          ? field(body[SETTINGS_FIELDS.baseUrl])
          : stored.baseUrl === ''
            ? c.var.config.baseUrl
            : stored.baseUrl,
      timezone: field(body[SETTINGS_FIELDS.timezone]),
      language: field(body[SETTINGS_FIELDS.language]),
      postsPerPage: field(body[SETTINGS_FIELDS.postsPerPage]),
      author: field(body[SETTINGS_FIELDS.author]),
      actorHandle: field(body[SETTINGS_FIELDS.actorHandle]),
      actorType: field(body[SETTINGS_FIELDS.actorType]),
      tagBase: field(body[SETTINGS_FIELDS.tagBase]),
      categoryBase: field(body[SETTINGS_FIELDS.categoryBase]),
      notifyServer: field(body[SETTINGS_FIELDS.notifyServer]),
      relays: field(body[SETTINGS_FIELDS.relays]),
      navigation: field(body[SETTINGS_FIELDS.navigation]),
    };

    const problems = settingsProblems(submitted);
    if (Object.keys(problems).length > 0) {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.settings, {
        ...screen(c.var.config, stored),
        form: submitted,
        problems,
      });
    }

    const settings = settingsFromForm(submitted, stored.avatar, stored.taxonomyRedirects);
    await store(c, settings);

    // The name, the summary and the handle are the actor's profile as much as
    // the avatar is, and a follower's copy of it is only as fresh as the last
    // thing it was told.
    const report = profileChanged(stored, settings)
      ? await c.var.delivery.updateActor()
      : undefined;

    // The relay list is the only setting that is an instruction as well as a
    // value: a line added is a `Follow` to send and a line removed is an
    // `Undo`. The reconciliation reads the settings that were just written, so
    // it has to come after the save rather than be derived from the form.
    const relays = c.var.relays.sync();

    flash(c, 'notice', `Settings saved.${toldFollowers(report)}${toldRelays(relays)}`);
    return c.redirect(SETTINGS_PATH, 303);
  });

  /**
   * The avatar's own endpoint: one multipart form uploads an image, and a
   * second, plain one takes it down again.
   *
   * It is separate from the settings form because a file cannot travel in a
   * urlencoded body, and because the two should not share a fate: a rejected
   * image must not lose an edit to the title, and a rejected title must not
   * lose the avatar. A refusal is a flash and a redirect, so what is stored is
   * exactly what it was and the screen says why.
   */
  app.post(AVATAR_PATH, async (c) => {
    const body = await c.req.parseBody();
    const stored = readSiteSettings(c.var.admin);

    if (field(body[AVATAR_FIELDS.action]) === AVATAR_REMOVE) {
      if (stored.avatar === '') {
        flash(c, 'notice', 'The site has no avatar.');
        return c.redirect(SETTINGS_PATH, 303);
      }

      await store(c, { ...stored, avatar: '' });
      const removal = await c.var.delivery.updateActor();
      flash(c, 'notice', `Avatar removed.${toldFollowers(removal)}`);
      return c.redirect(SETTINGS_PATH, 303);
    }

    const outcome = await storeUpload(body[AVATAR_FIELDS.file], c.var.config, {
      imagesOnly: true,
    });
    if (refusedUpload(outcome)) {
      flash(c, 'error', `${outcome.error} The avatar is unchanged.`);
      return c.redirect(SETTINGS_PATH, 303);
    }

    await store(c, { ...stored, avatar: outcome.url });
    const report = await c.var.delivery.updateActor();
    flash(c, 'notice', `Avatar saved.${toldFollowers(report)}`);
    return c.redirect(SETTINGS_PATH, 303);
  });

  /**
   * Write settings to SQLite and then to `content/_data/site.json`, in that
   * order, so the store — which is what the theme reads — is never behind the
   * file.
   */
  async function store(c: Context<GeekityEnv>, settings: SiteSettings): Promise<void> {
    await storeSiteSettings({
      admin: c.var.admin,
      contentDir: c.var.config.contentDir,
      settings,
    });
  }
}

/**
 * Write settings to SQLite and then to `content/_data/site.json`, in that
 * order, so the store — which is what the theme reads — is never behind the
 * file.
 *
 * Exported because the settings screen is no longer the only thing that writes
 * a setting: the taxonomy screens record a renamed archive, and the two have
 * to write it the same way or the file and the database would drift.
 */
export async function storeSiteSettings(options: {
  admin: AdminStore;
  contentDir: string;
  settings: SiteSettings;
}): Promise<void> {
  writeSiteSettings(options.admin, options.settings);
  await writeSiteJson({ contentDir: options.contentDir, settings: options.settings });
}

/**
 * A stored `taxonomy|from|to` block as the renames it names.
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

/** The renames as the settings table holds them, one per line. */
function redirectText(redirects: readonly TaxonomyRedirect[]): string {
  return redirects.map((entry) => `${entry.taxonomy}|${entry.from}|${entry.to}`).join('\n');
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
 * The sentence a flash adds about the followers, when there were any: a save
 * of the profile is also an announcement, and it should say so rather than
 * leave the admin wondering.
 */
function toldFollowers(report: DeliveryReport | undefined): string {
  const total = report?.deliveries.length ?? 0;
  if (total === 0) return '';
  return total === 1
    ? ' One follower has been told.'
    : ` ${String(total)} followers have been told.`;
}

/**
 * The sentence a flash adds about the relays a save subscribed to or left.
 *
 * A relay does not answer at once — FEP-ae0c allows a human to approve the
 * subscription days later — so the message says a follow was sent rather than
 * that the site is now on the relay, and points at the screen that will say.
 */
function toldRelays(report: RelaySyncReport): string {
  const parts: string[] = [];
  if (report.followed.length > 0) {
    parts.push(
      report.followed.length === 1
        ? 'A follow has been sent to one new relay'
        : `Follows have been sent to ${String(report.followed.length)} new relays`,
    );
  }
  if (report.unfollowed.length > 0) {
    parts.push(
      report.unfollowed.length === 1
        ? 'one relay has been unfollowed'
        : `${String(report.unfollowed.length)} relays have been unfollowed`,
    );
  }
  if (parts.length === 0) return '';

  const sentence = parts.join(', and ');
  return ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}; the Federation screen says where each stands.`;
}

/** Everything the settings template renders, for a given set of settings. */
function screen(
  config: Pick<ResolvedConfig, 'baseUrl' | 'baseUrlSource'>,
  settings: SiteSettings,
): Record<string, unknown> {
  const overridden = config.baseUrlSource !== 'default';

  return {
    section: 'settings',
    settingsUrl: SETTINGS_PATH,
    fields: SETTINGS_FIELDS,
    actorTypes: ACTOR_TYPES,
    avatar: settings.avatar,
    avatarUrl: AVATAR_PATH,
    avatarFields: AVATAR_FIELDS,
    avatarRemove: AVATAR_REMOVE,
    form: formFromSettings(settings),
    problems: {},
    baseUrlInEffect: effectiveBaseUrl(config, settings),
    baseUrlOverridden: overridden,
    baseUrlSource: config.baseUrlSource,
    baseUrlNote: overridden
      ? config.baseUrlSource === 'environment'
        ? 'GEEKITY_BASE_URL is set, so it is the base URL in effect and this field is not editable here.'
        : 'The config file sets baseUrl, so it is the base URL in effect and this field is not editable here.'
      : 'Absolute URLs, the feeds and the session cookie pick this up when the site next starts.',
  };
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
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

function readSiteJsonSync(file: string): Record<string, unknown> {
  try {
    return parseSiteJson(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function parseSiteJson(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
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
