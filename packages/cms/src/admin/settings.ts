import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import { SITE_DATA_FILE } from '../web/context.ts';
import type { SiteData } from '../web/context.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import type { AdminStore } from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the settings screen lives. */
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
  /** How many posts a listing page holds. A positive integer. */
  postsPerPage: number;
  /** Site author, used as the feed author. May be empty. */
  author: string;
  /** The local part of the ActivityPub handle, `@{handle}@{host}` (doc-4). */
  actorHandle: string;
  /** Which ActivityPub actor type the site is, one of {@link ACTOR_TYPES}. */
  actorType: string;
}

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
  postsPerPage: 10,
  author: '',
  actorHandle: 'blog',
  actorType: 'Person',
};

/** The form field each setting is submitted under. */
export const SETTINGS_FIELDS = {
  title: 'title',
  tagline: 'tagline',
  baseUrl: 'base_url',
  timezone: 'timezone',
  postsPerPage: 'posts_per_page',
  author: 'author',
  actorHandle: 'actor_handle',
  actorType: 'actor_type',
} as const satisfies Record<keyof SiteSettings, string>;

/** A submitted settings form, before it is known to be valid. */
export type SettingsForm = Record<keyof SiteSettings, string>;

/** One message per field that is wrong. An empty object is a valid form. */
export type SettingsProblems = Partial<Record<keyof SiteSettings, string>>;

/** The stored settings, with every default filled in. */
export function readSiteSettings(store: AdminStore): SiteSettings {
  const stored = store.allSettings();
  const postsPerPage = Number(stored['postsPerPage']);

  return {
    title: stored['title'] ?? DEFAULT_SITE_SETTINGS.title,
    tagline: stored['tagline'] ?? DEFAULT_SITE_SETTINGS.tagline,
    baseUrl: stored['baseUrl'] ?? DEFAULT_SITE_SETTINGS.baseUrl,
    timezone: stored['timezone'] ?? DEFAULT_SITE_SETTINGS.timezone,
    postsPerPage:
      Number.isInteger(postsPerPage) && postsPerPage > 0
        ? postsPerPage
        : DEFAULT_SITE_SETTINGS.postsPerPage,
    author: stored['author'] ?? DEFAULT_SITE_SETTINGS.author,
    actorHandle: stored['actorHandle'] ?? DEFAULT_SITE_SETTINGS.actorHandle,
    actorType: ACTOR_TYPES.includes(stored['actorType'] ?? '')
      ? (stored['actorType'] as string)
      : DEFAULT_SITE_SETTINGS.actorType,
  };
}

/** Write a whole settings object back to the store. */
export function writeSiteSettings(store: AdminStore, settings: SiteSettings): void {
  store.setSettings({
    title: settings.title,
    tagline: settings.tagline,
    baseUrl: settings.baseUrl,
    timezone: settings.timezone,
    postsPerPage: String(settings.postsPerPage),
    author: settings.author,
    actorHandle: settings.actorHandle,
    actorType: settings.actorType,
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
    postsPerPage: settings.postsPerPage,
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

  if (!ACTOR_HANDLE_PATTERN.test(form.actorHandle)) {
    problems.actorHandle =
      'An actor handle is 1 to 64 letters, digits, dashes or underscores, with no @ and no dots.';
  }

  if (!ACTOR_TYPES.includes(form.actorType)) {
    problems.actorType = `An actor type is one of ${ACTOR_TYPES.join(', ')}.`;
  }

  return problems;
}

/**
 * A validated form as settings. Only call it on a form
 * {@link settingsProblems} found nothing wrong with.
 */
export function settingsFromForm(form: SettingsForm): SiteSettings {
  return {
    title: form.title.trim(),
    tagline: form.tagline.trim(),
    baseUrl: normalizeBaseUrl(form.baseUrl) ?? '',
    timezone: form.timezone.trim(),
    postsPerPage: Number(form.postsPerPage),
    author: form.author.trim(),
    actorHandle: form.actorHandle.trim(),
    actorType: form.actorType,
  };
}

/** The settings as the form shows them. */
export function formFromSettings(settings: SiteSettings): SettingsForm {
  return {
    title: settings.title,
    tagline: settings.tagline,
    baseUrl: settings.baseUrl,
    timezone: settings.timezone,
    postsPerPage: String(settings.postsPerPage),
    author: settings.author,
    actorHandle: settings.actorHandle,
    actorType: settings.actorType,
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
      postsPerPage: field(body[SETTINGS_FIELDS.postsPerPage]),
      author: field(body[SETTINGS_FIELDS.author]),
      actorHandle: field(body[SETTINGS_FIELDS.actorHandle]),
      actorType: field(body[SETTINGS_FIELDS.actorType]),
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

    const settings = settingsFromForm(submitted);
    writeSiteSettings(c.var.admin, settings);
    await writeSiteJson({ contentDir: c.var.config.contentDir, settings });

    flash(c, 'notice', 'Settings saved.');
    return c.redirect(SETTINGS_PATH, 303);
  });
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
