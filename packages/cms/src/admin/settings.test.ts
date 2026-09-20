import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import {
  DEFAULT_SITE_SETTINGS,
  formFromSettings,
  readSiteSettings,
  settingsFromForm,
  settingsProblems,
  updateSiteSettings,
} from './settings.ts';

/**
 * The settings themselves: `content/_data/site.json`, which is what every
 * settings page reads and writes (decision-9). What each page carries is its
 * own test file; this one is about the file being the truth.
 */

const box = sandbox();
after(() => box.cleanup());

/** The value of a form field in the rendered page. */
function field(html: string, name: string): string | undefined {
  const match = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return match?.[1];
}

describe('content/_data/site.json', () => {
  it('is rewritten on save with every setting the file carries (AC #1)', async () => {
    const contentDir = await box.dir('geekity-settings-mirror-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await saveSettings(agent, 'general', {
      title: 'Mirrored',
      tagline: 'and mirrored again',
      base_url: 'https://mirror.example',
      author: 'Grace',
      timezone: 'Europe/London',
    });
    await saveSettings(agent, 'reading', { posts_per_page: '7' });

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
      tagBase: 'tag',
      categoryBase: 'category',
      comments: true,
      commentsCloseAfterDays: 14,
      // Neither save was of the Discussion page, so its checkboxes are as they
      // were: a page writes the fields it carries and no others.
      webmentionsSend: true,
      webmentionsReceive: true,
      notifyServer: 'https://rpc.rsscloud.io',
      // The mail settings the file carries. The key and the SMTP password are
      // not among them: those are credentials and live in `data/mail.json`.
      mailProvider: 'none',
      mailFromName: '',
      mailFromAddress: '',
      mailReplyTo: '',
      contactEmail: '',
      relays: [],
      // Every menu the site stores, by name (TASK-107). A site that has typed
      // none has the one the theme's primary area reads, empty.
      menus: { primary: [] },
      taxonomyRedirects: [],
    });
  });

  it('keeps the keys the settings do not model', async () => {
    const contentDir = await box.dir('geekity-settings-roundtrip-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'Old', feedSize: 42, anything: { at: 'all' } }),
      'utf8',
    );

    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await saveSettings(agent, 'general', { title: 'New' });

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;

    assert.equal(written['title'], 'New');
    assert.equal(written['feedSize'], 42);
    assert.deepEqual(written['anything'], { at: 'all' });
  });
});

