import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { DEFAULT_SECURITY_HEADERS } from '../config.ts';
import type { GeekityConfig } from '../config.ts';

const box = sandbox();
after(() => box.cleanup());

async function admin(config: GeekityConfig = {}): Promise<Browser> {
  return await signedIn(await box.site(config));
}

const DEFAULT_POLICY = DEFAULT_SECURITY_HEADERS['permissions-policy'];
const EDITOR_POLICY = DEFAULT_POLICY?.replace('geolocation=()', 'geolocation=(self)');

function policy(response: Response): string | null {
  return response.headers.get('permissions-policy');
}

async function savedPost(agent: Browser): Promise<void> {
  const page = await (await agent.get('/admin/posts/new')).text();
  const saved = await agent.post('/admin/posts/new', {
    csrf_token: csrfField(page) ?? '',
    title: 'Here',
    slug: 'here',
    date: '2026-09-02 09:00',
    body: 'Where I am.',
    action: 'publish',
  });
  assert.equal(saved.status, 303);
}

describe('the editor’s geolocation', () => {
  it('lets the post editor, and only it, ask for the browser’s position', async () => {
    const agent = await admin();
    await savedPost(agent);

    assert.notEqual(EDITOR_POLICY, DEFAULT_POLICY);
    assert.match(EDITOR_POLICY ?? '', /(^|, )geolocation=\(self\)(,|$)/);
    assert.equal(policy(await agent.get('/admin/posts/new')), EDITOR_POLICY);
    assert.equal(policy(await agent.get('/admin/posts/here')), EDITOR_POLICY);

    for (const url of ['/admin/pages/new', '/admin', '/admin/posts', '/2026/09/here/']) {
      const response = await agent.get(url);
      assert.equal(response.status, 200, url);
      assert.equal(policy(response), DEFAULT_POLICY, url);
    }
  });

  it('keeps the allowance on a refused save, which is the editor again', async () => {
    const agent = await admin();
    const page = await (await agent.get('/admin/posts/new')).text();
    const refused = await agent.post('/admin/posts/new', {
      csrf_token: csrfField(page) ?? '',
      title: 'Nowhere',
      date: '2026-09-02 09:00',
      body: 'x',
      'location-geo': 'somewhere',
      action: 'publish',
    });
    assert.equal(refused.status, 400);
    assert.equal(policy(refused), EDITOR_POLICY);
  });

  it('adds nothing to a site that removed the header, and passes a policy of its own through', async () => {
    const off = await admin({ securityHeaders: { 'permissions-policy': false } });
    assert.equal(policy(await off.get('/admin/posts/new')), null);

    const own = await admin({ securityHeaders: { 'permissions-policy': 'camera=()' } });
    assert.equal(policy(await own.get('/admin/posts/new')), 'camera=()');
  });

  it('draws a hidden Use my location button and a status line, enhanced by location.js', async () => {
    const agent = await admin();
    const html = await (await agent.get('/admin/posts/new')).text();

    const here = /<button\b[^>]*\bid="editor-location-here"[^>]*>Use my location<\/button>/.exec(
      html,
    )?.[0];
    assert.ok(here !== undefined, 'a Use my location button');
    assert.match(here, /\btype="button"/);
    assert.match(here, /\shidden[\s>]/);
    assert.match(html, /<p id="editor-location-status" class="[^"]*" role="status"><\/p>/);
    assert.match(html, /<script defer src="\/admin\/_static\/location\.js"><\/script>/);

    const page = await (await agent.get('/admin/pages/new')).text();
    assert.doesNotMatch(page, /editor-location-here|location\.js/);
  });

  it('serves location.js', async () => {
    const agent = await admin();
    const script = await agent.get('/admin/_static/location.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    assert.match(await script.text(), /getCurrentPosition/);
  });
});
