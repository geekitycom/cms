import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { readSiteSettings, writeSiteJson } from './settings.ts';

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

  it('reaches the ActivityPub actor without a restart (AC #1)', async () => {
    const base = 'https://actor.example';
    const cms = await box.site({ baseUrl: base });
    const agent = await signedIn(cms);

    await saveSettings(agent, {
      title: 'The Actor Renamed',
      tagline: 'and re-summarised',
      actor_handle: 'writer',
      base_url: base,
    });

    const actor = (await (
      await cms.app.request(
        new Request(`${base}/ap/actor`, { headers: { accept: 'application/activity+json' } }),
      )
    ).json()) as Record<string, unknown>;

    assert.equal(actor['name'], 'The Actor Renamed');
    assert.match(String(actor['summary']), /and re-summarised/);
    assert.equal(actor['preferredUsername'], 'writer');
  });
});

describe('content/_data/site.json', () => {
  it('is rewritten on save with every setting the file carries (AC #1)', async () => {
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
      actorHandle: 'blog',
      actorType: 'Person',
      tagBase: 'tag',
      categoryBase: 'category',
      notifyServer: 'https://rpc.rsscloud.io',
      relays: [],
      navigation: [],
      taxonomyRedirects: [],
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

  it('carries the language into the page, both feeds and site.json', async () => {
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

/** The CSRF token off the settings screen, which both avatar forms carry. */
async function avatarToken(agent: Browser): Promise<string> {
  const token = csrfField(await (await agent.get('/admin/settings')).text());
  assert.ok(token !== undefined, 'the avatar form carried a CSRF token');
  return token;
}

describe('where the values come from', () => {
  it('is the file, so a hand edit shows on the site and on the screen (AC #2)', async () => {
    const contentDir = await box.dir('geekity-settings-source-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await saveSettings(agent, { title: 'Saved on the screen' });
    assert.match(await (await cms.app.request('/')).text(), /Saved on the screen/);

    // A hand edit of the file while the server runs. It is the source of
    // truth, so the next request is built on it — nothing is restarted and
    // nothing is told.
    const file = path.join(contentDir, '_data', 'site.json');
    const edited = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({ ...edited, title: 'Edited by hand', tagline: 'in an editor' }),
      'utf8',
    );

    const html = await (await cms.app.request('/')).text();
    assert.match(html, /Edited by hand/, 'the public site');
    assert.doesNotMatch(html, /Saved on the screen/);

    const screen = await (await agent.get('/admin/settings')).text();
    assert.equal(field(screen, 'title'), 'Edited by hand', 'the settings screen');
    assert.equal(field(screen, 'tagline'), 'in an editor');

    const actor = (await (
      await cms.app.request(
        new Request('http://localhost/ap/actor', {
          headers: { accept: 'application/activity+json' },
        }),
      )
    ).json()) as Record<string, unknown>;
    assert.equal(actor['name'], 'Edited by hand', 'and the actor');
  });

  it('survives a restart, because nothing else holds the settings', async () => {
    const contentDir = await box.dir('geekity-settings-restart-');
    const dataDir = await box.dir('geekity-settings-restart-data-');

    const first = await box.site({ contentDir, dataDir });
    await saveSettings(await signedIn(first), { title: 'Before the restart' });
    await first.close();

    const second = await box.site({ contentDir, dataDir });
    assert.equal(readSiteSettings(contentDir).title, 'Before the restart');
    assert.match(await (await second.app.request('/')).text(), /Before the restart/);
  });

  it('cannot be torn by two saves at once (AC #5)', async () => {
    const contentDir = await box.dir('geekity-settings-concurrent-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await saveSettings(agent, { title: 'Before' });

    const file = path.join(contentDir, '_data', 'site.json');
    let torn = 0;
    const readers = setInterval(() => {
      try {
        JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        torn += 1;
      }
    }, 0);

    const saves = await Promise.all([
      saveSettings(agent, { title: 'One', author: 'Ada' }),
      saveSettings(agent, { title: 'Two', author: 'Grace' }),
      saveSettings(agent, { title: 'Three', author: 'Katherine' }),
    ]);
    clearInterval(readers);

    assert.deepEqual(
      saves.map((response) => response.status),
      [303, 303, 303],
    );
    assert.equal(torn, 0, 'no reader saw a half-written file');

    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    const whole = [
      { title: 'One', author: 'Ada' },
      { title: 'Two', author: 'Grace' },
      { title: 'Three', author: 'Katherine' },
    ];
    assert.ok(
      whole.some((one) => one.title === written['title'] && one.author === written['author']),
      `the file holds one whole save, not a mixture: ${JSON.stringify(written)}`,
    );
    assert.deepEqual(
      (await readdir(path.join(contentDir, '_data'))).filter((name) => name.endsWith('.tmp')),
      [],
      'and no temporary file was left behind',
    );
  });
});

describe('a database whose settings are still rows', () => {
  /** A `dataDir` holding a database in the shape TASK-14 left behind. */
  async function legacyDatabase(rows: Record<string, string>): Promise<string> {
    const dataDir = await box.dir('geekity-settings-legacy-data-');
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));

    // Exactly migration 3, with the ledger row that stops it being applied
    // again, so the boot under test meets the schema a shipped site has.
    database.exec(`
      CREATE TABLE IF NOT EXISTS admin_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO admin_migrations (version, applied_at) VALUES (3, '2026-09-01T00:00:00.000Z');
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const insert = database.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    );
    for (const [key, value] of Object.entries(rows)) {
      insert.run(key, value, new Date().toISOString());
    }
    database.close();
    return dataDir;
  }

  /** Whether the database still has a table by that name. */
  function hasSettingsTable(dataDir: string): boolean {
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));
    const found = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
      .all();
    database.close();
    return found.length > 0;
  }

  it('writes the rows into site.json on the first boot, then drops the table (AC #3)', async () => {
    const contentDir = await box.dir('geekity-settings-legacy-');
    const dataDir = await legacyDatabase({
      title: 'A Site With Rows',
      tagline: 'stored in SQLite',
      baseUrl: 'https://rows.example',
      author: 'Ada',
      timezone: 'Europe/London',
      language: 'en-GB',
      postsPerPage: '4',
      actorHandle: 'writer',
      actorType: 'Organization',
      tagBase: 'topic',
      categoryBase: 'section',
      notifyServer: '',
      avatar: '/uploads/2026/09/me.png',
    });

    const cms = await box.site({ contentDir, dataDir });

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['title'], 'A Site With Rows');
    assert.equal(written['tagline'], 'stored in SQLite');
    assert.equal(written['url'], 'https://rows.example');
    assert.equal(written['author'], 'Ada');
    assert.equal(written['timezone'], 'Europe/London');
    assert.equal(written['language'], 'en-GB');
    assert.equal(written['postsPerPage'], 4);
    assert.equal(written['actorHandle'], 'writer');
    assert.equal(written['actorType'], 'Organization');
    assert.equal(written['tagBase'], 'topic');
    assert.equal(written['categoryBase'], 'section');
    assert.equal(written['notifyServer'], '');
    assert.equal(written['avatar'], '/uploads/2026/09/me.png');

    assert.match(await (await cms.app.request('/')).text(), /A Site With Rows/, 'and the site');
    await cms.close();
    assert.equal(hasSettingsTable(dataDir), false, 'the table is gone');

    // The second boot has nothing to migrate and must not fall back to the
    // defaults for a site whose file already says everything.
    const again = await box.site({ contentDir, dataDir });
    assert.equal(readSiteSettings(contentDir).title, 'A Site With Rows');
    assert.match(await (await again.app.request('/')).text(), /A Site With Rows/);
  });

  it('keeps a site.json that was edited after the rows were last written (AC #3)', async () => {
    const contentDir = await box.dir('geekity-settings-legacy-file-');
    const dataDir = await legacyDatabase({
      title: 'The Rows',
      actorHandle: 'writer',
      actorType: 'Service',
    });

    // The file is written after the rows, which is the site that was edited by
    // hand — or restored from git — since the last save. The file wins, as it
    // does for a post; the two settings it has never been able to carry come
    // from the rows.
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'The File', feedSize: 9 }),
      'utf8',
    );

    const cms = await box.site({ contentDir, dataDir });

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['title'], 'The File');
    assert.equal(written['feedSize'], 9, 'a key the form does not manage survived');
    assert.equal(written['actorHandle'], 'writer', 'the handle the file could not carry');
    assert.equal(written['actorType'], 'Service');

    assert.match(await (await cms.app.request('/')).text(), /The File/);
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

describe('the taxonomy bases', () => {
  it("default to WordPress's tag and category (AC #1, AC #3)", async () => {
    const cms = await box.site();
    const settings = readSiteSettings(cms.config.contentDir);

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
    const settings = readSiteSettings(cms.config.contentDir);

    assert.equal(settings.tagBase, 'topics');
    assert.equal(settings.categoryBase, 'category', 'a key the old file lacks gets the default');
  });

  it('move the archives and reach site.json when saved (AC #2, AC #3)', async () => {
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

      const settings = readSiteSettings(cms.config.contentDir);
      assert.equal(settings.tagBase, 'tag', 'the stored tag base is unchanged');
      assert.equal(settings.categoryBase, 'category', 'and so is the category base');
    }
  });
});

describe('the notify server setting', () => {
  it('starts on rpc.rsscloud.io, shows on the form and reaches site.json', async () => {
    const contentDir = await box.dir('geekity-settings-notify-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(field(html, 'notify_server'), 'https://rpc.rsscloud.io');

    assert.equal(
      (await saveSettings(agent, { notify_server: 'https://cloud.example/' })).status,
      303,
    );
    assert.equal(readSiteSettings(cms.config.contentDir).notifyServer, 'https://cloud.example');

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
    assert.equal(readSiteSettings(cms.config.contentDir).notifyServer, '');

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['notifyServer'], '', 'the file says so rather than saying nothing');

    // An emptied setting seeds as empty on the next boot, rather than being
    // filled back in from the default.
    const again = await box.site({
      contentDir,
      dataDir: await box.dir('geekity-settings-notify-boot-'),
    });
    assert.equal(readSiteSettings(again.config.contentDir).notifyServer, '');
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

    assert.equal(readSiteSettings(cms.config.contentDir).notifyServer, 'https://kept.example');
  });
});

describe('the relays setting', () => {
  /**
   * A site whose relay follows go nowhere: `fetch` is answered from here, and
   * the queue is off so the follow is over by the time the save answers.
   * Without both, the follow would go out over the real network and Fedify's
   * queue would go on retrying it after the test had finished.
   */
  let restoreFetch: (() => void) | undefined;

  before(() => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href).hostname.endsWith('.example')) return new Response('', { status: 202 });
      return await original(input, init);
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };
  });

  after(() => restoreFetch?.());

  /** A site that can follow a make-believe relay without leaving the process. */
  async function relaySite(contentDir?: string) {
    return await box.site({
      ...(contentDir === undefined ? {} : { contentDir }),
      federation: { queue: null },
    });
  }

  /** The content of a named textarea in the rendered settings screen. */
  function textarea(html: string, name: string): string | undefined {
    const match = new RegExp(`<textarea[^>]*name="${name}"[^>]*>([\\s\\S]*?)</textarea>`).exec(
      html,
    );
    return match?.[1];
  }

  it('starts empty, takes one inbox URL per line and reaches site.json', async () => {
    const contentDir = await box.dir('geekity-settings-relays-');
    const cms = await relaySite(contentDir);
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(textarea(html, 'relays'), '', 'a new site subscribes to no relay');

    assert.equal(
      (
        await saveSettings(agent, {
          relays: 'https://relay.example/inbox\n\nhttps://tags.example/user/_____relay_____/inbox',
        })
      ).status,
      303,
    );
    await cms.relays.settled();
    assert.deepEqual(readSiteSettings(cms.config.contentDir).relays, [
      'https://relay.example/inbox',
      'https://tags.example/user/_____relay_____/inbox',
    ]);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(written['relays'], [
      'https://relay.example/inbox',
      'https://tags.example/user/_____relay_____/inbox',
    ]);

    const back = await (await agent.get('/admin/settings')).text();
    assert.equal(
      textarea(back, 'relays'),
      'https://relay.example/inbox\nhttps://tags.example/user/_____relay_____/inbox',
    );
  });

  it('keeps the whole inbox path, and drops a repeated one', async () => {
    const cms = await relaySite();
    const agent = await signedIn(cms);

    await saveSettings(agent, {
      relays:
        'https://relay.example/user/_____relay_____/inbox/\nhttps://relay.example/user/_____relay_____/inbox',
    });

    await cms.relays.settled();
    assert.deepEqual(readSiteSettings(cms.config.contentDir).relays, [
      'https://relay.example/user/_____relay_____/inbox',
    ]);
  });

  it('refuses a line that is not an absolute URL, and keeps the stored list', async () => {
    const cms = await relaySite();
    const agent = await signedIn(cms);

    assert.equal((await saveSettings(agent, { relays: 'https://kept.example/inbox' })).status, 303);

    for (const bad of ['relay.example/inbox', 'ftp://relay.example/inbox', '/inbox']) {
      const response = await saveSettings(agent, { relays: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(
        await response.text(),
        /absolute http:\/\/ or https:\/\/ URL/,
        JSON.stringify(bad),
      );
    }

    await cms.relays.settled();
    assert.deepEqual(readSiteSettings(cms.config.contentDir).relays, [
      'https://kept.example/inbox',
    ]);
  });
});

describe('the navigation setting', () => {
  /** The content of a named textarea in the rendered settings screen. */
  function textarea(html: string, name: string): string | undefined {
    const match = new RegExp(`<textarea[^>]*name="${name}"[^>]*>([\\s\\S]*?)</textarea>`).exec(
      html,
    );
    return match?.[1];
  }

  it('takes one label and URL per line, and reaches site.json and the form', async () => {
    const contentDir = await box.dir('geekity-settings-navigation-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings')).text();
    assert.equal(textarea(html, 'navigation'), '', 'a new site has no menu');

    assert.equal(
      (
        await saveSettings(agent, {
          navigation: 'Home | /\n\n  About | /about/  \nElsewhere | https://example.org/',
        })
      ).status,
      303,
    );

    assert.deepEqual(readSiteSettings(cms.config.contentDir).navigation, [
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about/' },
      { label: 'Elsewhere', url: 'https://example.org/' },
    ]);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(written['navigation'], [
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about/' },
      { label: 'Elsewhere', url: 'https://example.org/' },
    ]);

    const back = await (await agent.get('/admin/settings')).text();
    assert.equal(
      textarea(back, 'navigation'),
      'Home | /\nAbout | /about/\nElsewhere | https://example.org/',
    );
  });

  it('refuses a line missing a label or a URL, and keeps what was stored (AC #4)', async () => {
    const contentDir = await box.dir('geekity-settings-navigation-bad-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    assert.equal((await saveSettings(agent, { navigation: 'Home | /' })).status, 303);

    for (const bad of ['About', 'About |', '| /about/', '  | ', 'About | not a url']) {
      const response = await saveSettings(agent, { navigation: bad, title: 'Should Not Land' });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /Label \| URL/, JSON.stringify(bad));
    }

    const settings = readSiteSettings(cms.config.contentDir);
    assert.deepEqual(settings.navigation, [{ label: 'Home', url: '/' }]);
    assert.equal(settings.title, 'A Site', 'the rest of the refused form was not written either');

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(written['navigation'], [{ label: 'Home', url: '/' }]);
  });

  it('is seeded from a site.json that has one, and empty from one that has not (AC #3)', async () => {
    const contentDir = await box.dir('geekity-settings-navigation-seed-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({
        title: 'Seeded',
        navigation: [{ label: 'About', url: '/about/' }, { label: 'Nowhere' }, 'Home'],
      }),
      'utf8',
    );

    const cms = await box.site({ contentDir });
    assert.deepEqual(readSiteSettings(cms.config.contentDir).navigation, [
      { label: 'About', url: '/about/' },
    ]);

    const older = await box.dir('geekity-settings-navigation-old-');
    await mkdir(path.join(older, '_data'), { recursive: true });
    await writeFile(
      path.join(older, '_data', 'site.json'),
      JSON.stringify({ title: 'From before the setting' }),
      'utf8',
    );

    const before = await box.site({ contentDir: older });
    assert.deepEqual(readSiteSettings(before.config.contentDir).navigation, []);
  });
});

describe('the recorded archive renames', () => {
  it('are seeded from an existing site.json, so a restored site keeps its redirects', async () => {
    const contentDir = await box.dir('geekity-redirects-seed-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({
        title: 'Old Site',
        taxonomyRedirects: [
          { taxonomy: 'tag', from: 'eleventy', to: '11ty' },
          { taxonomy: 'tag', from: 'bad' },
        ],
      }),
      'utf8',
    );

    const cms = await box.site({ contentDir });

    assert.deepEqual(readSiteSettings(cms.config.contentDir).taxonomyRedirects, [
      { taxonomy: 'tag', from: 'eleventy', to: '11ty' },
    ]);
  });

  it('survive a save of the settings form, which has no field for them', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    await writeSiteJson({
      contentDir: cms.config.contentDir,
      settings: {
        ...readSiteSettings(cms.config.contentDir),
        taxonomyRedirects: [{ taxonomy: 'category', from: 'misc', to: 'general' }],
      },
    });

    await saveSettings(agent, { title: 'Renamed by the form' });

    assert.deepEqual(readSiteSettings(cms.config.contentDir).taxonomyRedirects, [
      { taxonomy: 'category', from: 'misc', to: 'general' },
    ]);
  });
});