describe('where the values come from', () => {
  it('is the file, so a hand edit shows on the site and on the screen (AC #2)', async () => {
    const contentDir = await box.dir('geekity-settings-source-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await saveSettings(agent, 'general', { title: 'Saved on the screen' });
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
    assert.equal(field(screen, 'title'), 'Edited by hand', 'the General settings page');
    assert.equal(field(screen, 'tagline'), 'in an editor');

    // And nobody's actor moved: decision-14 made the profile a user's, so the
    // site's own title is not published to anybody any more.
    const actor = await cms.app.request(
      new Request('http://localhost/author/ada/', {
        headers: { accept: 'application/activity+json' },
      }),
    );
    assert.equal(((await actor.json()) as Record<string, unknown>)['name'], 'ada');
  });

  it('survives a restart, because nothing else holds the settings', async () => {
    const contentDir = await box.dir('geekity-settings-restart-');
    const dataDir = await box.dir('geekity-settings-restart-data-');

    const first = await box.site({ contentDir, dataDir });
    await saveSettings(await signedIn(first), 'general', { title: 'Before the restart' });
    await first.close();

    const second = await box.site({ contentDir, dataDir });
    assert.equal(readSiteSettings(contentDir).title, 'Before the restart');
    assert.match(await (await second.app.request('/')).text(), /Before the restart/);
  });

  it('cannot be torn by two saves at once (AC #5)', async () => {
    const contentDir = await box.dir('geekity-settings-concurrent-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await saveSettings(agent, 'general', { title: 'Before' });

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
      saveSettings(agent, 'general', { title: 'One', author: 'Ada' }),
      saveSettings(agent, 'general', { title: 'Two', author: 'Grace' }),
      saveSettings(agent, 'general', { title: 'Three', author: 'Katherine' }),
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
  async function legacyDatabase(
    rows: Record<string, string>,
    updatedAt: string = new Date().toISOString(),
  ): Promise<string> {
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
      insert.run(key, value, updatedAt);
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
      tagBase: 'topic',
      categoryBase: 'section',
      notifyServer: '',
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
    assert.equal(written['tagBase'], 'topic');
    assert.equal(written['categoryBase'], 'section');
    assert.equal(written['notifyServer'], '');

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
    // The rows were last saved an hour ago; the file is written now. That is
    // the site that was edited by hand — or restored from git — since the last
    // save. The file wins outright, as it does for a post: since decision-14
    // there is no setting the file has never been able to carry. The hour is
    // deliberate: a row and a file stamped within the same instant is a tie,
    // and a tie goes to the rows.
    const dataDir = await legacyDatabase(
      { title: 'The Rows', tagBase: 'topic' },
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    );

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
    assert.equal(written['tagBase'], 'tag', 'and the rows did not overwrite the file');

    assert.match(await (await cms.app.request('/')).text(), /The File/);
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
});

describe('the theme setting', () => {
  /** A themes directory holding one theme with a manifest. */
  async function themesDir(...names: string[]): Promise<string> {
    const dir = await box.dir('geekity-settings-themes-');
    for (const name of names) {
      await mkdir(path.join(dir, name), { recursive: true });
      await writeFile(
        path.join(dir, name, 'theme.json'),
        JSON.stringify({ name, kind: 'site' }),
        'utf8',
      );
    }
    return dir;
  }

  it('is read from site.json and written back, and is absent for the packaged theme', async () => {
    const contentDir = await box.dir('geekity-settings-theme-');

    await updateSiteSettings({
      contentDir,
      change: (current) => ({ ...current, theme: 'midnight' }),
    });

    const file = path.join(contentDir, '_data', 'site.json');
    const chosen = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(chosen['theme'], 'midnight');
    assert.equal(readSiteSettings(contentDir).theme, 'midnight');

    await updateSiteSettings({ contentDir, change: (current) => ({ ...current, theme: '' }) });

    const packaged = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.ok(!('theme' in packaged), 'the packaged theme is the absence of the key');
    assert.equal(readSiteSettings(contentDir).theme, '');
  });

  it('survives a save of a settings page that does not carry it', async () => {
    const contentDir = await box.dir('geekity-settings-theme-keep-');
    await updateSiteSettings({
      contentDir,
      change: (current) => ({ ...current, theme: 'midnight' }),
    });

    const cms = await box.site({ contentDir, themesDir: await themesDir('midnight') });
    const agent = await signedIn(cms);
    await saveSettings(agent, 'general', { title: 'Renamed' });

    const settings = readSiteSettings(contentDir);
    assert.equal(settings.title, 'Renamed');
    assert.equal(settings.theme, 'midnight', 'the Appearance choice is not a General field');
  });

  it('round-trips through the form the way every other setting does', () => {
    const form = formFromSettings({ ...DEFAULT_SITE_SETTINGS, theme: 'midnight' });

    assert.equal(form.theme, 'midnight');
    assert.equal(settingsFromForm(form).theme, 'midnight');
  });

  it('takes a name that is a theme, and the empty name for the packaged one', async () => {
    const dir = await themesDir('midnight');
    const form = formFromSettings(DEFAULT_SITE_SETTINGS);

    for (const theme of ['midnight', '']) {
      assert.deepEqual(
        settingsProblems({ ...form, theme }, ['theme'], { themesDir: dir }),
        {},
        `"${theme}" was refused`,
      );
    }
  });

  it('refuses a name that is not a theme directory, with a message', async () => {
    const dir = await themesDir('midnight');
    const form = formFromSettings(DEFAULT_SITE_SETTINGS);

    const missing = settingsProblems({ ...form, theme: 'daylight' }, ['theme'], { themesDir: dir });
    assert.match(missing.theme ?? '', /daylight/);

    await writeFile(path.join(dir, 'midnight', 'theme.json'), '{ not json', 'utf8');
    const broken = settingsProblems({ ...form, theme: 'midnight' }, ['theme'], { themesDir: dir });
    assert.match(broken.theme ?? '', /theme\.json/);

    const escaping = settingsProblems({ ...form, theme: '../elsewhere' }, ['theme'], {
      themesDir: dir,
    });
    assert.ok(escaping.theme !== undefined, 'a path is not a theme name');
  });
});
