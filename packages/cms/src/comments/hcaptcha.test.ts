import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveConfig } from '../config.ts';
import { HCAPTCHA } from '../settings/hcaptcha.ts';
import { createSettingsRegistry } from '../settings/registry.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { HCAPTCHA_VERIFY_URL, verifyHcaptchaPair } from './hcaptcha.ts';

/**
 * The hCaptcha pair check, against a stub of siteverify.
 *
 * Nothing here reaches the network: every test hands the module a `fetch` of
 * its own and reads the request it was given.
 */

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function unpaired(env: Record<string, string> = {}): Promise<SettingsRegistry> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-hcaptcha-'));
  dirs.push(dataDir);
  return createSettingsRegistry({ config: resolveConfig({ dataDir }, { env }), env });
}

async function paired(
  siteKey = 'the-site-key',
  secret = '0xthe-secret',
): Promise<SettingsRegistry> {
  const settings = await unpaired();
  await settings.set(
    'hcaptcha',
    new Map([
      ['site_key', siteKey],
      ['secret', secret],
    ]),
    'admin',
  );
  return settings;
}

const CHECKED_AT = new Date('2026-10-28T12:00:00.000Z');

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  fields: Record<string, string>;
}

function stub(reply: (call: Call) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    for (const [name, value] of new Headers(init?.headers).entries()) headers[name] = value;
    const body = init?.body;
    const fields: Record<string, string> = {};
    for (const [name, value] of new URLSearchParams(
      typeof body === 'string' ? body : '',
    ).entries()) {
      fields[name] = value;
    }

    const call: Call = { url, method: init?.method ?? 'GET', headers, fields };
    calls.push(call);
    return await reply(call);
  }) as typeof fetch;

  return { fetch: impl, calls };
}

/** What siteverify answers a token it cannot use, with the error codes given. */
function refused(...codes: string[]): Response {
  return Response.json({ success: false, 'error-codes': codes });
}

async function check(
  settings: SettingsRegistry,
  fetch: typeof globalThis.fetch,
): Promise<string | undefined> {
  return await verifyHcaptchaPair({ settings, at: CHECKED_AT, by: 'admin', fetch });
}

describe('checking an hCaptcha site key and secret', () => {
  it('posts the secret, a placeholder token and the site key to siteverify (AC #4)', async () => {
    const { fetch: stubbed, calls } = stub(() => refused('invalid-input-response'));

    const settings = await paired('the-site-key', '0xthe-secret');
    const status = await check(settings, stubbed);

    assert.equal(status, 'valid');
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call?.url, HCAPTCHA_VERIFY_URL);
    assert.equal(call?.url, 'https://api.hcaptcha.com/siteverify');
    assert.equal(call?.method, 'POST');
    assert.match(call?.headers['content-type'] ?? '', /application\/x-www-form-urlencoded/);
    assert.equal(call?.fields['secret'], '0xthe-secret');
    assert.equal(call?.fields['sitekey'], 'the-site-key');
    assert.ok((call?.fields['response'] ?? '') !== '', 'a placeholder token is sent');
    assert.deepEqual(await settings.values(HCAPTCHA), {
      site_key: 'the-site-key',
      secret: '0xthe-secret',
      status: 'valid',
      checked_at: CHECKED_AT.toISOString(),
    });
  });

  for (const code of [
    'invalid-sitekey',
    'invalid-input-secret',
    'missing-input-secret',
    'sitekey-secret-mismatch',
  ]) {
    it(`reports the pair as refused when siteverify answers ${code} (AC #4)`, async () => {
      const { fetch: stubbed } = stub(() => refused('invalid-input-response', code));
      const settings = await paired();

      assert.equal(await check(settings, stubbed), 'invalid');
      assert.equal(await settings.get(HCAPTCHA.status), 'invalid');
    });
  }

  it('reports a pair it could not check rather than guessing (AC #4)', async () => {
    const { fetch: stubbed } = stub(() => {
      throw new TypeError('fetch failed');
    });
    const settings = await paired();

    assert.equal(await check(settings, stubbed), 'unchecked');
    assert.equal(await settings.get(HCAPTCHA.status), 'unchecked');
    assert.equal(await settings.get(HCAPTCHA.checked_at), CHECKED_AT.toISOString());
  });

  it('treats a 500 or an answer that is not JSON as unchecked too (AC #4)', async () => {
    const failed = stub(() => new Response('oh dear', { status: 500 }));
    assert.equal(await check(await paired(), failed.fetch), 'unchecked');

    const garbled = stub(() => new Response('<html>', { status: 200 }));
    assert.equal(await check(await paired(), garbled.fetch), 'unchecked');
  });

  it('asks nothing while the site key or the secret is empty', async () => {
    const { fetch: stubbed, calls } = stub(() => refused('invalid-input-response'));

    assert.equal(await check(await unpaired(), stubbed), undefined);
    const halfPaired = await unpaired();
    await halfPaired.set('hcaptcha', new Map([['site_key', 'only-a-site-key']]), 'admin');
    assert.equal(await check(halfPaired, stubbed), undefined);
    assert.equal(calls.length, 0);
  });

  it('checks the values the environment sets', async () => {
    const { fetch: stubbed, calls } = stub(() => refused('invalid-input-response'));
    const settings = await unpaired({
      GEEKITY_HCAPTCHA__SITE_KEY: 'env-site-key',
      GEEKITY_HCAPTCHA__SECRET: 'env-secret',
    });

    assert.equal(await check(settings, stubbed), 'valid');
    assert.equal(calls[0]?.fields['secret'], 'env-secret');
    assert.equal(calls[0]?.fields['sitekey'], 'env-site-key');
  });
});
