/**
 * Every setting pinned as it is read, shown and written (TASK-354 AC #2, #4):
 * the bytes a save leaves in `content/_data/site.json` for representative
 * files and forms, the settings and form each reads as, and the message each
 * field's check gives.
 *
 * `settings-golden.json` holds the expected frames. Run with
 * `GOLDEN_UPDATE=1` to rewrite it after a deliberate change.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sandbox } from '../admin/__testing__/harness.ts';
import {
  formFromSettings,
  SETTINGS_FIELDS,
  settingsFromForm,
  settingsProblems,
} from './settings-form.ts';
import type { CarriedSettings, SettingsForm } from './settings-form.ts';
import { DEFAULT_SITE_SETTINGS } from './settings.ts';
import type { SiteSettings } from './settings.ts';
import {
  settingsFromSiteJson,
  siteDataPath,
  siteJsonFor,
  updateSiteSettings,
} from './site-json.ts';

const box = sandbox();
after(() => box.cleanup());

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'settings-golden.json');

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

/** Every key the settings model, as a string where the file wants something else. */
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
  baseUrl: 'https://blog.example/',
  timezone: 'Europe/London',
  language: 'en-GB',
  locale: 'en-US',
  postsPerPage: '7',
  homepage: 'home',
  postsPage: 'blog',
  author: 'ada',
  theme: 'midnight',
  icon: '/uploads/2026/10/icon.png',
  license: 'custom',
  licenseUrl: 'https://license.example/terms',
  licenseName: 'My License',
  tagBase: 'topics',
  categoryBase: 'sections',
  comments: '',
  commentsCloseAfterDays: '30',
  commentEmailRetentionDays: '90',
  addressHashRetentionDays: '60',
  contactMessageRetentionDays: '365',
  webmentionsSend: '',
  webmentionsReceive: '',
  notifyServer: 'https://rpc.example/RPC2',
  feedUpdatePeriod: 'daily',
  feedUpdateFrequency: '2',
  aiCrawlers: 'block-all',
  contentSignalSearch: 'yes',
  contentSignalAiInput: 'no',
  contentSignalAiTrain: 'yes',
  robotsRules: 'User-agent: BadBot\nDisallow: /',
  llmsTxt: '',
  indexNow: '1',
  mailProvider: 'smtp',
  mailFromName: 'The Blog',
  mailFromAddress: 'blog@blog.example',
  mailReplyTo: 'hello@blog.example',
  contactEmail: 'me@blog.example',
  securityContacts: 'security@blog.example\nhttps://blog.example/security\ntel:+1-555-0100',
  securityPolicy: 'https://blog.example/policy',
  securityLanguages: 'en,fr',
  relays: 'https://relay.example/inbox',
  locationSharing: 'exact',
};

const CARRIED: Required<CarriedSettings> = {
  menus: { main: [{ label: 'Home', url: '/' }] },
  taxonomyRedirects: [{ taxonomy: 'tag', from: 'old', to: 'new' }],
  indexNowKey: 'abcdef0123456789',
  clientsWithoutPkce: ['https://app.example/'],
};

const FORM_CASES: Record<string, { form: SettingsForm; carried: CarriedSettings }> = {
  defaults: { form: DEFAULT_FORM, carried: {} },
  'every field': { form: EVERY_FIELD, carried: CARRIED },
  'a creative commons license, with stale custom fields': {
    form: {
      ...DEFAULT_FORM,
      license: ' cc-by ',
      licenseUrl: 'https://x.example/',
      licenseName: 'X',
    },
    carried: {},
  },
  'a posts page without a homepage': {
    form: { ...DEFAULT_FORM, homepage: ' ', postsPage: 'blog' },
    carried: {},
  },
  'choices nobody offered': {
    form: {
      ...DEFAULT_FORM,
      license: 'mine',
      feedUpdatePeriod: 'fortnightly',
      aiCrawlers: 'deny',
      contentSignalSearch: 'maybe',
      mailProvider: 'pigeon',
      locationSharing: 'everywhere',
      notifyServer: '',
      baseUrl: 'not a url',
    },
    carried: { indexNowKey: '' },
  },
};

