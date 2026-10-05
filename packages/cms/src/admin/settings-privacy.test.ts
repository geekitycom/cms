import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { ADMIN_SECTIONS } from './menu.ts';
import { readSiteSettings } from './settings.ts';

const box = sandbox();
after(() => box.cleanup());

async function siteJson(contentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('Settings > Privacy (AC #2)', () => {
  it('is a child of the Settings menu, after Email', () => {
    const settings = ADMIN_SECTIONS.find((section) => section.section === 'settings');
    assert.deepEqual(settings?.children.at(-1), {
      child: 'privacy',
      label: 'Privacy',
      url: '/admin/settings/privacy',
    });
  });

  it('offers the three location sharing choices, with nothing shared by default', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings/privacy')).text();
    assert.match(html, /<h1\b[^>]*>Privacy<\/h1>/);
    assert.match(html, /name="location_sharing"/);
    assert.match(html, /<option value="none" selected>/, 'a new site publishes no location');
    assert.match(html, /<option value="place"/);
    assert.match(html, /<option value="exact"/);
    assert.equal(readSiteSettings(cms.config.contentDir).locationSharing, 'none');
  });

  it('says that location and camera metadata is always removed from uploads', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings/privacy')).text();
    assert.match(html, /camera/i);
    assert.match(html, /strip-metadata/);
  });

  it('saves the choice to site.json like every other settings page, and shows it back', async () => {
    const contentDir = await box.dir('geekity-settings-privacy-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await saveSettings(agent, 'privacy', { location_sharing: 'place' });
    assert.equal(response.status, 303);

    assert.equal(readSiteSettings(contentDir).locationSharing, 'place');
    assert.equal((await siteJson(contentDir))['locationSharing'], 'place');

    const back = await (await agent.get('/admin/settings/privacy')).text();
    assert.match(back, /<option value="place" selected>/);

    assert.equal((await saveSettings(agent, 'privacy', { location_sharing: 'exact' })).status, 303);
    assert.equal(readSiteSettings(contentDir).locationSharing, 'exact');
  });

  it('refuses a choice that is not one on offer, and writes nothing', async () => {
    const contentDir = await box.dir('geekity-settings-privacy-refused-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await saveSettings(agent, 'privacy', { location_sharing: 'place' });

    const response = await saveSettings(agent, 'privacy', { location_sharing: 'everything' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /none, place, exact/);
    assert.equal(readSiteSettings(contentDir).locationSharing, 'place');
  });

  it('reads a hand-edited value this version does not know as the default', async () => {
    const contentDir = await box.dir('geekity-settings-privacy-hand-');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'A Site', locationSharing: 'all' }),
      'utf8',
    );
    assert.equal(readSiteSettings(contentDir).locationSharing, 'none');
  });
});
