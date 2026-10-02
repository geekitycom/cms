import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { saveSettings, SETTINGS_PAGE_FORMS } from './__testing__/settings.ts';
import { createUser, setUserProfile } from './accounts.ts';
import { readSiteSettings } from './settings.ts';

/**
 * The General settings page: what the site is called and where it lives.
 *
 * There is no picture here any more. decision-14 made every user an actor with
 * an avatar of their own, so the picture the fediverse sees is a user's,
 * edited beside the rest of their profile on the users screen.
 */

const box = sandbox();
after(() => box.cleanup());

/** The value of a form field in the rendered page. */
function field(html: string, name: string): string | undefined {
  const match = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return match?.[1];
}

describe('the General settings page', () => {
  it('shows what content/_data/site.json says (AC #2)', async () => {
    const contentDir = await box.dir('geekity-settings-content-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({
        title: 'Seeded Site',
        tagline: 'from the file',
        url: 'https://seeded.example',
        language: 'fr',
      }),
      'utf8',
    );

    const cms = await box.site({ contentDir });
    const agent: Browser = await signedIn(cms);

    const html = await (await agent.get('/admin/settings')).text();

    assert.equal(field(html, 'title'), 'Seeded Site');
    assert.equal(field(html, 'tagline'), 'from the file');
    assert.equal(field(html, 'base_url'), 'https://seeded.example');
    assert.equal(field(html, 'language'), 'fr');
    assert.ok(csrfField(html) !== undefined, 'the form carries a CSRF token');
  });
});

describe('saving the General page', () => {
  it('changes the site title the public site shows (AC #1)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const before = await (await cms.app.request('/')).text();
    assert.match(before, /Geekity/, 'the site starts on the default title');

    const saved = await saveSettings(agent, 'general', { title: 'A Renamed Site' });
    assert.equal(saved.status, 303, 'a good save redirects');
    assert.equal(saved.headers.get('location'), '/admin/settings');

    const after = await (await cms.app.request('/')).text();
    assert.match(after, /A Renamed Site/, 'the public home page shows the new title');
    assert.doesNotMatch(after, /Geekity<\/a>/, 'and not the old one');

    assert.match(
      await (await cms.app.request('/feed/atom/')).text(),
      /<title>A Renamed Site<\/title>/,
      'and so does the Atom feed',
    );
    const json = (await (await cms.app.request('/feed/json/')).json()) as Record<string, unknown>;
    assert.equal(json['title'], 'A Renamed Site');
  });
});

