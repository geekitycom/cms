import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { readSiteSettings } from './settings.ts';

/**
 * The Reading settings page: how many posts a listing holds, the site menu,
 * and the server told when a feed changes.
 */

const box = sandbox();
after(() => box.cleanup());

/** The value of a form field in the rendered page. */
function field(html: string, name: string): string | undefined {
  const match = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return match?.[1];
}

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

    await saveSettings(agent, 'reading', { posts_per_page: '2' });

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

describe('a Reading form the validator refuses', () => {
  it('refuses a posts per page that is not a positive whole number', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const bad of ['0', '-3', '2.5', 'ten', '']) {
      const response = await saveSettings(agent, 'reading', { posts_per_page: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /whole number of one or more/, JSON.stringify(bad));
    }
  });
});

describe('the notify server setting', () => {
  it('starts on rpc.rsscloud.io, shows on the form and reaches site.json', async () => {
    const contentDir = await box.dir('geekity-settings-notify-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings/reading')).text();
    assert.equal(field(html, 'notify_server'), 'https://rpc.rsscloud.io');

    assert.equal(
      (await saveSettings(agent, 'reading', { notify_server: 'https://cloud.example/' })).status,
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

    assert.equal((await saveSettings(agent, 'reading', { notify_server: '' })).status, 303);
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
      (await saveSettings(agent, 'reading', { notify_server: 'https://kept.example' })).status,
      303,
    );

    for (const bad of ['rpc.rsscloud.io', 'ftp://cloud.example', '/pleaseNotify']) {
      const response = await saveSettings(agent, 'reading', { notify_server: bad });
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

    const html = await (await agent.get('/admin/settings/reading')).text();
    assert.equal(textarea(html, 'navigation'), '', 'a new site has no menu');

    assert.equal(
      (
        await saveSettings(agent, 'reading', {
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

    const back = await (await agent.get('/admin/settings/reading')).text();
    assert.equal(
      textarea(back, 'navigation'),
      'Home | /\nAbout | /about/\nElsewhere | https://example.org/',
    );
  });

  it('refuses a line missing a label or a URL, and keeps what was stored (AC #4)', async () => {
    const contentDir = await box.dir('geekity-settings-navigation-bad-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    assert.equal((await saveSettings(agent, 'reading', { navigation: 'Home | /' })).status, 303);

    for (const bad of ['About', 'About |', '| /about/', '  | ', 'About | not a url']) {
      const response = await saveSettings(agent, 'reading', {
        navigation: bad,
        posts_per_page: '99',
      });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /Label \| URL/, JSON.stringify(bad));
    }

    const settings = readSiteSettings(cms.config.contentDir);
    assert.deepEqual(settings.navigation, [{ label: 'Home', url: '/' }]);
    assert.equal(settings.postsPerPage, 10, 'the rest of the refused form was not written either');

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
