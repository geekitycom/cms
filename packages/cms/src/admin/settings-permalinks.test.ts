import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { readSiteSettings, writeSiteJson } from './settings.ts';

/**
 * The Permalinks settings page: the URLs the archives live at, and the ones
 * they used to.
 */

const box = sandbox();
after(() => box.cleanup());

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

      const settings = readSiteSettings(cms.config.contentDir);
      assert.equal(settings.tagBase, 'tag', 'the stored tag base is unchanged');
      assert.equal(settings.categoryBase, 'category', 'and so is the category base');
    }
  });
});

describe('the recorded archive renames', () => {
  it('survive a save of the page they are listed on, which has no field for them', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    await writeSiteJson({
      contentDir: cms.config.contentDir,
      settings: {
        ...readSiteSettings(cms.config.contentDir),
        taxonomyRedirects: [{ taxonomy: 'category', from: 'misc', to: 'general' }],
      },
    });

    await saveSettings(agent, 'permalinks', { tag_base: 'topics' });

    assert.equal(readSiteSettings(cms.config.contentDir).tagBase, 'topics', 'the save landed');
    assert.deepEqual(readSiteSettings(cms.config.contentDir).taxonomyRedirects, [
      { taxonomy: 'category', from: 'misc', to: 'general' },
    ]);

    const html = await (await agent.get('/admin/settings/permalinks')).text();
    assert.match(html, /misc/, 'and the page lists them');
    assert.match(html, /general/);
  });
});
