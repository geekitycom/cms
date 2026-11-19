import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Scope } from '../indieauth/request.ts';
import type { Cms } from '../index.ts';
import { setUserProfile, usersFile } from '../site/users.ts';
import type { UserProfile } from '../site/users.ts';
import { BASE, call, fixtureSite, inspectToken, rpc } from './inspect/__testing__/fixture.ts';

const box = sandbox();

const NOW = new Date('2026-11-19T12:00:00.000Z');

const STORED: UserProfile = {
  displayName: 'Ada L.',
  givenName: 'Test',
  familyName: 'Value',
  bio: 'Counts things.',
  links: [{ label: 'Code', href: 'https://code.example/ada' }],
};

const sent: unknown[] = [];
const original = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith(`${BASE}/`)) return await original(input, init);
    if (request.method === 'POST') {
      sent.push((JSON.parse(await request.text()) as Record<string, unknown>)['type']);
      return new Response(null, { status: 202 });
    }
    return new Response('not here', { status: 404 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

beforeEach(() => {
  sent.length = 0;
});

async function profileSite(
  scopes: readonly Scope[] = ['update'],
): Promise<{ cms: Cms; token: string }> {
  const cms = await fixtureSite(box, {
    federation: { queue: null, allowPrivateAddress: true },
    now: () => NOW,
  });
  await setUserProfile({ dataDir: cms.config.dataDir, userId: 1, profile: STORED });
  return { cms, token: await inspectToken(cms, [...scopes]) };
}

async function storedUser(cms: Cms): Promise<Record<string, unknown>> {
  const file = JSON.parse(await readFile(usersFile(cms.config.dataDir), 'utf8')) as {
    users: Record<string, unknown>[];
  };
  const user = file.users[0];
  assert.ok(user !== undefined);
  return user;
}

describe('get_profile', () => {
  it('returns the token holder’s own profile and its version', async () => {
    const { cms, token } = await profileSite();

    const answer = await call(cms, token, 'get_profile');

    assert.equal(answer.isError, false, answer.text);
    const { version, ...profile } = answer.structured;
    assert.deepEqual(profile, { username: 'ada', ...STORED });
    assert.match(String(version), /^[0-9a-f]{64}$/);
  });

  it('gives a new version once the profile changes, and the same one until then', async () => {
    const { cms, token } = await profileSite();
    const first = (await call(cms, token, 'get_profile')).structured['version'];
    assert.equal((await call(cms, token, 'get_profile')).structured['version'], first);

    await call(cms, token, 'update_profile', { version: first, location: 'Madison' });

    assert.notEqual((await call(cms, token, 'get_profile')).structured['version'], first);
  });
});

describe('update_profile', () => {
  it('changes only the fields it is given and tells the followers', async () => {
    const { cms, token } = await profileSite();
    const { version } = (await call(cms, token, 'get_profile')).structured;

    const answer = await call(cms, token, 'update_profile', {
      version,
      givenName: '  Ada ',
      familyName: 'Lovelace',
    });
    await cms.delivery.settled();

    assert.equal(answer.isError, false, answer.text);
    assert.deepEqual((await storedUser(cms))['profile'], {
      ...STORED,
      givenName: 'Ada',
      familyName: 'Lovelace',
    });
    assert.equal(answer.structured['givenName'], 'Ada');
    assert.equal(
      answer.structured['version'],
      (await call(cms, token, 'get_profile')).structured['version'],
    );
    assert.ok(sent.includes('Update'), JSON.stringify(sent));
  });

  it('clears a field given as empty, and the links given an empty list', async () => {
    const { cms, token } = await profileSite();
    const { version } = (await call(cms, token, 'get_profile')).structured;

    const answer = await call(cms, token, 'update_profile', {
      version,
      givenName: '',
      familyName: '',
      links: [],
    });

    assert.equal(answer.isError, false, answer.text);
    assert.deepEqual((await storedUser(cms))['profile'], {
      displayName: 'Ada L.',
      bio: 'Counts things.',
    });
  });

  it('replaces the links whole, labelling a bare one with its URL', async () => {
    const { cms, token } = await profileSite();
    const { version } = (await call(cms, token, 'get_profile')).structured;

    await call(cms, token, 'update_profile', {
      version,
      links: [{ href: 'https://social.example/@ada', rel: 'ME' }],
    });

    assert.deepEqual((await storedUser(cms))['profile'], {
      ...STORED,
      links: [
        { label: 'https://social.example/@ada', href: 'https://social.example/@ada', rel: 'me' },
      ],
    });
  });

  it('refuses a stale version and leaves the profile as it is', async () => {
    const { cms, token } = await profileSite();
    const { version } = (await call(cms, token, 'get_profile')).structured;
    await call(cms, token, 'update_profile', { version, bio: 'Newer.' });

    const answer = await call(cms, token, 'update_profile', { version, bio: 'Older.' });

    assert.equal(answer.isError, true);
    assert.match(answer.text, /get_profile/);
    assert.equal(((await storedUser(cms))['profile'] as UserProfile).bio, 'Newer.');
  });

  it('refuses an avatar or link the admin form would refuse', async () => {
    const { cms, token } = await profileSite();
    const { version } = (await call(cms, token, 'get_profile')).structured;
    const before = await storedUser(cms);

    const avatar = await call(cms, token, 'update_profile', { version, avatar: 'not a url' });
    const link = await call(cms, token, 'update_profile', {
      version,
      links: [{ href: 'javascript:alert(1)' }],
    });

    assert.equal(avatar.isError, true);
    assert.match(avatar.text, /avatar/);
    assert.equal(link.isError, true);
    assert.match(link.text, /javascript:alert\(1\)/);
    assert.deepEqual(await storedUser(cms), before);
  });

  it('cannot change the username, password, role or email', async () => {
    const { cms, token } = await profileSite();
    const { version } = (await call(cms, token, 'get_profile')).structured;
    const before = await storedUser(cms);

    for (const field of ['username', 'password', 'passwordHash', 'role', 'email']) {
      const answer = await call(cms, token, 'update_profile', { version, [field]: 'mallory' });
      assert.equal(answer.isError, true, field);
    }
    assert.deepEqual(await storedUser(cms), before);
  });
});

describe('the profile tools', () => {
  it('need the update scope', async () => {
    const { cms, token } = await profileSite(['create', 'media', 'publish', 'inspect']);
    const before = await storedUser(cms);

    for (const [name, args] of [
      ['get_profile', {}],
      ['update_profile', { version: 'any', givenName: 'Mallory' }],
    ] as const) {
      const { status, body } = await rpc(cms, token, 'tools/call', { name, arguments: args });
      assert.equal(status, 403, name);
      assert.deepEqual((body['error'] as { data: unknown }).data, { scope: 'update' });
    }
    assert.deepEqual(await storedUser(cms), before);
  });
});