describe('a General form the validator refuses', () => {
  it('rejects a base URL that is not an absolute http(s) URL (AC #4)', async () => {
    const contentDir = await box.dir('geekity-settings-bad-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await saveSettings(agent, 'general', { title: 'Before' });

    for (const bad of ['example.com', '/relative', 'ftp://example.com', 'not a url', '']) {
      const response = await saveSettings(agent, 'general', { title: 'After', base_url: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));

      const html = await response.text();
      assert.match(html, /absolute http:\/\/ or https:\/\/ URL/, JSON.stringify(bad));
      assert.equal(field(html, 'base_url'), bad, 'the form comes back with what was typed');
    }

    const stored = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(stored['title'], 'Before', 'nothing was written');
    assert.match(
      await (await agent.get('/admin/settings')).text(),
      /value="Before"/,
      'and the stored settings are untouched',
    );
  });

  it('refuses a time zone Intl does not know', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const response = await saveSettings(agent, 'general', { timezone: 'Mars/Olympus_Mons' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /IANA time zone name/);

    assert.equal((await saveSettings(agent, 'general', { timezone: 'Europe/London' })).status, 303);
  });

  it('carries the language into the page, both feeds and site.json', async () => {
    const contentDir = await box.dir('geekity-settings-language-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    assert.equal((await saveSettings(agent, 'general', { language: 'pt-BR' })).status, 303);

    assert.match(await (await cms.app.request('/')).text(), /<html lang="pt-BR">/);
    assert.match(
      await (await cms.app.request('/feed/')).text(),
      /<language>pt-BR<\/language>/,
      'the RSS channel declares it',
    );
    assert.match(
      await (await cms.app.request('/feed/atom/')).text(),
      /xml:lang="pt-BR"/,
      'and the Atom feed does too',
    );

    const file = path.join(contentDir, '_data', 'site.json');
    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(written['language'], 'pt-BR');
  });

  it('refuses a language that is not a well-formed tag, and keeps the stored one', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    assert.equal((await saveSettings(agent, 'general', { language: 'en-GB' })).status, 303);

    for (const bad of ['', 'english language', 'e', 'en_GB', 'en-']) {
      const response = await saveSettings(agent, 'general', { language: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /not a language tag/, JSON.stringify(bad));
    }

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(field(html, 'language'), 'en-GB', 'the refused saves changed nothing');
  });

  it('writes the public site’s dates in the locale, the language when it is empty', async () => {
    const contentDir = await box.dir('geekity-settings-locale-');
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'posts', '2026-09-02-hello.md'),
      "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\n---\n\nBody.\n",
      'utf8',
    );
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const file = path.join(contentDir, '_data', 'site.json');
    const stored = async () => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

    assert.equal((await saveSettings(agent, 'general', { language: 'fr' })).status, 303);
    assert.match(await (await cms.app.request('/')).text(), />2 septembre 2026</);
    assert.equal('locale' in (await stored()), false, 'an empty locale writes no key');

    const saved = await saveSettings(agent, 'general', { language: 'en', locale: 'en-US' });
    assert.equal(saved.status, 303);
    const home = await (await cms.app.request('/')).text();
    assert.match(home, />September 2, 2026</);
    assert.match(home, /<html lang="en">/, 'the locale leaves the page language alone');
    assert.equal((await stored())['locale'], 'en-US');
    assert.equal(field(await (await agent.get('/admin/settings')).text(), 'locale'), 'en-US');
  });

  it('refuses a locale Intl does not know', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const bad of ['english', 'en_US', 'en-']) {
      const response = await saveSettings(agent, 'general', { locale: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /not a locale/, JSON.stringify(bad));
    }
  });

  it('refuses an empty title', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const response = await saveSettings(agent, 'general', { title: '   ' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /The site needs a title/);
  });
});

describe('the base URL', () => {
  it('is taken from the settings when the deployment names none', async () => {
    const dataDir = await box.dir('geekity-settings-base-url-data-');
    const contentDir = await box.dir('geekity-settings-base-url-');

    const first = await box.site({ contentDir, dataDir });
    const agent = await signedIn(first);
    await saveSettings(agent, 'general', { base_url: 'https://stored.example' });
    await first.close();

    const second = await box.site({ contentDir, dataDir });
    assert.equal(second.config.baseUrl, 'https://stored.example');
    assert.match(
      await (await second.app.request('/feed/atom/')).text(),
      /https:\/\/stored\.example/,
      'the feed is built on it',
    );
  });

  it('is the configured one when there is one, and the field says why', async () => {
    const dataDir = await box.dir('geekity-settings-base-url-fixed-data-');
    const contentDir = await box.dir('geekity-settings-base-url-fixed-');

    const cms = await box.site({ contentDir, dataDir, baseUrl: 'https://deployed.example' });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings')).text();
    assert.match(html, /The config file sets baseUrl/);
    assert.match(html, /<code>https:\/\/deployed\.example<\/code>/);
    assert.match(html, /name="base_url"[^>]*disabled/, 'and the field is not editable');

    // The browser sends nothing for a disabled field; the save keeps the
    // stored value rather than clearing it.
    const token = csrfField(html);
    assert.ok(token !== undefined);
    const saved = await agent.post('/admin/settings', {
      csrf_token: token,
      ...SETTINGS_PAGE_FORMS.general,
      base_url: '',
      title: 'Still saved',
    });
    assert.equal(saved.status, 303);
    assert.equal(readSiteSettings(cms.config.contentDir).baseUrl, 'https://deployed.example');
    assert.equal(cms.config.baseUrl, 'https://deployed.example');
  });
});

