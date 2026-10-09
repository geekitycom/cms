import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { holdOutbound } from '../dev-mode.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
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
    holdOutbound(cms.config, {
      kind: 'activitypub',
      what: 'Create https://blog.example/first/',
      to: ['https://remote.example/inbox'],
    });
    holdOutbound(cms.config, {
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
});
