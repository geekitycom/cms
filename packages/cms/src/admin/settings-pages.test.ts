import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { ADMIN_SECTIONS } from './menu.ts';
import { SETTINGS_PAGES } from './settings-pages.ts';
import { readSiteSettings, SETTINGS_FIELDS } from './settings.ts';

const box = sandbox();
after(() => box.cleanup());

describe('the settings pages', () => {
  it('are the six the Settings menu lists, General first (AC #1)', () => {
    const settings = ADMIN_SECTIONS.find((section) => section.section === 'settings');

    assert.deepEqual(
      settings?.children.map((child) => [child.child, child.label, child.url]),
      [
        ['general', 'General', '/admin/settings'],
        ['reading', 'Reading', '/admin/settings/reading'],
        ['permalinks', 'Permalinks', '/admin/settings/permalinks'],
        ['discussion', 'Discussion', '/admin/settings/discussion'],
        ['email', 'Email', '/admin/settings/email'],
        ['federation', 'Federation', '/admin/settings/federation'],
      ],
    );
    assert.equal(settings?.url, '/admin/settings', 'the heading lands on General');
  });

  it('each answer with a form of their own that posts to their own URL (AC #1)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const page of SETTINGS_PAGES) {
      const response = await agent.get(page.path);
      assert.equal(response.status, 200, page.path);

      const html = await response.text();
      assert.ok(csrfField(html) !== undefined, `${page.path} carries a CSRF token`);
      assert.match(
        html,
        new RegExp(`<form[^>]*action="${page.path}"`),
        `${page.path} posts to itself`,
      );
    }
  });

  it('carry every setting the one screen had, each on exactly one page (AC #2)', () => {
    const seen = SETTINGS_PAGES.flatMap((page) => [...page.fields]);

    assert.equal(new Set(seen).size, seen.length, 'no field is on two pages');
    assert.deepEqual(
      [...seen].sort(),
      Object.keys(SETTINGS_FIELDS).sort(),
      'every field of the old form is on a page',
    );
  });
});

describe('saving one settings page', () => {
  it('changes that page’s fields and nothing else (AC #2)', async () => {
    const contentDir = await box.dir('geekity-settings-one-page-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await save(agent, '/admin/settings', { title: 'A Renamed Site', tagline: 'and re-said' });
    await save(agent, '/admin/settings/permalinks', {
      tag_base: 'topic',
      category_base: 'section',
    });

    const settings = readSiteSettings(contentDir);
    assert.equal(settings.title, 'A Renamed Site', 'the General save landed');
    assert.equal(settings.tagBase, 'topic', 'and so did the Permalinks one');
    assert.equal(settings.tagline, 'and re-said', 'and neither undid the other');
    assert.equal(settings.postsPerPage, 10, 'a field on neither page is untouched');
  });

  it('lands beside a save of another page made at the same moment (AC #2)', async () => {
    const contentDir = await box.dir('geekity-settings-two-pages-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    // A key the settings model does not carry: it has to survive both saves.
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'Before', feedSize: 42 }),
      'utf8',
    );

    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    // Both forms are opened before either is saved, which is the case that
    // matters: each carries the settings as they were, and the second save
    // must not put back what the first one changed.
    const general = await token(agent, '/admin/settings');
    const reading = await token(agent, '/admin/settings/reading');

    const saved = await Promise.all([
      agent.post('/admin/settings', { csrf_token: general, ...GENERAL, title: 'Renamed' }),
      agent.post('/admin/settings/reading', {
        csrf_token: reading,
        ...READING,
        posts_per_page: '25',
      }),
    ]);

    assert.deepEqual(
      saved.map((response) => response.status),
      [303, 303],
    );

    const settings = readSiteSettings(contentDir);
    assert.equal(settings.title, 'Renamed', 'the General save is in the file');
    assert.equal(settings.postsPerPage, 25, 'and so is the Reading one');

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['feedSize'], 42, 'and the key neither page manages is still there');
  });

  it('comes back on the page it came from when it is refused, having written nothing (AC #3)', async () => {
    const contentDir = await box.dir('geekity-settings-refused-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await save(agent, '/admin/settings/reading', {
      posts_per_page: '7',
      notify_server: 'https://notify.example',
    });

    const refused = await save(agent, '/admin/settings/reading', {
      posts_per_page: 'lots',
      notify_server: 'https://somewhere-else.example',
    });

    assert.equal(refused.status, 400);
    const html = await refused.text();
    assert.match(html, /Posts per page has to be a whole number/);
    assert.match(
      html,
      /<form[^>]*action="\/admin\/settings\/reading"/,
      'and it is the Reading page that came back',
    );

    const settings = readSiteSettings(contentDir);
    assert.equal(settings.postsPerPage, 7, 'nothing at all was written');
    assert.equal(settings.notifyServer, 'https://notify.example', 'not even the valid field');
  });

  it('says nothing about a field on another page, however that page stands (AC #3)', async () => {
    const contentDir = await box.dir('geekity-settings-other-page-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    // A stored value the Reading page's own validator would refuse, on a field
    // the Reading page does not show and gives nobody a way to fix.
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: '', actorHandle: 'blog' }),
      'utf8',
    );

    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const saved = await save(agent, '/admin/settings/reading', { posts_per_page: '3' });

    assert.equal(saved.status, 303, 'the Reading page saved');
    assert.equal(readSiteSettings(contentDir).postsPerPage, 3);
  });
});

/** What the General page submits, with sane values for what a test does not name. */
const GENERAL: Record<string, string> = {
  title: 'A Site',
  tagline: '',
  author: '',
  base_url: 'http://localhost:3000',
  timezone: 'UTC',
  language: 'en',
};

/** What the Reading page submits. */
const READING: Record<string, string> = {
  posts_per_page: '10',
  navigation: '',
  notify_server: '',
};

/** The CSRF token on one settings page, as a browser would carry it. */
async function token(agent: Browser, url: string): Promise<string> {
  const found = csrfField(await (await agent.get(url)).text());
  assert.ok(found !== undefined, `${url} carried a CSRF token`);
  return found;
}

/**
 * Save one settings page, filling in whatever the caller did not name.
 *
 * A page submits its own fields and no others, so the defaults are the page's
 * own: what is missing from the body is what a browser would leave out.
 */
async function save(
  agent: Browser,
  url: string,
  fields: Record<string, string>,
): Promise<Response> {
  const page = SETTINGS_PAGES.find((one) => one.path === url);
  assert.ok(page !== undefined, `${url} is a settings page`);

  return agent.post(url, {
    csrf_token: await token(agent, url),
    ...(url === '/admin/settings' ? GENERAL : {}),
    ...(url === '/admin/settings/reading' ? READING : {}),
    ...fields,
  });
}
