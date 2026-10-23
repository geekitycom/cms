import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { settingsOver } from '../__testing__/settings.ts';
import { storedValues } from '../settings/registry.ts';
import { parseSiteJson, SITE, siteJsonPath } from '../site/namespace.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';
import { sandbox } from './__testing__/harness.ts';
import {
  formFromSettings,
  SETTINGS_FIELD_NAMES,
  SETTINGS_FIELDS,
  settingsProblems,
  siteChanges,
  submittedSettings,
} from './settings-fields.ts';
import type { SettingsForm } from './settings-fields.ts';

const box = sandbox();
after(() => box.cleanup());

const GOLDEN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'settings-fields-golden.json',
);

const EVERY_KEY: Record<string, unknown> = {
  feedSize: 20,
  title: 'A Blog',
  tagline: 'about things',
  url: 'https://blog.example',
  postsPerPage: 7,
  timezone: 'Europe/London',
  language: 'en-GB',
  locale: 'en-US',
  homepage: 'home',
  postsPage: 'blog',
  author: 'ada',
  theme: 'midnight',
  icon: ' /uploads/2026/10/icon.png ',
  license: 'https://license.example/terms',
  licenseName: ' My License ',
  tagBase: 'topics',
  categoryBase: 'sections',
  comments: false,
  commentsOnPosts: false,
  commentsOnPages: true,
  commentsCloseAfterDays: 30,
  commentEmailRetentionDays: 90,
  addressHashRetentionDays: 60,
  contactMessageRetentionDays: 365,
  webmentionsSend: false,
  webmentionsReceive: false,
  notifyServer: 'https://rpc.example/RPC2',
  feedUpdatePeriod: 'daily',
  feedUpdateFrequency: 2,
  aiCrawlers: 'block-all',
  contentSignalSearch: 'yes',
  contentSignalAiInput: 'no',
  contentSignalAiTrain: 'no',
  robotsRules: ['User-agent: BadBot', 'Disallow: /'],
  llmsTxt: false,
  headerIcon: true,
  indexNow: true,
  indexNowKey: 'abcdef0123456789',
  mailProvider: 'smtp',
  mailFromName: 'The Blog',
  mailFromAddress: 'blog@blog.example',
  mailReplyTo: 'hello@blog.example',
  contactEmail: 'me@blog.example',
  securityContacts: ['security@blog.example', 'https://blog.example/security', 'tel:+1-555-0100'],
  securityPolicy: 'https://blog.example/policy',
  securityLanguages: 'en,fr',
  relays: ['https://relay.example/inbox/', 'https://relay.example/inbox/'],
  locationSharing: 'place',
  menus: {
    main: [{ label: 'Home', url: '/' }],
    footer: [{ label: 'Me', url: 'https://me.example/', rel: 'me' }],
  },
  taxonomyRedirects: [{ taxonomy: 'tag', from: 'old', to: 'new' }],
  clientsWithoutPkce: ['https://app.example/', 'not a client', 'https://app.example/'],
  custom: { kept: true },
};

const EMPTY_STRINGS: Record<string, unknown> = Object.fromEntries(
  [...Object.keys(EVERY_KEY).filter((key) => key !== 'custom' && key !== 'feedSize')].map((key) => [
    key,
    '',
  ]),
);

const SITE_JSON_CASES: Record<string, string> = {
  missing: '',
  'not json': '{ title: ',
  'not an object': '[1, 2]',
  empty: '{}',
  'every key': JSON.stringify(EVERY_KEY, null, 2),
  'empty strings': JSON.stringify(EMPTY_STRINGS),
  'a creative commons license, with a stale name': JSON.stringify({
    license: 'CC-BY-SA',
    licenseName: 'Leftover',
  }),
  'a license nobody can read': JSON.stringify({ license: 42, licenseName: 'Leftover' }),
  'hand edits of the wrong type': JSON.stringify({
    title: 7,
    postsPerPage: '0',
    commentsCloseAfterDays: -1,
    commentEmailRetentionDays: 1.5,
    comments: 'yes',
    commentsOnPages: 'yes',
    feedUpdatePeriod: 'fortnightly',
    feedUpdateFrequency: 0,
    aiCrawlers: 'deny',
    contentSignalSearch: 'maybe',
    robotsRules: 'Disallow: /',
    indexNowKey: 'no',
    mailProvider: 'carrier-pigeon',
    securityContacts: ['not a contact', 42],
    securityPolicy: 'http://insecure.example/',
    securityLanguages: 'en, not a tag!',
    relays: ['ftp://relay.example/', 'https://relay.example/a'],
    locationSharing: 'everywhere',
    menus: 'main',
    taxonomyRedirects: [{ taxonomy: 'genre', from: 'a', to: 'b' }],
    clientsWithoutPkce: 'https://app.example/',
    url: 42,
  }),
  'legacy keys and an old key order': JSON.stringify({
    indexNowKey: 'abcdef0123456789',
    licenseName: 'Mine',
    navigation: [{ label: 'Home', url: '/' }],
    soloAuthor: true,
    license: 'https://license.example/',
    title: 'Old',
    clientsWithoutPkce: [],
    theme: '',
    homepage: '',
    locale: '',
  }),
};

