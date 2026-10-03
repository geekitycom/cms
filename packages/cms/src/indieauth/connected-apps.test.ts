/**
 * Users > Connected apps (TASK-162): the apps that hold a token for the
 * signed-in person, and the button that cuts one off.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import { readSiteSettings } from '../admin/settings.ts';
import { saveSettings } from '../admin/__testing__/settings.ts';
import type { Cms } from '../index.ts';
import type { AuthorizationCode } from './grants.ts';
import { issueTokens, listTokens, recordUse } from './tokens.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const SCREEN = '/admin/users/apps';
const REVOKE = '/admin/users/apps/revoke';
const ISSUED = new Date('2026-09-30T08:00:00Z');
const USED = new Date('2026-09-30T09:30:00Z');

const QUILL: AuthorizationCode = {
  clientId: 'https://quill.example/',
  clientName: 'Quill',
  redirectUri: 'https://quill.example/callback',
  codeChallenge: { method: 'S256', value: 'unused' },
  userId: 1,
  me: `${BASE}/`,
  scopes: ['create', 'media'],
};

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const cms = await box.site({ baseUrl: BASE });
  const agent = await signedIn(cms);
  return { cms, agent };
}

async function screen(agent: Browser): Promise<string> {
  const response = await agent.get(SCREEN);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  return html;
}

/** The text of the one table row naming `client`. */
function rowFor(html: string, client: string): string {
  const row = [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)]
    .map(([match]) => match)
    .find((match) => match.includes(client));
  assert.ok(row !== undefined, `a row names ${client}`);
  return row;
}

describe('the connected apps screen', () => {
  it('lists the signed-in user’s connections with client, scopes, issued, last used and expiry', async () => {
    const { cms, agent } = await site();
    const { dataDir } = cms.config;
    const quill = await issueTokens(dataDir, QUILL, ISSUED);
    await recordUse(dataDir, quill.token, USED);

    const row = rowFor(await screen(agent), 'Quill');
    assert.match(row, /<a href="https:\/\/quill\.example\/">Quill<\/a>/);
    assert.match(row, /Create posts as you/);
    assert.match(row, /Upload media to your site/);
    assert.match(row, new RegExp(`<time datetime="${ISSUED.toISOString()}">`));
    assert.match(row, new RegExp(`<time datetime="${USED.toISOString()}">`));
    assert.match(row, new RegExp(`<time datetime="${quill.token.refreshExpiresAt}">`));
  });

  it('says a connection has not been used yet, and names a client with no name by its URL', async () => {
    const { cms, agent } = await site();
    const { clientName: _, ...nameless } = QUILL;
    await issueTokens(cms.config.dataDir, nameless, ISSUED);

    const row = rowFor(await screen(agent), 'https://quill.example/');
    assert.match(row, /Not yet/);
  });

  it('shows nobody else’s connections', async () => {
    const { cms, agent } = await site();
    const { dataDir } = cms.config;
    const bob = await createUser({ dataDir, username: 'bob', password: 'another horse battery' });
    await issueTokens(dataDir, QUILL, ISSUED);
    await issueTokens(dataDir, { ...QUILL, clientName: 'Bobs Reader', userId: bob.id }, ISSUED);

    const html = await screen(agent);
    assert.ok(html.includes('Quill'));
    assert.ok(!html.includes('Bobs Reader'), 'bob’s connection is not listed');
  });

  it('tells a user with no connections what connects here', async () => {
    const { agent } = await site();
    const html = await screen(agent);
    assert.ok(!html.includes('<table'), 'no empty table');
    assert.match(html, /No apps are connected/);
    assert.match(html, /Micropub/);
    assert.match(html, /MCP/);
  });

  it('meets the admin conventions: a caption, a labelled button per row, the menu marked', async () => {
    const { cms, agent } = await site();
    await issueTokens(cms.config.dataDir, QUILL, ISSUED);

    const html = await screen(agent);
    assert.match(html, /<caption[^>]*>Connected apps<\/caption>/);
    assert.match(html, /<button type="submit">Revoke Quill<\/button>/);
    assert.match(html, /<a href="\/admin\/users\/apps" aria-current="page">Connected apps<\/a>/);
  });

  it('is linked from your own user screen', async () => {
    const { agent } = await site();
    const html = await (await agent.get('/admin/users/1')).text();
    assert.match(html, /href="\/admin\/users\/apps"/);
  });
});

