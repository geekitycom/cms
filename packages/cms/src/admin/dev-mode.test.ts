import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { holdOutbound } from '../dev-mode.ts';
import { DEV_MODE, readDevModeRecord } from '../settings/dev-mode.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import { DEV_MODE_PATH } from './dev-mode.ts';

const box = sandbox();
after(() => box.cleanup());

describe('dev mode in the admin', () => {
  it('shows a banner on every screen while the site is in dev mode', async () => {
    const cms = await box.site({ devMode: true });
    const agent = await signedIn(cms);

    for (const screen of ['/admin', '/admin/posts', '/admin/settings']) {
      const html = await (await agent.get(screen)).text();
      assert.match(html, /Dev mode is on/, `${screen} carries the banner`);
      assert.ok(html.includes(`href="${DEV_MODE_PATH}"`), `${screen} links to the record`);
    }
  });

  it('shows no banner on a live site', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    assert.doesNotMatch(await (await agent.get('/admin')).text(), /Dev mode is on/);
  });

  it('lists what was held, newest first, with whom it would have reached', async () => {
    const cms = await box.site({ devMode: true });
    const agent = await signedIn(cms);
    await holdOutbound(cms.settings, cms.config, {
      kind: 'activitypub',
      what: 'Create https://blog.example/first/',
      to: ['https://remote.example/inbox'],
    });
    await holdOutbound(cms.settings, cms.config, {
      kind: 'mail',
      what: 'Reset your password',
      to: ['ada@example.com'],
    });

    const response = await agent.get(DEV_MODE_PATH);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /<h1[^>]*>Dev mode<\/h1>/);
    const create = html.indexOf('Create https://blog.example/first/');
    const reset = html.indexOf('Reset your password');
    assert.ok(create > 0 && reset > 0, 'both held effects are listed');
    assert.ok(reset < create, 'newest first');
    assert.ok(html.includes('https://remote.example/inbox'));
    assert.ok(html.includes('ada@example.com'));
    assert.match(html, /geekity dev-mode off/, 'and how to go live');
  });

  it('turns dev mode on and takes the site live from the switch, recording both', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const token = csrfField(await (await agent.get(DEV_MODE_PATH)).text()) ?? '';

    assert.equal((await agent.post(DEV_MODE_PATH, { csrf_token: token, on: '1' })).status, 303);
    assert.equal(await cms.settings.get(DEV_MODE.on), true);
    assert.match(await (await agent.get('/admin')).text(), /Dev mode is on/);

    assert.equal((await agent.post(DEV_MODE_PATH, { csrf_token: token })).status, 303);
    assert.equal(await cms.settings.get(DEV_MODE.on), false);

    assert.deepEqual(
      readDevModeRecord(cms.config.dataDir).map(({ type, ...rest }) => [
        type,
        'by' in rest ? rest.by : undefined,
      ]),
      [
        ['on', 'admin'],
        ['off', 'admin'],
      ],
    );
    const html = await (await agent.get(DEV_MODE_PATH)).text();
    assert.match(html, /Went live/, 'the screen lists when the site went live');
    assert.match(html, /the admin switch/);
  });

  it('refuses to take the site live while the config still asks for dev mode, saying so', async () => {
    const cms = await box.site({ devMode: true });
    const agent = await signedIn(cms);
    const page = await (await agent.get(DEV_MODE_PATH)).text();
    const sentence = 'GEEKITY_DEV_MODE or the devMode setting still asks for dev mode.';
    assert.ok(page.includes(sentence), 'the screen says what latches it');

    const refused = await agent.post(DEV_MODE_PATH, { csrf_token: csrfField(page) ?? '' });

    assert.equal(refused.status, 400);
    assert.ok((await refused.text()).includes(sentence));
    assert.equal(await cms.settings.get(DEV_MODE.on), true);
  });
});