const DEFAULT_FORM = formFromSettings(DEFAULT_SITE_SETTINGS);

const EVERY_FIELD: SettingsForm = {
  title: ' A Blog ',
  tagline: ' about things ',
  base_url: 'https://blog.example/',
  timezone: 'Europe/London',
  language: 'en-GB',
  locale: 'en-US',
  posts_per_page: '7',
  homepage: 'home',
  posts_page: 'blog',
  author: 'ada',
  theme: 'midnight',
  icon: '/uploads/2026/10/icon.png',
  license: 'custom',
  license_url: 'https://license.example/terms',
  license_name: 'My License',
  tag_base: 'topics',
  category_base: 'sections',
  comments: '',
  comments_on_posts: '',
  comments_on_pages: '1',
  comments_close_after_days: '30',
  comment_email_retention_days: '90',
  address_hash_retention_days: '60',
  contact_message_retention_days: '365',
  webmentions_send: '',
  webmentions_receive: '',
  notify_server: 'https://rpc.example/RPC2',
  feed_update_period: 'daily',
  feed_update_frequency: '2',
  ai_crawlers: 'block-all',
  content_signal_search: 'yes',
  content_signal_ai_input: 'no',
  content_signal_ai_train: 'yes',
  robots_rules: 'User-agent: BadBot\nDisallow: /',
  llms_txt: '',
  header_icon: '1',
  index_now: '1',
  gemini: '1',
  mail_provider: 'smtp',
  mail_from_name: 'The Blog',
  mail_from_address: 'blog@blog.example',
  mail_reply_to: 'hello@blog.example',
  contact_email: 'me@blog.example',
  security_contacts: 'security@blog.example\nhttps://blog.example/security\ntel:+1-555-0100',
  security_policy: 'https://blog.example/policy',
  security_languages: 'en,fr',
  relays: 'https://relay.example/inbox',
  location_sharing: 'exact',
};

const FORM_CASES: Record<string, SettingsForm> = {
  defaults: DEFAULT_FORM,
  'every field': EVERY_FIELD,
  'a creative commons license, with stale custom fields': {
    ...DEFAULT_FORM,
    license: ' cc-by ',
    license_url: 'https://x.example/',
    license_name: 'X',
  },
  'a posts page without a homepage': { ...DEFAULT_FORM, homepage: ' ', posts_page: 'blog' },
  'choices nobody offered': {
    ...DEFAULT_FORM,
    license: 'mine',
    feed_update_period: 'fortnightly',
    ai_crawlers: 'deny',
    content_signal_search: 'maybe',
    mail_provider: 'pigeon',
    location_sharing: 'everywhere',
    notify_server: '',
    base_url: 'not a url',
  },
};

const BAD_FORM: SettingsForm = {
  title: ' ',
  tagline: '',
  base_url: 'ftp://blog.example',
  timezone: 'Mars/Olympus',
  language: 'english',
  locale: 'nope!',
  posts_per_page: '0',
  homepage: 'a page',
  posts_page: 'blog',
  author: '',
  theme: '../elsewhere',
  icon: '/elsewhere/icon.png',
  license: 'mine',
  license_url: '',
  license_name: '',
  tag_base: 'same',
  category_base: 'same',
  comments: '',
  comments_on_posts: '',
  comments_on_pages: '',
  comments_close_after_days: '',
  comment_email_retention_days: '-1',
  address_hash_retention_days: 'x',
  contact_message_retention_days: '',
  webmentions_send: '',
  webmentions_receive: '',
  notify_server: 'nope',
  feed_update_period: 'fortnightly',
  feed_update_frequency: '0',
  ai_crawlers: 'deny',
  content_signal_search: 'maybe',
  content_signal_ai_input: 'maybe',
  content_signal_ai_train: 'maybe',
  robots_rules: 'Nonsense here',
  llms_txt: '',
  header_icon: '',
  index_now: '',
  gemini: '',
  mail_provider: 'pigeon',
  mail_from_name: '',
  mail_from_address: 'nobody',
  mail_reply_to: 'nobody',
  contact_email: 'nobody',
  security_contacts: 'nobody',
  security_policy: 'http://insecure.example/',
  security_languages: 'not a tag!',
  relays: 'ftp://relay.example/',
  location_sharing: 'everywhere',
};

