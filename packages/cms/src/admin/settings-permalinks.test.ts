import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { writeSiteSettings } from '../__testing__/site-settings.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { siteSettingsIn } from '../__testing__/site-settings.ts';

/**
 * The Permalinks settings page: the URLs the archives live at, and the ones
 * they used to.
 */

const box = sandbox();
after(() => box.cleanup());

describe('the taxonomy bases', () => {
  it('default to tag and category (AC #1, AC #3)', async () => {
    const cms = await box.site();
    const settings = await siteSettingsIn(cms.config.contentDir);

    assert.equal(settings.tag_base, 'tag');
    assert.equal(settings.category_base, 'category');
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
    const settings = await siteSettingsIn(cms.config.contentDir);

    assert.equal(settings.tag_base, 'topics');
    assert.equal(settings.category_base, 'category', 'a key the old file lacks gets the default');
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

    const saved = await saveSettings(agent, 'permalinks', {
      tag_base: 'topics',
      category_base: 'filed',
    });
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
      const response = await saveSettings(agent, 'permalinks', fields);
      assert.equal(response.status, 400, `${JSON.stringify(fields)} should be refused`);

      const settings = await siteSettingsIn(cms.config.contentDir);
      assert.equal(settings.tag_base, 'tag', 'the stored tag base is unchanged');
      assert.equal(settings.category_base, 'category', 'and so is the category base');
    }
  });
});

describe('the wiki base', () => {
  it('defaults to wiki and is shown on the Permalinks page', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    assert.equal((await siteSettingsIn(cms.config.contentDir)).wiki_base, 'wiki');

    const html = await (await agent.get('/admin/settings/permalinks')).text();
    assert.match(html, /<label[^>]*for="settings-wiki-base"[^>]*>\s*Wiki base/);
    assert.match(html, /id="settings-wiki-base"[^>]*name="wiki_base"[^>]*value="wiki"/);
  });

  it('is saved with the other permalink settings and reaches site.json', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const saved = await saveSettings(agent, 'permalinks', { wiki_base: 'notes' });
    assert.equal(saved.status, 303);

    assert.equal((await siteSettingsIn(cms.config.contentDir)).wiki_base, 'notes');
    const mirror = JSON.parse(
      await readFile(path.join(cms.config.contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(mirror['wikiBase'], 'notes');
  });

  it('is refused by the rules the archive bases follow, with the problem on its field', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const [fields, message] of [
      [{ wiki_base: '' }, /The wiki base cannot be empty/],
      [{ wiki_base: 'a/b' }, /A wiki base is one path segment/],
      [{ wiki_base: 'admin' }, /already a path this site answers on/],
      [{ wiki_base: 'tag' }, /The tag base and the wiki base have to be different words/],
      [
        { wiki_base: 'filed', category_base: 'filed' },
        /The category base and the wiki base have to be different words/,
      ],
    ] as const) {
      const response = await saveSettings(agent, 'permalinks', fields);
      assert.equal(response.status, 400, `${JSON.stringify(fields)} should be refused`);

      const html = await response.text();
      const problem = /id="settings-wiki-base-error"[^>]*>([^<]*)</.exec(html);
      assert.ok(
        problem !== null,
        `the wiki base field carries a problem for ${JSON.stringify(fields)}`,
      );
      assert.match(problem[1] ?? '', message);

      const settings = await siteSettingsIn(cms.config.contentDir);
      assert.equal(settings.wiki_base, 'wiki', 'the stored wiki base is unchanged');
      assert.equal(settings.category_base, 'category');
    }
  });
});

describe('the recorded archive renames', () => {
  it('survive a save of the page they are listed on, which has no field for them', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    await writeSiteSettings({
      contentDir: cms.config.contentDir,
      settings: {
        ...(await siteSettingsIn(cms.config.contentDir)),
        taxonomy_redirects: [{ taxonomy: 'category', from: 'misc', to: 'general' }],
      },
    });

    await saveSettings(agent, 'permalinks', { tag_base: 'topics' });

    assert.equal(
      (await siteSettingsIn(cms.config.contentDir)).tag_base,
      'topics',
      'the save landed',
    );
    assert.deepEqual((await siteSettingsIn(cms.config.contentDir)).taxonomy_redirects, [
      { taxonomy: 'category', from: 'misc', to: 'general' },
    ]);

    const html = await (await agent.get('/admin/settings/permalinks')).text();
    assert.match(html, /misc/, 'and the page lists them');
    assert.match(html, /general/);
  });
});