describe('revoking a connection', () => {
  async function introspect(cms: Cms, token: string): Promise<number> {
    const response = await cms.app.request('/_geekity/indieauth/introspect', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.status;
  }

  it('removes it, the next API request with its token gets 401, and the screen says so', async () => {
    const { cms, agent } = await site();
    const { dataDir } = cms.config;
    const now = new Date();
    const quill = await issueTokens(dataDir, QUILL, now);
    const other = await issueTokens(dataDir, { ...QUILL, clientName: 'Indigenous' }, now);
    assert.equal(await introspect(cms, quill.accessToken), 200);

    const csrf = csrfField(await screen(agent)) ?? '';
    const response = await agent.post(REVOKE, { csrf_token: csrf, connection: quill.token.id });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), SCREEN);

    assert.equal(await introspect(cms, quill.accessToken), 401);
    assert.deepEqual(
      listTokens(dataDir).map((token) => token.id),
      [other.token.id],
    );
    const html = await screen(agent);
    assert.match(html, /role="status">Quill can no longer act as you\.<\/p>/);
    assert.ok(!html.includes('Revoke Quill'));
  });

  it('cannot revoke somebody else’s connection', async () => {
    const { cms, agent } = await site();
    const { dataDir } = cms.config;
    const bob = await createUser({ dataDir, username: 'bob', password: 'another horse battery' });
    const bobs = await issueTokens(dataDir, { ...QUILL, userId: bob.id }, new Date());

    const csrf = csrfField(await screen(agent)) ?? '';
    await agent.post(REVOKE, { csrf_token: csrf, connection: bobs.token.id });

    assert.equal(listTokens(dataDir).length, 1);
    assert.match(await screen(agent), /That app was already disconnected\./);
  });

  it('refuses a revoke without the CSRF token', async () => {
    const { cms, agent } = await site();
    const quill = await issueTokens(cms.config.dataDir, QUILL, new Date());
    const response = await agent.post(REVOKE, { connection: quill.token.id });
    assert.equal(response.status, 403);
    assert.equal(listTokens(cms.config.dataDir).length, 1);
  });
});

describe('the list of apps allowed without PKCE (TASK-225)', () => {
  const ADD = '/admin/users/apps/without-pkce';
  const REMOVE = '/admin/users/apps/without-pkce/remove';
  const IA_WRITER = 'https://ia.net/writer';

  function listed(cms: Cms): readonly string[] {
    return readSiteSettings(cms.config.contentDir).clientsWithoutPkce;
  }

  async function add(agent: Browser, clientId: string): Promise<Response> {
    const csrf = csrfField(await screen(agent)) ?? '';
    return await agent.post(ADD, { csrf_token: csrf, client_id: clientId });
  }

  it('starts empty and says every app needs PKCE', async () => {
    const { cms, agent } = await site();
    const html = await screen(agent);
    assert.deepEqual(listed(cms), []);
    assert.match(html, /<h2[^>]*>Apps allowed without PKCE<\/h2>/);
    assert.match(html, /No apps are listed\. Every app must use PKCE to sign in\./);
  });

  it('adds a client_id, which the screen then lists with a Remove button', async () => {
    const { cms, agent } = await site();
    const response = await add(agent, ` ${IA_WRITER} `);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), SCREEN);
    assert.deepEqual(listed(cms), [IA_WRITER]);

    const html = await screen(agent);
    assert.match(html, /role="status">https:\/\/ia\.net\/writer may now sign in without PKCE\./);
    assert.match(html, /<button type="submit">Remove https:\/\/ia\.net\/writer<\/button>/);
  });

  it('refuses what is not a client_id, and one already listed, saving nothing', async () => {
    const { cms, agent } = await site();
    for (const value of [
      '',
      'ia.net/writer',
      'ftp://ia.net/',
      'https://ia.net/#x',
      'https://10.0.0.1/',
    ]) {
      const response = await add(agent, value);
      const html = await response.text();
      assert.equal(response.status, 400, value);
      assert.match(html, /Nothing was saved/);
      assert.match(html, /aria-invalid="true"/);
    }
    assert.deepEqual(listed(cms), []);

    await add(agent, IA_WRITER);
    const again = await add(agent, 'https://IA.net/writer');
    assert.equal(again.status, 400);
    assert.match(await again.text(), /already on the list/);
    assert.deepEqual(listed(cms), [IA_WRITER]);
  });

  it('removes a listed client_id', async () => {
    const { cms, agent } = await site();
    await add(agent, IA_WRITER);
    await add(agent, 'https://inklings.io/inkstone/');
    const csrf = csrfField(await screen(agent)) ?? '';
    const response = await agent.post(REMOVE, { csrf_token: csrf, client_id: IA_WRITER });
    assert.equal(response.status, 303);
    assert.deepEqual(listed(cms), ['https://inklings.io/inkstone/']);
    assert.match(await screen(agent), /https:\/\/ia\.net\/writer must use PKCE again\./);
  });

  it('keeps the list through a save of a settings page', async () => {
    const { cms, agent } = await site();
    await add(agent, IA_WRITER);
    const response = await saveSettings(agent, 'general', { title: 'Renamed' });
    assert.equal(response.status, 303);
    assert.equal(readSiteSettings(cms.config.contentDir).title, 'Renamed');
    assert.deepEqual(listed(cms), [IA_WRITER]);
  });

  it('refuses an add or a remove without the CSRF token', async () => {
    const { cms, agent } = await site();
    assert.equal((await agent.post(ADD, { client_id: IA_WRITER })).status, 403);
    assert.deepEqual(listed(cms), []);

    await add(agent, IA_WRITER);
    assert.equal((await agent.post(REMOVE, { client_id: IA_WRITER })).status, 403);
    assert.deepEqual(listed(cms), [IA_WRITER]);
  });
});