function sorted(object: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

async function siteOf(source: string): Promise<{ contentDir: string; file: string }> {
  const contentDir = await box.dir('geekity-settings-golden-');
  const file = siteJsonPath(contentDir);
  await mkdir(path.dirname(file), { recursive: true });
  if (source !== '') await writeFile(file, source, 'utf8');
  return { contentDir, file };
}

async function rewritten(source: string): Promise<string> {
  const { contentDir, file } = await siteOf(source);
  await settingsOver({ contentDir, dataDir: contentDir }).set('site', new Map(), 'admin');
  return await readFile(file, 'utf8');
}

async function saved(form: SettingsForm, source: string): Promise<unknown> {
  const { contentDir, file } = await siteOf(source);
  const changes = siteChanges(submittedSettings(form, SETTINGS_FIELD_NAMES));
  const result = await settingsOver({ contentDir, dataDir: contentDir }).set(
    'site',
    changes,
    'admin',
  );
  return result.ok ? await readFile(file, 'utf8') : sorted(result.problems);
}

describe('the settings, pinned', () => {
  it('read, show and write every representative file and form as before (AC #4)', async () => {
    const files: Record<string, unknown> = {};
    for (const [name, source] of Object.entries(SITE_JSON_CASES)) {
      const settings = storedValues(SITE, parseSiteJson(source));
      files[name] = {
        settings: sorted(settings),
        form: sorted(formFromSettings(settings)),
        rewritten: await rewritten(source),
      };
    }

    const forms: Record<string, unknown> = {};
    for (const [name, form] of Object.entries(FORM_CASES)) {
      forms[name] = {
        settings: sorted(submittedSettings(form, SETTINGS_FIELD_NAMES)),
        fresh: await saved(form, ''),
        overEveryKey: await saved(form, SITE_JSON_CASES['every key'] ?? ''),
      };
    }

    const frames = {
      fields: sorted(SETTINGS_FIELDS),
      files,
      forms,
      problems: {
        good: sorted(settingsProblems(EVERY_FIELD)),
        bad: sorted(settingsProblems(BAD_FORM)),
      },
    };

    if (process.env['GOLDEN_UPDATE'] === '1') {
      await writeFile(GOLDEN, `${JSON.stringify(frames, null, 2)}\n`, 'utf8');
    }
    const expected: unknown = JSON.parse(await readFile(GOLDEN, 'utf8'));
    assert.equal(JSON.stringify(frames, null, 2), JSON.stringify(expected, null, 2));
  });
});

describe('every setting a page carries', () => {
  it('survives form to site.json to form (AC #2)', async () => {
    assert.deepEqual(
      Object.keys(EVERY_FIELD).sort(),
      Object.keys(SETTINGS_FIELDS).sort(),
      'the form sets every field',
    );

    const submitted = submittedSettings(EVERY_FIELD, SETTINGS_FIELD_NAMES);
    const { contentDir } = await siteOf('');
    const settings = settingsOver({ contentDir, dataDir: contentDir });
    const { theme: _theme, icon: _icon, ...checkable } = submitted;
    assert.deepEqual(await settings.set('site', siteChanges(checkable), 'admin'), { ok: true });
    const read = await settings.values(SITE);

    for (const [key, value] of Object.entries(checkable)) {
      assert.deepEqual(read[key as keyof SiteSettings], value, key);
      assert.notDeepEqual(value, DEFAULT_SITE_SETTINGS[key as keyof SiteSettings], `${key} set`);
    }

    const shown = formFromSettings({ ...read, theme: 'midnight', icon: EVERY_FIELD.icon });
    assert.deepEqual(submittedSettings(shown, SETTINGS_FIELD_NAMES), {
      ...checkable,
      theme: 'midnight',
      icon: EVERY_FIELD.icon,
    });
  });
});