/** The Site author select: each option's value and label, and which is selected. */
function authorOptions(html: string): { value: string; label: string; selected: boolean }[] {
  const select = /<select id="settings-author" name="author"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(select !== null, 'General has a Site author select');
  return [
    ...(select[1] ?? '').matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g),
  ].map((option) => ({
    value: option[1] ?? '',
    label: option[3] ?? '',
    selected: option[2] !== undefined,
  }));
}

/** What `site.json` holds now. */
async function siteJson(contentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** A site with ada signed in and a second user, Grace, who has a display name. */
async function twoUsers(siteJsonFields: Record<string, unknown> = {}) {
  const contentDir = await box.dir('geekity-settings-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', ...siteJsonFields }),
    'utf8',
  );
  const cms = await box.site({ contentDir });
  const agent = await signedIn(cms);
  const grace = await createUser({
    dataDir: cms.config.dataDir,
    username: 'grace',
    password: 'correct horse battery',
  });
  await setUserProfile({
    dataDir: cms.config.dataDir,
    userId: grace.id,
    profile: { displayName: 'Grace Hopper' },
  });
  return { contentDir, agent };
}

describe('the Site author select (TASK-192)', () => {
  it('lists each user by display name and Several authors, and nothing else (AC #1)', async () => {
    const { agent } = await twoUsers();
    const html = await (await agent.get('/admin/settings')).text();

    assert.deepEqual(authorOptions(html), [
      { value: '', label: 'Several authors', selected: true },
      { value: 'ada', label: 'ada', selected: false },
      { value: 'grace', label: 'Grace Hopper', selected: false },
    ]);
    assert.doesNotMatch(html, /name="solo_author"/, 'no Solo author checkbox');
    assert.doesNotMatch(html, /<input[^>]*name="author"/, 'no free-text author field');
  });

  it('stores the username and no soloAuthor key (AC #3)', async () => {
    const { contentDir, agent } = await twoUsers({ soloAuthor: true });

    assert.equal((await saveSettings(agent, 'general', { author: 'grace' })).status, 303);
    const file = await siteJson(contentDir);
    assert.equal(file['author'], 'grace');
    assert.equal('soloAuthor' in file, false, 'the old switch is dropped');

    const back = authorOptions(await (await agent.get('/admin/settings')).text());
    assert.deepEqual(
      back.filter((option) => option.selected).map((option) => option.value),
      ['grace'],
    );
  });

  it('stores no author for Several authors (AC #3)', async () => {
    const { contentDir, agent } = await twoUsers({ author: 'grace' });

    assert.equal((await saveSettings(agent, 'general', { author: '' })).status, 303);
    assert.equal('author' in (await siteJson(contentDir)), false);
  });

  it('stores no author for a username that is nobody', async () => {
    const { contentDir, agent } = await twoUsers();

    assert.equal((await saveSettings(agent, 'general', { author: 'mallory' })).status, 303);
    assert.equal('author' in (await siteJson(contentDir)), false);
  });

  it('shows a stored display name as that user, and the first save writes the username (AC #5)', async () => {
    const { contentDir, agent } = await twoUsers({ author: 'Grace Hopper', soloAuthor: false });

    const shown = authorOptions(await (await agent.get('/admin/settings')).text());
    assert.deepEqual(
      shown.filter((option) => option.selected).map((option) => option.value),
      ['grace'],
    );

    assert.equal((await saveSettings(agent, 'general', { author: 'grace' })).status, 303);
    assert.equal((await siteJson(contentDir))['author'], 'grace');
  });

  it('shows a stored name that matches nobody as Several authors (AC #5)', async () => {
    const { agent } = await twoUsers({ author: 'Joe Blog' });

    const shown = authorOptions(await (await agent.get('/admin/settings')).text());
    assert.deepEqual(
      shown.filter((option) => option.selected).map((option) => option.value),
      [''],
    );
  });
});

