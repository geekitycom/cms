import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveConfig } from '../config.ts';
import { HCAPTCHA } from '../settings/hcaptcha.ts';
import { createSettingsRegistry } from '../settings/registry.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import {
  createHcaptchaChallenge,
  HCAPTCHA_RESPONSE_FIELD,
  HCAPTCHA_SCRIPT_URL,
  HCAPTCHA_VERIFY_URL,
  verifyHcaptchaPair,
} from './hcaptcha.ts';
import type { ChallengeAttempt } from '../forms/challenge.ts';

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

/** One contact submission's answer, from a known address. */
function attempt(token: string): ChallengeAttempt {
  return { token, address: '203.0.113.9', type: 'contact-form' };
}

/** A challenge over `settings` that warns into `warnings`. */
function challengeOver(
  settings: SettingsRegistry,
  fetch: typeof globalThis.fetch,
  warnings: string[] = [],
): ReturnType<typeof createHcaptchaChallenge> {
  return createHcaptchaChallenge({
    settings,
    fetch,
    logger: {
      warn: (message) => {
        warnings.push(message);
      },
    },
  });
}

describe('the hCaptcha form challenge', () => {
  it('verifies a token with the secret, the token, the site key and the address (AC #2)', async () => {
    const { fetch: stubbed, calls } = stub(() => Response.json({ success: true }));
    const challenge = challengeOver(await paired('the-site-key', '0xthe-secret'), stubbed);

    assert.equal(await challenge.verify(attempt('a-solved-token')), 'pass');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, HCAPTCHA_VERIFY_URL);
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(calls[0]?.fields, {
      secret: '0xthe-secret',
      response: 'a-solved-token',
      sitekey: 'the-site-key',
      remoteip: '203.0.113.9',
    });
  });

  it('leaves the address out when the site could not tell where a request came from', async () => {
    const { fetch: stubbed, calls } = stub(() => Response.json({ success: true }));
    const challenge = challengeOver(await paired(), stubbed);

    await challenge.verify({ token: 'a-solved-token', address: undefined, type: 'comment' });
    assert.equal(calls[0]?.fields['remoteip'], undefined);
  });

  it('fails a submission with no token without asking anybody (AC #3)', async () => {
    const { fetch: stubbed, calls } = stub(() => Response.json({ success: true }));
    const challenge = challengeOver(await paired(), stubbed);

    assert.equal(await challenge.verify(attempt('')), 'fail');
    assert.equal(await challenge.verify(attempt('   ')), 'fail');
    assert.equal(calls.length, 0);
  });

  it('fails a token hCaptcha rejects (AC #3)', async () => {
    const { fetch: stubbed } = stub(() => refused('invalid-input-response'));
    const challenge = challengeOver(await paired(), stubbed);

    assert.equal(await challenge.verify(attempt('a-forged-token')), 'fail');
  });

  it('has no opinion when hCaptcha errors, times out or answers nonsense (AC #4)', async () => {
    const thrown = stub(() => {
      throw new TypeError('fetch failed');
    });
    const timedOut = stub(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    const failed = stub(() => new Response('oh dear', { status: 503 }));
    const garbled = stub(() => new Response('<html>', { status: 200 }));

    for (const { fetch: stubbed } of [thrown, timedOut, failed, garbled]) {
      const warnings: string[] = [];
      const challenge = challengeOver(await paired(), stubbed, warnings);
      assert.equal(await challenge.verify(attempt('a-solved-token')), 'unknown');
      assert.equal(warnings.length, 1, 'whoever runs the site can see it stopped working');
    }
  });

  it('gives up on an hCaptcha that does not answer in time (AC #4)', async () => {
    const hanging = (async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
      return Response.json({ success: true });
    }) as typeof fetch;
    const challenge = createHcaptchaChallenge({
      settings: await paired(),
      fetch: hanging,
      timeoutMs: 5,
      logger: { warn: () => undefined },
    });

    assert.equal(await challenge.verify(attempt('a-solved-token')), 'unknown');
  });

  it('has no opinion when hCaptcha says the pair itself is wrong', async () => {
    const { fetch: stubbed } = stub(() => refused('invalid-input-secret'));
    const warnings: string[] = [];
    const challenge = challengeOver(await paired(), stubbed, warnings);

    assert.equal(await challenge.verify(attempt('a-solved-token')), 'unknown');
    assert.equal(warnings.length, 1);
  });

  it('is off, asks nothing and draws nothing while either value is empty (AC #1)', async () => {
    const { fetch: stubbed, calls } = stub(() => Response.json({ success: true }));

    const none = challengeOver(await unpaired(), stubbed);
    assert.equal(await none.widget(), undefined);
    assert.equal(await none.verify(attempt('')), 'unknown');

    const half = await unpaired();
    await half.set('hcaptcha', new Map([['site_key', 'only-a-site-key']]), 'admin');
    const halfChallenge = challengeOver(half, stubbed);
    assert.equal(await halfChallenge.widget(), undefined);
    assert.equal(await halfChallenge.verify(attempt('a-solved-token')), 'unknown');

    assert.equal(calls.length, 0);
  });

  it('is off while the stored pair is one hCaptcha refused', async () => {
    const { fetch: stubbed, calls } = stub(() => Response.json({ success: true }));
    const settings = await paired();
    await settings.set('hcaptcha', new Map([['status', 'invalid']]), 'admin');
    const challenge = challengeOver(settings, stubbed);

    assert.equal(await challenge.widget(), undefined);
    assert.equal(await challenge.verify(attempt('')), 'unknown');
    assert.equal(calls.length, 0);
  });

  it('describes the widget a theme draws while it is on', async () => {
    const { fetch: stubbed } = stub(() => Response.json({ success: true }));
    const challenge = challengeOver(await paired('the-site-key'), stubbed);

    assert.equal(challenge.field, HCAPTCHA_RESPONSE_FIELD);
    assert.equal(HCAPTCHA_RESPONSE_FIELD, 'h-captcha-response');
    assert.deepEqual(await challenge.widget(), {
      provider: 'hcaptcha',
      siteKey: 'the-site-key',
      scriptUrl: HCAPTCHA_SCRIPT_URL,
      field: 'h-captcha-response',
    });
  });

  it('reads the pair on every call, so a change needs no restart (AC #8)', async () => {
    const { fetch: stubbed, calls } = stub(() => Response.json({ success: true }));
    const settings = await unpaired();
    const challenge = challengeOver(settings, stubbed);

    assert.equal(await challenge.verify(attempt('')), 'unknown');

    await settings.set(
      'hcaptcha',
      new Map([
        ['site_key', 'the-site-key'],
        ['secret', '0xthe-secret'],
      ]),
      'admin',
    );
    assert.equal(await challenge.verify(attempt('')), 'fail');
    assert.equal(await challenge.verify(attempt('a-solved-token')), 'pass');

    await settings.set(
      'hcaptcha',
      new Map([
        ['site_key', ''],
        ['secret', ''],
      ]),
      'admin',
    );
    assert.equal(await challenge.verify(attempt('')), 'unknown');
    assert.equal(calls.length, 1);
  });
});