const BAD_FORM: SettingsForm = {
  title: ' ',
  tagline: '',
  baseUrl: 'ftp://blog.example',
  timezone: 'Mars/Olympus',
  language: 'english',
  locale: 'nope!',
  postsPerPage: '0',
  homepage: 'a page',
  postsPage: 'blog',
  author: '',
  theme: '../elsewhere',
  icon: '/elsewhere/icon.png',
  license: 'mine',
  licenseUrl: '',
  licenseName: '',
  tagBase: 'same',
  categoryBase: 'same',
  comments: '',
  commentsCloseAfterDays: '',
  commentEmailRetentionDays: '-1',
  addressHashRetentionDays: 'x',
  contactMessageRetentionDays: '',
  webmentionsSend: '',
  webmentionsReceive: '',
  notifyServer: 'nope',
  feedUpdatePeriod: 'fortnightly',
  feedUpdateFrequency: '0',
  aiCrawlers: 'deny',
  contentSignalSearch: 'maybe',
  contentSignalAiInput: 'maybe',
  contentSignalAiTrain: 'maybe',
  robotsRules: 'Nonsense here',
  llmsTxt: '',
  indexNow: '',
  mailProvider: 'pigeon',
  mailFromName: '',
  mailFromAddress: 'nobody',
  mailReplyTo: 'nobody',
  contactEmail: 'nobody',
  securityContacts: 'nobody',
  securityPolicy: 'http://insecure.example/',
  securityLanguages: 'not a tag!',
  relays: 'ftp://relay.example/',
  locationSharing: 'everywhere',
};

/** An object in key order, for the objects whose key order nothing outside them can see. */
function sorted(object: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

function text(file: Record<string, unknown>): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** What a save of the unchanged settings leaves in the file, through the real write. */
async function rewritten(source: string): Promise<string> {
  const contentDir = await box.dir('geekity-settings-golden-');
  const file = siteDataPath(contentDir);
  await mkdir(path.dirname(file), { recursive: true });
  if (source !== '') await writeFile(file, source, 'utf8');
  await updateSiteSettings({ contentDir, change: (current) => current });
  return await readFile(file, 'utf8');
}

function parsed(source: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(source);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

describe('the settings, pinned', () => {
  it('read, show and write every representative file and form as before (AC #4)', async () => {
    const files: Record<string, unknown> = {};
    for (const [name, source] of Object.entries(SITE_JSON_CASES)) {
      const settings = settingsFromSiteJson(parsed(source));
      files[name] = {
        settings: sorted(settings),
        form: sorted(formFromSettings(settings)),
        rewritten: await rewritten(source),
      };
    }

    const forms: Record<string, unknown> = {};
    for (const [name, { form, carried }] of Object.entries(FORM_CASES)) {
      const settings = settingsFromForm(form, carried);
      forms[name] = {
        settings: sorted(settings),
        fresh: text(siteJsonFor(settings)),
        overEveryKey: text(siteJsonFor(settings, parsed(SITE_JSON_CASES['every key'] ?? ''))),
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

describe('every setting', () => {
  it('survives form to site.json to form (AC #2)', () => {
    assert.deepEqual(
      Object.keys(EVERY_FIELD).sort(),
      Object.keys(SETTINGS_FIELDS).sort(),
      'the form sets every field',
    );

    const saved = settingsFromForm(EVERY_FIELD, CARRIED);
    const file = parsed(text(siteJsonFor(saved)));
    const read = settingsFromSiteJson(file);

    assert.deepEqual(read, saved);
    for (const key of Object.keys(DEFAULT_SITE_SETTINGS) as (keyof SiteSettings)[]) {
      assert.notDeepEqual(read[key], DEFAULT_SITE_SETTINGS[key], `${key} carried a value`);
    }

    const shown = formFromSettings(read);
    assert.deepEqual(settingsFromForm(shown, CARRIED), read);
    assert.deepEqual(formFromSettings(settingsFromForm(shown, CARRIED)), shown);
  });
});