const ICON = '/uploads/2026/10/icon.png';

/** A site whose `site.json` says `fields`, with a 600 pixel PNG at {@link ICON}. */
async function siteWithIconUpload(fields: Record<string, unknown> = {}) {
  const contentDir = await box.dir('geekity-settings-icon-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'uploads', '2026', '10'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', ...fields }),
    'utf8',
  );
  await writeFile(
    path.join(contentDir, 'uploads', '2026', '10', 'icon.png'),
    await sharp({
      create: { width: 600, height: 600, channels: 3, background: { r: 179, g: 57, b: 0 } },
    })
      .png()
      .toBuffer(),
  );
  await writeFile(path.join(contentDir, 'uploads', '2026', '10', 'notes.pdf'), '%PDF-1.4\n');
  const cms = await box.site({ contentDir });
  const agent = await signedIn(cms);
  return { cms, contentDir, agent };
}

describe('the Site icon field (TASK-212)', () => {
  it('saves an upload path to site.json icon, and clearing it removes the key (AC #1)', async () => {
    const { contentDir, agent } = await siteWithIconUpload();

    assert.equal((await saveSettings(agent, 'general', { icon: ` ${ICON} ` })).status, 303);
    assert.equal((await siteJson(contentDir))['icon'], ICON);
    assert.equal(field(await (await agent.get('/admin/settings')).text(), 'icon'), ICON);

    assert.equal((await saveSettings(agent, 'general', { icon: '' })).status, 303);
    assert.equal('icon' in (await siteJson(contentDir)), false, 'an empty field writes no key');
  });

  it('previews the current icon and says it should be square and 512 pixels (AC #2)', async () => {
    const { agent } = await siteWithIconUpload({ icon: ICON });
    const html = await (await agent.get('/admin/settings')).text();

    assert.match(
      html,
      /<img[^>]*src="\/uploads\/_\/2026\/10\/icon\.png\/icon-180\.png\?v=[^"]+"/,
      'the preview is the icon the site derives',
    );
    assert.match(html, /square/i);
    assert.match(html, /at least 512 pixels/);
  });

  it('says there is no icon yet when none is set (AC #2)', async () => {
    const { agent } = await siteWithIconUpload();
    const html = await (await agent.get('/admin/settings')).text();
    assert.doesNotMatch(html, /icon-180\.png/);
    assert.match(html, /no icon/i);
  });

  it('refuses a path it cannot derive icons from, says why, and saves nothing (AC #3)', async () => {
    const { contentDir, agent } = await siteWithIconUpload({ icon: ICON });

    const refusals: [string, RegExp][] = [
      ['https://example.com/icon.png', /media library/],
      ['icon.png', /media library/],
      ['/uploads/../secrets.png', /media library/],
      ['/uploads/2026/10/notes.pdf', /has to be an image/],
      ['/uploads/2026/10/missing.png', /no upload at/],
    ];
    for (const [bad, message] of refusals) {
      const response = await saveSettings(agent, 'general', { title: 'After', icon: bad });
      assert.equal(response.status, 400, bad);
      const html = await response.text();
      assert.match(html, message, bad);
      assert.equal(field(html, 'icon'), bad, 'the form comes back with what was typed');
    }

    const stored = await siteJson(contentDir);
    assert.equal(stored['icon'], ICON, 'the icon is untouched');
    assert.equal(stored['title'], 'A Site', 'and so is everything else');
  });

  it('gives the public site its icons once one is saved (AC #4)', async () => {
    const { cms, agent } = await siteWithIconUpload();
    assert.equal((await cms.app.request('/favicon.ico')).status, 404, 'no icon to begin with');

    assert.equal((await saveSettings(agent, 'general', { icon: ICON })).status, 303);

    const home = await (await cms.app.request('/')).text();
    assert.match(
      home,
      /<link rel="icon"[^>]*href="\/uploads\/_\/2026\/10\/icon\.png\/icon-32\.png/,
    );
    assert.match(
      home,
      /<link rel="apple-touch-icon"[^>]*href="\/uploads\/_\/2026\/10\/icon\.png\/icon-180\.png/,
    );
    const favicon = await cms.app.request('/favicon.ico');
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get('content-type'), 'image/x-icon');

    const manifest = (await (await cms.app.request('/manifest.webmanifest')).json()) as {
      icons: { src: string }[];
    };
    assert.ok(
      manifest.icons.some((icon) => icon.src.includes('/2026/10/icon.png/icon-512.png')),
      'the manifest lists the icon',
    );
    assert.match(
      await (await cms.app.request('/opensearch.xml')).text(),
      /<Image [^>]*>[^<]*\/favicon\.ico<\/Image>/,
    );
  });

  it('shows and keeps a stored icon (AC #5)', async () => {
    const { contentDir, agent } = await siteWithIconUpload({ icon: ICON });
    const shown = field(await (await agent.get('/admin/settings')).text(), 'icon');
    assert.equal(shown, ICON);

    assert.equal((await saveSettings(agent, 'general', { icon: shown ?? '' })).status, 303);
    assert.equal((await siteJson(contentDir))['icon'], ICON);
  });

  it('shows a hand-set avatar as the icon, and a save keeps it as the icon (AC #5)', async () => {
    const { contentDir, agent } = await siteWithIconUpload({ avatar: ICON });
    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(field(html, 'icon'), ICON);
    assert.match(html, /icon-180\.png/, 'the preview is the avatar it falls back to');

    assert.equal((await saveSettings(agent, 'general', { icon: ICON })).status, 303);
    const stored = await siteJson(contentDir);
    assert.equal(stored['icon'], ICON);
    assert.equal(stored['avatar'], ICON, 'the avatar is left for what else reads it');
  });

  it('is left alone by a save of another settings page (AC #5)', async () => {
    const { contentDir, agent } = await siteWithIconUpload({ avatar: ICON });
    assert.equal((await saveSettings(agent, 'reading', {})).status, 303);
    const stored = await siteJson(contentDir);
    assert.equal('icon' in stored, false);
    assert.equal(stored['avatar'], ICON);
  });
});

