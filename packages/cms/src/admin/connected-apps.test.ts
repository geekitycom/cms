/**
 * Users > Connected apps (TASK-162): the apps that hold a token for the
 * signed-in person, and the button that cuts one off.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { flashes } from './__testing__/flash.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import type { Cms } from '../index.ts';
import { addUser } from './__testing__/users.ts';
import type { AuthorizationCode } from '../indieauth/grants.ts';
import { issueTokens, listTokens, recordUse } from '../indieauth/tokens.ts';
import { siteSettingsIn } from '../__testing__/site-settings.ts';

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
    assert.match(row, /<a\b[^>]*href="https:\/\/quill\.example\/">Quill<\/a>/);
    assert.match(row, /Create posts as you/);
    assert.match(row, /Upload media to your site/);
    assert.match(row, new RegExp(`<time datetime="${ISSUED.toISOString()}">`));
    assert.match(row, new RegExp(`<time datetime="${USED.toISOString()}">`));
    assert.match(row, new RegExp(`<time datetime="${quill.token.refreshExpiresAt}">`));
  });

  it('names the MCP scopes a connection holds', async () => {
    const { cms, agent } = await site();
    await issueTokens(
      cms.config.dataDir,
      {
        ...QUILL,
        clientId: 'https://claude.example/client.json',
        clientName: 'Claude Code',
        scopes: ['inspect', 'repair', 'publish'],
        resource: `${BASE}/_geekity/mcp`,
      },
      ISSUED,
    );
    const row = rowFor(await screen(agent), 'Claude Code');
    assert.match(row, /Read your site’s federation and delivery records/);
    assert.match(row, /Resend posts and retry federation deliveries/);
    assert.match(row, /Publish drafts and change published posts/);
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
    const bob = addUser({ dataDir, username: 'bob', password: 'another horse battery' });
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
    assert.match(html, /<button type="submit"[^>]*>Revoke Quill<\/button>/);
    assert.match(
      html,
      /<a\b[^>]*href="\/admin\/users\/apps" aria-current="page">Connected apps<\/a>/,
    );
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
    assert.deepEqual(flashes(html), [
      { kind: 'notice', message: 'Quill can no longer act as you.' },
    ]);
    assert.ok(!html.includes('Revoke Quill'));
  });

  it('cannot revoke somebody else’s connection', async () => {
    const { cms, agent } = await site();
    const { dataDir } = cms.config;
    const bob = addUser({ dataDir, username: 'bob', password: 'another horse battery' });
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

  async function listed(cms: Cms): Promise<readonly string[]> {
    return (await siteSettingsIn(cms.config.contentDir)).clients_without_pkce;
  }

  async function add(agent: Browser, clientId: string): Promise<Response> {
    const csrf = csrfField(await screen(agent)) ?? '';
    return await agent.post(ADD, { csrf_token: csrf, client_id: clientId });
  }

  it('starts empty and says every app needs PKCE', async () => {
    const { cms, agent } = await site();
    const html = await screen(agent);
    assert.deepEqual(await listed(cms), []);
    assert.match(html, /<h2[^>]*>Apps allowed without PKCE<\/h2>/);
    assert.match(html, /No apps are listed\. Every app must use PKCE to sign in\./);
  });

  it('adds a client_id, which the screen then lists with a Remove button', async () => {
    const { cms, agent } = await site();
    const response = await add(agent, ` ${IA_WRITER} `);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), SCREEN);
    assert.deepEqual(await listed(cms), [IA_WRITER]);

    const html = await screen(agent);
    assert.match(
      flashes(html)[0]?.message ?? '',
      /^https:\/\/ia\.net\/writer may now sign in without PKCE\./,
    );
    assert.match(html, /<button type="submit"[^>]*>Remove https:\/\/ia\.net\/writer<\/button>/);
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
    assert.deepEqual(await listed(cms), []);

    await add(agent, IA_WRITER);
    const again = await add(agent, 'https://IA.net/writer');
    assert.equal(again.status, 400);
    assert.match(await again.text(), /already on the list/);
    assert.deepEqual(await listed(cms), [IA_WRITER]);
  });

  it('removes a listed client_id', async () => {
    const { cms, agent } = await site();
    await add(agent, IA_WRITER);
    await add(agent, 'https://inklings.io/inkstone/');
    const csrf = csrfField(await screen(agent)) ?? '';
    const response = await agent.post(REMOVE, { csrf_token: csrf, client_id: IA_WRITER });
    assert.equal(response.status, 303);
    assert.deepEqual(await listed(cms), ['https://inklings.io/inkstone/']);
    assert.match(await screen(agent), /https:\/\/ia\.net\/writer must use PKCE again\./);
  });

  it('keeps the list through a save of a settings page', async () => {
    const { cms, agent } = await site();
    await add(agent, IA_WRITER);
    const response = await saveSettings(agent, 'general', { title: 'Renamed' });
    assert.equal(response.status, 303);
    assert.equal((await siteSettingsIn(cms.config.contentDir)).title, 'Renamed');
    assert.deepEqual(await listed(cms), [IA_WRITER]);
  });

  it('refuses an add or a remove without the CSRF token', async () => {
    const { cms, agent } = await site();
    assert.equal((await agent.post(ADD, { client_id: IA_WRITER })).status, 403);
    assert.deepEqual(await listed(cms), []);

    await add(agent, IA_WRITER);
    assert.equal((await agent.post(REMOVE, { client_id: IA_WRITER })).status, 403);
    assert.deepEqual(await listed(cms), [IA_WRITER]);
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
      ['resource', 'micropub'],
      ['micropub_scope', 'create'],
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

  it('asks which resource the token is for, Micropub first, and offers the scopes each takes', async () => {
    const { agent } = await site();
    const html = await screen(agent);
    assert.match(html, /<input[^>]*type="radio" name="resource" value="micropub"[^>]*checked/);
    assert.match(html, /<input[^>]*type="radio" name="resource" value="mcp"/);
    assert.doesNotMatch(html, /name="resource" value="mcp"[^>]*checked/);
    const offered = (field: string) =>
      [...html.matchAll(new RegExp(`<input[^>]*name="${field}"[^>]*value="([a-z]+)"`, 'g'))].map(
        ([, scope]) => scope,
      );
    assert.deepEqual(offered('micropub_scope'), [
      'profile',
      'email',
      'create',
      'update',
      'delete',
      'media',
    ]);
    assert.deepEqual(offered('mcp_scope'), [
      'profile',
      'create',
      'update',
      'media',
      'publish',
      'inspect',
      'repair',
    ]);
  });

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
    assert.match(row, /For Micropub/);
    assert.match(row, /Create posts as you/);
    assert.ok(!row.includes('Upload media'), 'only the scope chosen');
    assert.match(row, /<button type="submit"[^>]*>Revoke Publishing script<\/button>/);

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
    assert.equal(deleted.status, 401);
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

  it('refuses a missing name, no scope, an unknown resource, a scope the resource does not take or an unknown expiry, saving nothing', async () => {
    const { cms, agent } = await site();
    for (const fields of [
      [
        ['name', ' '],
        ['resource', 'micropub'],
        ['micropub_scope', 'create'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['resource', 'micropub'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['resource', 'micropub'],
        ['micropub_scope', 'everything'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['resource', 'webmention'],
        ['micropub_scope', 'create'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['resource', 'micropub'],
        ['micropub_scope', 'inspect'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['resource', 'mcp'],
        ['mcp_scope', 'email'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['resource', 'mcp'],
        ['micropub_scope', 'create'],
        ['expires', '30'],
      ],
      [
        ['name', 'Script'],
        ['resource', 'micropub'],
        ['micropub_scope', 'create'],
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

  it('keeps MCP chosen, and the MCP scopes ticked, on a refused form', async () => {
    const { agent } = await site();
    const response = await create(agent, [
      ['name', ''],
      ['resource', 'mcp'],
      ['mcp_scope', 'inspect'],
      ['expires', '30'],
    ]);
    const html = await response.text();
    assert.equal(response.status, 400);
    assert.match(html, /name="resource" value="mcp"[^>]*checked/);
    assert.doesNotMatch(html, /name="resource" value="micropub"[^>]*checked/);
    assert.match(html, /<input[^>]*name="mcp_scope" type="checkbox" value="inspect" checked/);
  });

  async function whoami(cms: Cms, token: string): Promise<Response> {
    return await cms.app.request('/_geekity/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      }),
    });
  }

  it('binds a token created for MCP to the MCP endpoint, which takes it, and Micropub refuses it', async () => {
    const { cms, agent } = await site();
    const token = shownToken(
      await (
        await create(agent, [
          ['name', 'Claude Code'],
          ['resource', 'mcp'],
          ['mcp_scope', 'profile'],
          ['mcp_scope', 'inspect'],
          ['expires', '30'],
        ])
      ).text(),
    );

    const [stored] = listTokens(cms.config.dataDir);
    assert.equal(stored?.resource, `${BASE}/_geekity/mcp`);
    assert.deepEqual(stored?.scopes, ['profile', 'inspect']);

    const called = await whoami(cms, token);
    const answer = (await called.json()) as {
      result?: { structuredContent?: { client?: string } };
    };
    assert.equal(called.status, 200, JSON.stringify(answer));
    assert.equal(answer.result?.structuredContent?.client, 'Claude Code');

    const posted = await micropub(cms, token, { h: 'entry', content: 'Not with this token.' });
    assert.equal(posted.status, 401);

    const row = rowFor(await screen(agent), 'Claude Code');
    assert.match(row, /For MCP/);
    assert.match(row, /Read your site’s federation and delivery records/);
  });

  it('has the MCP endpoint refuse a token created for Micropub', async () => {
    const { cms, agent } = await site();
    const token = shownToken(
      await (
        await create(agent, [
          ['name', 'Publishing script'],
          ['resource', 'micropub'],
          ['micropub_scope', 'profile'],
          ['expires', '30'],
        ])
      ).text(),
    );
    const called = await whoami(cms, token);
    assert.equal(called.status, 401);
  });

  it('refuses a create without the CSRF token', async () => {
    const { cms, agent } = await site();
    const response = await agent.post(CREATE, [
      ['name', 'Script'],
      ['resource', 'micropub'],
      ['micropub_scope', 'create'],
      ['expires', '30'],
    ]);
    assert.equal(response.status, 403);
    assert.deepEqual(listTokens(cms.config.dataDir), []);
  });
});
