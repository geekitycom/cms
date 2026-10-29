import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Scope } from '../indieauth/request.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';
import { writeSignInUsers } from '../site/__testing__/users.ts';
import { findUser } from '../site/users.ts';
import type { User } from '../site/users.ts';
import { readWritingLedger } from '../writing/ledger.ts';

remoteHostsDoNotExist();

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-10-23T12:00:00.000Z');
const TODAY = '2026-10-23';
const ALL: Scope[] = ['create', 'update'];

async function site(): Promise<{ cms: Cms; grace: User; token: string }> {
  const dataDir = await box.dir('geekity-micropub-writing-data-');
  writeSignInUsers(dataDir, ['grace']);
  const cms = await box.site({ dataDir, baseUrl: BASE, now: () => NOW });
  const grace = findUser(dataDir, 'grace');
  assert.ok(grace !== undefined);
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: grace.id,
      me: `${BASE}/author/grace/`,
      scopes: ALL,
    },
    NOW,
  );
  return { cms, grace, token: accessToken };
}

async function postJson(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Micropub and the writing ledger', () => {
  it("credits a create's whole body to the token's user and no one else", async () => {
    const { cms, grace, token } = await site();

    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Five words in this note.'] },
    });

    assert.equal(response.status, 201, await response.clone().text());
    assert.deepEqual(readWritingLedger(cms.config.dataDir, grace.id).days, { [TODAY]: 5 });
    assert.deepEqual(readWritingLedger(cms.config.dataDir, 1).days, {});
  });

  it('credits an update only with the words it adds', async () => {
    const { cms, grace, token } = await site();
    const created = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Three words here.'] },
    });
    const url = created.headers.get('location');
    assert.ok(url !== null);

    const updated = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { content: ['Three words here, and two.'] },
    });
    assert.ok(updated.status === 204 || updated.status === 201, await updated.clone().text());
    const shrunk = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { content: ['Three.'] },
    });
    assert.ok(shrunk.status === 204 || shrunk.status === 201, await shrunk.clone().text());

    assert.deepEqual(readWritingLedger(cms.config.dataDir, grace.id).days, { [TODAY]: 5 });
  });
});