describe('creating a token (TASK-230)', () => {
  const CREATE = '/admin/users/apps/tokens';
  const MICROPUB = '/_geekity/micropub';
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function create(
    agent: Browser,
    fields: [string, string][] = [
      ['name', 'Publishing script'],
      ['scope', 'create'],
      ['expires', '30'],
    ],
  ): Promise<Response> {
    const csrf = csrfField(await screen(agent)) ?? '';
    return await agent.post(CREATE, [['csrf_token', csrf], ...fields]);
  }

  function shownToken(html: string): string {
    const match = /id="created-token"[^>]*value="([^"]+)"/.exec(html);
    assert.ok(match?.[1] !== undefined, 'the page shows the new token');
    return match[1];
  }

  async function micropub(cms: Cms, token: string, fields: Record<string, string>) {
    return await cms.app.request(MICROPUB, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    });
  }

  async function filesHolding(dir: string, secret: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      if ((await readFile(file)).includes(secret)) found.push(file);
    }
    return found;
  }

  it('shows the new token once, with no-store, and lists it by name after', async () => {
    const { cms, agent } = await site();
    const before = Date.now();
    const response = await create(agent);
    const html = await response.text();
    assert.equal(response.status, 200, html);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const token = shownToken(html);
    assert.match(html, /not be shown again/);

    const later = await screen(agent);
    assert.ok(!later.includes(token), 'the token is not shown a second time');
    const row = rowFor(later, 'Publishing script');
    assert.match(row, /Create posts as you/);
    assert.ok(!row.includes('Upload media'), 'only the scope chosen');
    assert.match(row, /<button type="submit">Revoke Publishing script<\/button>/);

    const [stored] = listTokens(cms.config.dataDir);
    assert.ok(stored?.kind === 'created');
    assert.equal(stored.userId, 1);
    assert.equal(stored.resource, BASE);
    assert.deepEqual(stored.scopes, ['create']);
    const lifetime = Date.parse(stored.expiresAt) - Date.parse(stored.issuedAt);
    assert.equal(lifetime, 30 * DAY_MS);
    assert.ok(Date.parse(stored.issuedAt) >= before - 1000);
  });

  it('posts to Micropub with exactly the scopes chosen, and its value is in no file', async () => {
    const { cms, agent } = await site();
    const token = shownToken(await (await create(agent)).text());

    const created = await micropub(cms, token, { h: 'entry', content: 'Posted by a script.' });
    assert.equal(created.status, 201, await created.clone().text());
    const url = created.headers.get('location') ?? '';
    const deleted = await micropub(cms, token, { action: 'delete', url });
    assert.equal(deleted.status, 403);
    assert.match(deleted.headers.get('www-authenticate') ?? '', /insufficient_scope/);

    assert.deepEqual(await filesHolding(cms.config.dataDir, token), []);
    assert.deepEqual(await filesHolding(cms.config.contentDir, token), []);
  });

  it('is introspected like an app’s token, and revoking it makes the next request 401', async () => {
    const { cms, agent } = await site();
    const token = shownToken(await (await create(agent)).text());
    const introspected = await cms.app.request('/_geekity/indieauth/introspect', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }).toString(),
    });
    const answer = (await introspected.json()) as Record<string, unknown>;
    assert.equal(answer['active'], true);
    assert.equal(answer['scope'], 'create');
    assert.equal(answer['client_id'], undefined);

    const [stored] = listTokens(cms.config.dataDir);
    const csrf = csrfField(await screen(agent)) ?? '';
    const revoked = await agent.post(REVOKE, { csrf_token: csrf, connection: stored?.id ?? '' });
    assert.equal(revoked.status, 303);
    assert.match(await screen(agent), /Publishing script can no longer act as you\./);

    const refused = await micropub(cms, token, { h: 'entry', content: 'Too late.' });
    assert.equal(refused.status, 401);
  });

  it('refuses a missing name, no scope or an unknown expiry, saving nothing', async () => {
    const { cms, agent } = await site();
    for (const fields of [
      [
        ['name', ' '],
        ['scope', 'create'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['scope', 'everything'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['scope', 'create'],
        ['expires', '3650'],
      ],
    ] as [string, string][][]) {
      const response = await create(agent, fields);
      const html = await response.text();
      assert.equal(response.status, 400, JSON.stringify(fields));
      assert.match(html, /Nothing was saved/);
      assert.match(html, /aria-invalid="true"/);
      assert.ok(!html.includes('id="created-token"'));
    }
    assert.deepEqual(listTokens(cms.config.dataDir), []);
  });

  it('refuses a create without the CSRF token', async () => {
    const { cms, agent } = await site();
    const response = await agent.post(CREATE, [
      ['name', 'Script'],
      ['scope', 'create'],
      ['expires', '30'],
    ]);
    assert.equal(response.status, 403);
    assert.deepEqual(listTokens(cms.config.dataDir), []);
  });
});
