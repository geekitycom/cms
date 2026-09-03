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
  posts_per_page: '10',
  author: 'Somebody',
  actor_handle: 'blog',
  actor_type: 'Person',
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
      await (await cms.app.request('/feed.xml')).text(),
      /<title>A Renamed Site<\/title>/,
      'and so does the Atom feed',
    );
    const json = (await (await cms.app.request('/feed.json')).json()) as Record<string, unknown>;
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
      await (await second.app.request('/feed.xml')).text(),
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
