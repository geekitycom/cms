import assert from 'node:assert/strict';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { readSiteSettings } from './settings.ts';

const box = sandbox();
after(() => box.cleanup());

/** The value of a form field in the rendered settings screen. */
function field(html: string, name: string): string | undefined {
  const match = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return match?.[1];
}

/** The fields the settings form submits, with sane values for the ones a test does not name. */
const DEFAULT_FORM: Record<string, string> = {
  title: 'A Site',
  tagline: 'A tagline',
  base_url: 'http://localhost:3000',
  timezone: 'UTC',
  language: 'en',
  posts_per_page: '10',
  author: 'Somebody',
  actor_handle: 'blog',
  actor_type: 'Person',
  tag_base: 'tag',
  category_base: 'category',
  notify_server: 'https://rpc.rsscloud.io',
};

/** Submit the settings form, filling in whatever the caller did not name. */
async function saveSettings(
  agent: Browser,
  fields: Record<string, string> = {},
): Promise<Response> {
  const html = await (await agent.get('/admin/settings')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the settings form carried a CSRF token');

  return agent.post('/admin/settings', { csrf_token: token, ...DEFAULT_FORM, ...fields });
}

describe('the settings screen', () => {
  it('shows the site data the settings were seeded from', async () => {
    const contentDir = await box.dir('geekity-settings-content-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({
        title: 'Seeded Site',
        tagline: 'from the file',
        url: 'https://seeded.example',
        author: 'Ada',
        postsPerPage: 4,
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
    assert.equal(field(html, 'posts_per_page'), '4');
    assert.equal(field(html, 'language'), 'fr');
    assert.ok(csrfField(html) !== undefined, 'the form carries a CSRF token');
  });
});

describe('saving settings', () => {
  it('changes the site title the public site shows (AC #1)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const before = await (await cms.app.request('/')).text();
    assert.match(before, /Geekity/, 'the site starts on the default title');

    const saved = await saveSettings(agent, { title: 'A Renamed Site' });
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

describe('content/_data/site.json', () => {
  it('is rewritten on save with title, tagline, url and author (AC #2)', async () => {
    const contentDir = await box.dir('geekity-settings-mirror-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await saveSettings(agent, {
      title: 'Mirrored',
      tagline: 'and mirrored again',
      base_url: 'https://mirror.example',
      author: 'Grace',
      posts_per_page: '7',
      timezone: 'Europe/London',
    });

    const file = path.join(contentDir, '_data', 'site.json');
    const written: unknown = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(written, {
      title: 'Mirrored',
      tagline: 'and mirrored again',
      url: 'https://mirror.example',
      author: 'Grace',
      postsPerPage: 7,
      timezone: 'Europe/London',
      language: 'en',
      avatar: '',
      tagBase: 'tag',
      categoryBase: 'category',
      notifyServer: 'https://rpc.rsscloud.io',
    });
  });

  it('keeps the keys the settings form does not manage', async () => {
    const contentDir = await box.dir('geekity-settings-roundtrip-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'Old', feedSize: 42, anything: { at: 'all' } }),
      'utf8',
    );

    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await saveSettings(agent, { title: 'New' });

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;

    assert.equal(written['title'], 'New');
    assert.equal(written['feedSize'], 42);
    assert.deepEqual(written['anything'], { at: 'all' });
  });
});

/** A content directory holding `count` published posts, newest first. */
async function withPosts(count: number): Promise<string> {
  const contentDir = await box.dir('geekity-settings-posts-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });

  for (let index = 1; index <= count; index += 1) {
    const day = String(index).padStart(2, '0');
    await writeFile(
      path.join(contentDir, 'posts', `2026-01-${day}-post-${String(index)}.md`),
      `---\ntitle: Post ${String(index)}\ndate: 2026-01-${day}T09:00:00Z\npermalink: /2026/01/post-${String(index)}/\n---\n\nBody.\n`,
      'utf8',
    );
  }

  return contentDir;
}

describe('posts per page', () => {
  it('decides how the home page paginates (AC #3)', async () => {
    const cms = await box.site({ contentDir: await withPosts(4) });
    const agent = await signedIn(cms);

    assert.equal(
      (await cms.app.request('/page/2/')).status,
      404,
      'four posts fit on one page at the default of ten',
    );

    await saveSettings(agent, { posts_per_page: '2' });

    const second = await cms.app.request('/page/2/');
    assert.equal(second.status, 200, 'two per page makes a second page');

    const html = await second.text();
    assert.match(html, /Post 2/, 'the second page holds the older half');
    assert.doesNotMatch(html, /Post 4/, 'and not the newer half');

    const first = await (await cms.app.request('/')).text();
    assert.match(first, /Post 4/);
    assert.doesNotMatch(first, /Post 2<\/a>/);
  });
});

describe('a form the validator refuses', () => {
  it('rejects a base URL that is not an absolute http(s) URL (AC #4)', async () => {
    const contentDir = await box.dir('geekity-settings-bad-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await saveSettings(agent, { title: 'Before' });

    for (const bad of ['example.com', '/relative', 'ftp://example.com', 'not a url', '']) {
      const response = await saveSettings(agent, { title: 'After', base_url: bad });
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

  it('refuses a posts per page that is not a positive whole number', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const bad of ['0', '-3', '2.5', 'ten', '']) {
      const response = await saveSettings(agent, { posts_per_page: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /whole number of one or more/, JSON.stringify(bad));
    }
  });

  it('refuses a time zone Intl does not know', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const response = await saveSettings(agent, { timezone: 'Mars/Olympus_Mons' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /IANA time zone name/);

    assert.equal((await saveSettings(agent, { timezone: 'Europe/London' })).status, 303);
  });

  it('carries the language into the page, both feeds and the site.json mirror', async () => {
    const contentDir = await box.dir('geekity-settings-language-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    assert.equal((await saveSettings(agent, { language: 'pt-BR' })).status, 303);

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

    assert.equal((await saveSettings(agent, { language: 'en-GB' })).status, 303);

    for (const bad of ['', 'english language', 'e', 'en_GB', 'en-']) {
      const response = await saveSettings(agent, { language: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /not a language tag/, JSON.stringify(bad));
    }

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(field(html, 'language'), 'en-GB', 'the refused saves changed nothing');
  });

  it('refuses an actor handle that is not username-like, and an unknown actor type', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const bad of ['@blog', 'my blog', 'blog@example.com', '']) {
      const response = await saveSettings(agent, { actor_handle: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /An actor handle is 1 to 64/, JSON.stringify(bad));
    }

    const response = await saveSettings(agent, { actor_type: 'Sasquatch' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /An actor type is one of Person/);
  });

  it('refuses an empty title', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const response = await saveSettings(agent, { title: '   ' });
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

    const stored = readSiteSettings(cms.admin).avatar;
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

    const mirror = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(mirror['avatar'], stored, 'site.json mirrors it');

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
    const uploaded = readSiteSettings(cms.admin).avatar;
    assert.notEqual(uploaded, '');

    const html = await (await agent.get('/admin/settings')).text();
    assert.match(html, /value="remove"/, 'the screen offers a way to take it down');

    const removed = await agent.post('/admin/settings/avatar', {
      csrf_token: token,
      action: 'remove',
    });
    assert.equal(removed.status, 303);

    assert.equal(readSiteSettings(cms.admin).avatar, '', 'the setting is empty again');
    const mirror = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(mirror['avatar'], '', 'and so is the mirror');

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
    const kept = readSiteSettings(cms.admin).avatar;
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
      assert.equal(readSiteSettings(cms.admin).avatar, kept, what);
      assert.match(html, new RegExp(`<img[^>]+src="${kept}"`), what);
    }
  });
});

/** The CSRF token off the settings screen, which both avatar forms carry. */
async function avatarToken(agent: Browser): Promise<string> {
  const token = csrfField(await (await agent.get('/admin/settings')).text());
  assert.ok(token !== undefined, 'the avatar form carried a CSRF token');
  return token;
}

describe('where the values come from', () => {
  it('makes SQLite the source once the settings are stored, not the file', async () => {
    const contentDir = await box.dir('geekity-settings-source-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await saveSettings(agent, { title: 'From the settings' });

    // A hand edit of the mirror, with a modification time the file source
    // cannot miss. The settings are the source of truth, so it is ignored.
    const file = path.join(contentDir, '_data', 'site.json');
    await writeFile(file, JSON.stringify({ title: 'From the file', feedSize: 3 }), 'utf8');
    await utimes(file, new Date(), new Date(Date.now() + 1000));

    const html = await (await cms.app.request('/')).text();
    assert.match(html, /From the settings/);
    assert.doesNotMatch(html, /From the file/);
  });

  it('seeds from the file once, and never again', async () => {
    const contentDir = await box.dir('geekity-settings-seed-once-');
    const dataDir = await box.dir('geekity-settings-seed-once-data-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    const file = path.join(contentDir, '_data', 'site.json');
    await writeFile(file, JSON.stringify({ title: 'First boot' }), 'utf8');

    const first = await box.site({ contentDir, dataDir });
    assert.equal(readSiteSettings(first.admin).title, 'First boot');
    await first.close();

    await writeFile(file, JSON.stringify({ title: 'Edited behind the CMS' }), 'utf8');
    const second = await box.site({ contentDir, dataDir });
    assert.equal(
      readSiteSettings(second.admin).title,
      'First boot',
      'the second boot found settings and left them alone',
    );
  });
});

describe('the base URL', () => {
  it('is taken from the settings when the deployment names none', async () => {
    const dataDir = await box.dir('geekity-settings-base-url-data-');
    const contentDir = await box.dir('geekity-settings-base-url-');

    const first = await box.site({ contentDir, dataDir });
    const agent = await signedIn(first);
    await saveSettings(agent, { base_url: 'https://stored.example' });
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
      ...DEFAULT_FORM,
      base_url: '',
      title: 'Still saved',
    });
    assert.equal(saved.status, 303);
    assert.equal(readSiteSettings(cms.admin).baseUrl, 'https://deployed.example');
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

describe('the taxonomy bases', () => {
  it("default to WordPress's tag and category (AC #1, AC #3)", async () => {
    const cms = await box.site();
    const settings = readSiteSettings(cms.admin);

    assert.equal(settings.tagBase, 'tag');
    assert.equal(settings.categoryBase, 'category');
  });

  it('are seeded from an existing site.json, and defaulted when it has none (AC #3)', async () => {
    const contentDir = await box.dir('geekity-bases-seed-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'Old Site', tagBase: 'topics' }),
      'utf8',
    );

    const cms = await box.site({ contentDir });
    const settings = readSiteSettings(cms.admin);

    assert.equal(settings.tagBase, 'topics');
    assert.equal(settings.categoryBase, 'category', 'a key the old file lacks gets the default');
  });

  it('move the archives and are mirrored to site.json when saved (AC #2, AC #3)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    await mkdir(path.join(cms.config.contentDir, 'posts'), { recursive: true });
    await writeFile(
      path.join(cms.config.contentDir, 'posts', 'hello.md'),
      "---\ntitle: Hello\ndate: '2026-09-01T09:00:00Z'\npermalink: /hello/\ntags:\n  - notes\ncategories:\n  - general\n---\n\nBody.\n",
      'utf8',
    );
    await cms.sync();

    assert.equal((await cms.app.request('/tag/notes/')).status, 200, 'the default base serves it');

    const saved = await saveSettings(agent, { tag_base: 'topics', category_base: 'filed' });
    assert.equal(saved.status, 303);

    assert.equal((await cms.app.request('/topics/notes/')).status, 200);
    assert.equal((await cms.app.request('/filed/general/')).status, 200);
    assert.equal((await cms.app.request('/tag/notes/')).status, 404);

    const mirror: unknown = JSON.parse(
      await readFile(path.join(cms.config.contentDir, '_data', 'site.json'), 'utf8'),
    );
    assert.deepEqual(
      {
        tagBase: (mirror as Record<string, unknown>)['tagBase'],
        categoryBase: (mirror as Record<string, unknown>)['categoryBase'],
      },
      { tagBase: 'topics', categoryBase: 'filed' },
    );
  });

  it('refuse a base that is empty, holds a slash, is reserved or is the other one (AC #4)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const fields of [
      { tag_base: '' },
      { tag_base: 'a/b' },
      { tag_base: 'admin' },
      { tag_base: 'page' },
      { tag_base: 'feed' },
      { tag_base: 'same', category_base: 'same' },
    ]) {
      const response = await saveSettings(agent, fields);
      assert.equal(response.status, 400, `${JSON.stringify(fields)} should be refused`);

      const settings = readSiteSettings(cms.admin);
      assert.equal(settings.tagBase, 'tag', 'the stored tag base is unchanged');
      assert.equal(settings.categoryBase, 'category', 'and so is the category base');
    }
  });
});

describe('the notify server setting', () => {
  it('starts on rpc.rsscloud.io, shows on the form and reaches the mirror', async () => {
    const contentDir = await box.dir('geekity-settings-notify-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(field(html, 'notify_server'), 'https://rpc.rsscloud.io');

    assert.equal(
      (await saveSettings(agent, { notify_server: 'https://cloud.example/' })).status,
      303,
    );
    assert.equal(readSiteSettings(cms.admin).notifyServer, 'https://cloud.example');

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['notifyServer'], 'https://cloud.example');
  });

  it('takes an empty value, which is how the feature is turned off', async () => {
    const contentDir = await box.dir('geekity-settings-notify-off-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    assert.equal((await saveSettings(agent, { notify_server: '' })).status, 303);
    assert.equal(readSiteSettings(cms.admin).notifyServer, '');

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['notifyServer'], '', 'the mirror says so rather than saying nothing');

    // An emptied setting seeds as empty on the next boot, rather than being
    // filled back in from the default.
    const again = await box.site({
      contentDir,
      dataDir: await box.dir('geekity-settings-notify-boot-'),
    });
    assert.equal(readSiteSettings(again.admin).notifyServer, '');
  });

  it('refuses anything that is not an absolute URL, and keeps the stored one', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    assert.equal(
      (await saveSettings(agent, { notify_server: 'https://kept.example' })).status,
      303,
    );

    for (const bad of ['rpc.rsscloud.io', 'ftp://cloud.example', '/pleaseNotify']) {
      const response = await saveSettings(agent, { notify_server: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(
        await response.text(),
        /absolute http:\/\/ or https:\/\/ URL/,
        JSON.stringify(bad),
      );
    }

    assert.equal(readSiteSettings(cms.admin).notifyServer, 'https://kept.example');
  });
});