/** The License select: each option's value and label, and which is selected. */
function licenseOptions(html: string): { value: string; label: string; selected: boolean }[] {
  const select = /<select id="settings-license" name="license"[^>]*>([\s\S]*?)<\/select>/.exec(
    html,
  );
  assert.ok(select !== null, 'General has a License select');
  return [
    ...(select[1] ?? '').matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g),
  ].map((option) => ({
    value: option[1] ?? '',
    label: option[3] ?? '',
    selected: option[2] !== undefined,
  }));
}

/** A signed-in site whose `site.json` says `fields`. */
async function siteWith(fields: Record<string, unknown> = {}) {
  const contentDir = await box.dir('geekity-settings-license-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', ...fields }),
    'utf8',
  );
  const cms = await box.site({ contentDir });
  return { cms, contentDir, agent: await signedIn(cms) };
}

describe('the License field (TASK-206)', () => {
  it('offers no license, the seven Creative Commons licenses and a custom one (AC #1)', async () => {
    const { agent } = await siteWith();
    const html = await (await agent.get('/admin/settings')).text();
    const options = licenseOptions(html);

    assert.deepEqual(
      options.map((option) => option.value),
      [
        '',
        'cc-by',
        'cc-by-sa',
        'cc-by-nc',
        'cc-by-nc-sa',
        'cc-by-nd',
        'cc-by-nc-nd',
        'cc0',
        'custom',
      ],
    );
    assert.equal(options.find((option) => option.selected)?.value, '', 'none by default');
    assert.match(options[0]?.label ?? '', /all rights reserved/i);
    assert.match(options[2]?.label ?? '', /CC BY-SA 4\.0/);
    assert.ok(field(html, 'license_url') !== undefined, 'a box for the custom URL');
    assert.ok(field(html, 'license_name') !== undefined, 'and one for its name');
    assert.ok(
      html.indexOf('name="license"') > html.indexOf('name="icon"'),
      'the license comes after the site icon',
    );
  });

  it('saves a Creative Commons key to site.json license (AC #1)', async () => {
    const { contentDir, agent } = await siteWith();

    const saved = await saveSettings(agent, 'general', {
      license: 'cc-by-sa',
      license_url: 'https://ignored.example/',
      license_name: 'Ignored',
    });
    assert.equal(saved.status, 303);
    const stored = await siteJson(contentDir);
    assert.equal(stored['license'], 'cc-by-sa');
    assert.equal('licenseName' in stored, false, 'a known license carries its own name');

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(licenseOptions(html).find((option) => option.selected)?.value, 'cc-by-sa');
  });

  it('saves a custom license as its URL and name, and shows it back (AC #1)', async () => {
    const { contentDir, agent } = await siteWith();

    const saved = await saveSettings(agent, 'general', {
      license: 'custom',
      license_url: ' https://example.com/terms ',
      license_name: ' House terms ',
    });
    assert.equal(saved.status, 303);
    const stored = await siteJson(contentDir);
    assert.equal(stored['license'], 'https://example.com/terms');
    assert.equal(stored['licenseName'], 'House terms');

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(licenseOptions(html).find((option) => option.selected)?.value, 'custom');
    assert.equal(field(html, 'license_url'), 'https://example.com/terms');
    assert.equal(field(html, 'license_name'), 'House terms');
  });

  it('removes both keys when no license is chosen again (AC #1, AC #5)', async () => {
    const { contentDir, agent } = await siteWith({
      license: 'https://example.com/terms',
      licenseName: 'House terms',
    });

    assert.equal((await saveSettings(agent, 'general', { license: '' })).status, 303);
    const stored = await siteJson(contentDir);
    assert.equal('license' in stored, false);
    assert.equal('licenseName' in stored, false);
  });

  it('refuses a custom license without a web URL or a name, and saves nothing (AC #1)', async () => {
    const { contentDir, agent } = await siteWith({ license: 'cc-by' });

    const refusals: [Record<string, string>, string, RegExp][] = [
      [{ license_url: '', license_name: 'Terms' }, 'license_url', /URL/],
      [{ license_url: 'example.com/terms', license_name: 'Terms' }, 'license_url', /URL/],
      [{ license_url: 'javascript:alert(1)', license_name: 'Terms' }, 'license_url', /URL/],
      [{ license_url: 'https://example.com/terms', license_name: ' ' }, 'license_name', /name/],
    ];
    for (const [form, name, message] of refusals) {
      const response = await saveSettings(agent, 'general', { license: 'custom', ...form });
      assert.equal(response.status, 400, JSON.stringify(form));
      const html = await response.text();
      assert.match(html, message);
      assert.match(html, new RegExp(`name="${name}"[^>]*aria-invalid="true"`));
    }

    const unknown = await saveSettings(agent, 'general', { license: 'cc-by-9' });
    assert.equal(unknown.status, 400);

    assert.equal((await siteJson(contentDir))['license'], 'cc-by', 'the license is untouched');
  });

  it('reads a hand-written key in any case, and leaves a license alone on another page’s save', async () => {
    const { contentDir, agent } = await siteWith({ license: 'CC0' });
    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(licenseOptions(html).find((option) => option.selected)?.value, 'cc0');

    assert.equal((await saveSettings(agent, 'reading', {})).status, 303);
    assert.equal(
      (await siteJson(contentDir))['license'],
      'cc0',
      'kept, in the form the file reads',
    );
  });
});
