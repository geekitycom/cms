import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { saveSettings, SETTINGS_PAGE_FORMS } from './__testing__/settings.ts';
import { readSiteSettings } from './settings.ts';

/**
 * The General settings page: what the site is called, where it lives, and its
 * picture.
 *
 * The avatar is here because it is the site's picture everywhere, and it is
 * its own pair of forms because a file cannot travel in the urlencoded body
 * the General form posts.
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
        author: 'Ada',
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
    assert.equal(field(html, 'author'), 'Ada');
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

  it('refuses an empty title', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const response = await saveSettings(agent, 'general', { title: '   ' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /The site needs a title/);
  });
});

describe('the site avatar', () => {
  it('is a placeholder until one is uploaded, then the stored image (AC #1, #2)', async () => {
    const contentDir = await box.dir('geekity-settings-avatar-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const before = await (await agent.get('/admin/settings')).text();
    assert.match(before, /admin-avatar-blank/, 'the screen shows a placeholder');
    assert.doesNotMatch(before, /<img[^>]+class="admin-avatar"/, 'and no image');

    const token = csrfField(before);
    assert.ok(token !== undefined, 'the avatar form carried a CSRF token');

    const uploaded = await agent.upload(
      '/admin/settings/avatar',
      token,
      { name: 'Me At The Beach.PNG', type: 'image/png', bytes: png() },
      'avatar',
    );
    assert.equal(uploaded.status, 303, await uploaded.text());
    assert.equal(uploaded.headers.get('location'), '/admin/settings');

    const stored = readSiteSettings(cms.config.contentDir).avatar;
    assert.match(
      stored,
      /^\/uploads\/\d{4}\/\d{2}\/me-at-the-beach\.png$/,
      'the setting holds the public URL',
    );

    const file = path.join(contentDir, 'uploads', ...stored.slice('/uploads/'.length).split('/'));
    assert.deepEqual(new Uint8Array(await readFile(file)), png(), 'the bytes are under content/');

    const served = await cms.app.request(stored);
    assert.equal(served.status, 200, 'and the site serves them at that URL');
    assert.equal(served.headers.get('content-type'), 'image/png');

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['avatar'], stored, 'site.json carries it');

    const after = await (await agent.get('/admin/settings')).text();
    assert.match(after, new RegExp(`<img[^>]+src="${stored}"`), 'and the screen shows it');
  });

  it('is taken down again by the Remove button (AC #1)', async () => {
    const contentDir = await box.dir('geekity-settings-avatar-remove-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const token = await avatarToken(agent);

    await agent.upload(
      '/admin/settings/avatar',
      token,
      { name: 'me.png', type: 'image/png', bytes: png() },
      'avatar',
    );
    const uploaded = readSiteSettings(cms.config.contentDir).avatar;
    assert.notEqual(uploaded, '');

    const html = await (await agent.get('/admin/settings')).text();
    assert.match(html, /value="remove"/, 'the screen offers a way to take it down');

    const removed = await agent.post('/admin/settings/avatar', {
      csrf_token: token,
      action: 'remove',
    });
    assert.equal(removed.status, 303);

    assert.equal(readSiteSettings(cms.config.contentDir).avatar, '', 'the setting is empty again');
    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['avatar'], '', 'and so is site.json');

    const screen = await (await agent.get('/admin/settings')).text();
    assert.match(screen, /admin-avatar-blank/, 'the placeholder is back');
    assert.doesNotMatch(screen, new RegExp(`src="${uploaded}"`));

    const file = path.join(contentDir, 'uploads', ...uploaded.slice('/uploads/'.length).split('/'));
    assert.deepEqual(
      new Uint8Array(await readFile(file)),
      png(),
      'the file itself stays, as an upload rather than an avatar',
    );
  });

  it('keeps the avatar it has when an upload is refused, and says why (AC #6)', async () => {
    const cms = await box.site({ uploadMaxBytes: 512 });
    const agent = await signedIn(cms);
    const token = await avatarToken(agent);

    await agent.upload(
      '/admin/settings/avatar',
      token,
      { name: 'good.png', type: 'image/png', bytes: png() },
      'avatar',
    );
    const kept = readSiteSettings(cms.config.contentDir).avatar;
    assert.notEqual(kept, '', 'there is an avatar to lose');

    const refusals: [string, { name: string; type: string; bytes: Uint8Array }, RegExp][] = [
      [
        'a file the site does not accept at all',
        { name: 'me.exe', type: 'application/octet-stream', bytes: png() },
        /Uploads of \.exe are not allowed/,
      ],
      [
        'a file that is not an image',
        { name: 'me.pdf', type: 'application/pdf', bytes: pdf() },
        /A \.pdf is not an image/,
      ],
      [
        'a file whose bytes are not what its name says',
        { name: 'me.png', type: 'image/png', bytes: pdf() },
        /does not look like a \.png inside/,
      ],
      [
        'a file over the site’s limit',
        { name: 'huge.png', type: 'image/png', bytes: oversizedPng(600) },
        /too big/,
      ],
    ];

    for (const [what, file, message] of refusals) {
      const response = await agent.upload('/admin/settings/avatar', token, file, 'avatar');
      assert.equal(response.status, 303, what);

      const html = await (await agent.get('/admin/settings')).text();
      assert.match(html, message, what);
      assert.match(html, /The avatar is unchanged/, what);
      assert.equal(readSiteSettings(cms.config.contentDir).avatar, kept, what);
      assert.match(html, new RegExp(`<img[^>]+src="${kept}"`), what);
    }
  });
});

/** The CSRF token off the General page, which both avatar forms carry. */
async function avatarToken(agent: Browser): Promise<string> {
  const token = csrfField(await (await agent.get('/admin/settings')).text());
  assert.ok(token !== undefined, 'the avatar form carried a CSRF token');
  return token;
}

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

/** The first bytes of a PNG, which is all the signature check reads. */
function png(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/** The first bytes of a PDF: an upload the site accepts and an avatar it does not. */
function pdf(): Uint8Array {
  return new Uint8Array([...'%PDF-'].map((character) => character.charCodeAt(0)));
}

/** A PNG of `bytes` bytes, for the size limit. */
function oversizedPng(bytes: number): Uint8Array {
  const image = new Uint8Array(bytes);
  image.set(png());
  return image;
}
