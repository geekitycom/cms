import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { GeekityConfig } from '../config.ts';
import { RECHECK_MS } from '../maintenance.ts';
import { MAINTENANCE } from '../settings/maintenance.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import { MAINTENANCE_PATH } from './maintenance.ts';

const box = sandbox();
after(() => box.cleanup());

async function screen(config: GeekityConfig = {}) {
  let now = Date.parse('2026-10-13T12:00:00Z');
  const cms = await box.site({ now: () => new Date(now), ...config });
  const agent = await signedIn(cms);
  const page = await agent.get(MAINTENANCE_PATH);
  const html = await page.text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the maintenance screen carried a CSRF token');
  const tick = () => {
    now += RECHECK_MS + 1;
  };
  return { cms, agent, token, html, status: page.status, tick };
}

describe('Tools > Maintenance', () => {
  it('turns maintenance on with an expected-back time, and off again', async () => {
    const { cms, agent, token, html, status, tick } = await screen();
    assert.equal(status, 200);
    assert.match(html, /<h1[^>]*>Maintenance<\/h1>/);

    const on = await agent.post(MAINTENANCE_PATH, {
      csrf_token: token,
      on: '1',
      until: '2026-10-13T14:00:00Z',
    });
    assert.equal(on.status, 303);
    assert.deepEqual(await cms.settings.values(MAINTENANCE), {
      on: true,
      until: '2026-10-13T14:00:00.000Z',
    });
    tick();
    const down = await cms.app.request('/');
    assert.equal(down.status, 503, 'the public site is turned away');
    assert.equal(down.headers.get('retry-after'), 'Tue, 13 Oct 2026 14:00:00 GMT');

    const off = await agent.post(MAINTENANCE_PATH, { csrf_token: token, until: '' });
    assert.equal(off.status, 303);
    assert.equal(await cms.settings.get(MAINTENANCE.on), false);
    tick();
    assert.notEqual((await cms.app.request('/')).status, 503, 'and recovers');
  });

  it('refuses an expected-back time that is not a time, and saves nothing', async () => {
    const { cms, agent, token } = await screen();

    const refused = await agent.post(MAINTENANCE_PATH, {
      csrf_token: token,
      on: '1',
      until: 'soonish',
    });

    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /maintenance\.until must be a time/);
    await assert.rejects(stat(path.join(cms.config.dataDir, 'maintenance.json')), {
      code: 'ENOENT',
    });
  });

  it('says when the config keeps the site in maintenance, and refuses the save with that sentence', async () => {
    const { cms, agent, token, html } = await screen({ maintenance: true });
    const sentence =
      'maintenance.on is set by maintenance in the config and cannot be changed here.';
    assert.ok(html.includes(sentence), 'the screen says what overrides it');

    const refused = await agent.post(MAINTENANCE_PATH, { csrf_token: token, until: '' });

    assert.equal(refused.status, 400);
    assert.ok((await refused.text()).includes(sentence));
    await assert.rejects(stat(path.join(cms.config.dataDir, 'maintenance.json')), {
      code: 'ENOENT',
    });
  });
});
