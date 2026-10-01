/**
 * Users > Connected apps (TASK-162): the apps that hold a token for the
 * signed-in person, and the button that cuts one off.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
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
  codeChallenge: 'unused',
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
