import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { settingsOver } from '../__testing__/settings.ts';
import type { Cms } from '../index.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import { writeSiteSettings } from '../__testing__/site-settings.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  DISCUSSION_SETTINGS,
  HCAPTCHA_FIELDS,
  HCAPTCHA_PATH,
  HCAPTCHA_REMOVE,
  HCAPTCHA_VERIFY,
} from './settings-discussion.ts';

/**
 * The hCaptcha site key and secret on Settings > Discussion.
 *
 * siteverify is a stub here: what is under test is that the pair is checked
 * when it is saved, that it lands in `data/` at 0600 and nowhere near
 * `site.json`, that the secret is never printed back, and that a pair the
 * environment sets is shown as set elsewhere.
 */

const SETTINGS_PATH = DISCUSSION_SETTINGS.path;
const SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';
const SECRET = '0xstored-secret-q7z9';
const NOW = new Date('2026-10-28T12:00:00.000Z');

const box = sandbox();

/** The form fields of every siteverify call the stub saw. */
let verified: Record<string, string>[] = [];
/** The error codes the stub answers with, or `undefined` for a machine offline. */
let answer: string[] | undefined;

const restoreFetch = stubSiteverify();

after(async () => {
  restoreFetch();
  await box.cleanup();
});

beforeEach(() => {
  verified = [];
  answer = ['invalid-input-response'];
});

function stubSiteverify(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== 'https://api.hcaptcha.com/siteverify') {
      return Promise.resolve(new Response('missing', { status: 404 }));
    }

    const body = init?.body;
    verified.push(
      Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : '').entries()),
    );
    if (answer === undefined) return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(Response.json({ success: false, 'error-codes': answer }));
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

async function admin(): Promise<{ cms: Cms; agent: Browser; contentDir: string; dataDir: string }> {
  const contentDir = await box.dir('geekity-hcaptcha-admin-content-');
  const dataDir = await box.dir('geekity-hcaptcha-admin-data-');
  await writeSiteSettings({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, base_url: 'https://blog.example' },
  });

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => NOW,
  });
  return { cms, agent: await signedIn(cms), contentDir, dataDir };
}

/** Submit the hCaptcha form on the settings screen, and read the screen after. */
async function submit(
  agent: Browser,
  fields: Record<string, string>,
): Promise<{ response: Response; screen: string }> {
  const token = csrfField(await (await agent.get(SETTINGS_PATH)).text());
  assert.ok(token !== undefined, 'the settings screen carried a CSRF token');

  const response = await agent.post(HCAPTCHA_PATH, { csrf_token: token, ...fields });
  return { response, screen: await (await agent.get(SETTINGS_PATH)).text() };
}

function pairFile(dataDir: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, 'hcaptcha.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

async function storePair(dataDir: string): Promise<void> {
  await settingsOver({ dataDir }).set(
    'hcaptcha',
    new Map<string, unknown>([
      ['site_key', SITE_KEY],
      ['secret', SECRET],
      ['status', 'valid'],
      ['checked_at', '2026-10-27T00:00:00.000Z'],
    ]),
    'admin',
  );
}

async function withEnv<T>(values: Record<string, string>, body: () => Promise<T>): Promise<T> {
  Object.assign(process.env, values);
  try {
    return await body();
  } finally {
    for (const name of Object.keys(values)) delete process.env[name];
  }
}

describe('hCaptcha on the Discussion settings screen', () => {
  it('says no form is challenged until a pair is saved', async () => {
    const { agent } = await admin();

    const html = await (await agent.get(SETTINGS_PATH)).text();
    assert.match(html, /<h2[^>]*>[^<]*hCaptcha/);
    assert.match(html, /Not connected/);
    assert.ok(html.includes(`name="${HCAPTCHA_FIELDS.siteKey}"`));
    assert.ok(html.includes(`name="${HCAPTCHA_FIELDS.secret}"`));
  });

  it('saves both values under data/ at 0600, checks them, and never prints the secret (AC #3, #4)', async () => {
    const { agent, dataDir, contentDir } = await admin();

    const { response, screen } = await submit(agent, {
      [HCAPTCHA_FIELDS.siteKey]: ` ${SITE_KEY} `,
      [HCAPTCHA_FIELDS.secret]: ` ${SECRET} `,
    });

    assert.equal(response.status, 303);
    assert.deepEqual(verified, [
      { secret: SECRET, response: verified[0]?.['response'] ?? '', sitekey: SITE_KEY },
    ]);
    assert.deepEqual(pairFile(dataDir), {
      site_key: SITE_KEY,
      secret: SECRET,
      status: 'valid',
      checked_at: NOW.toISOString(),
    });
    assert.equal(statSync(path.join(dataDir, 'hcaptcha.json')).mode & 0o777, 0o600);

    const site = await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8');
    assert.ok(!site.includes(SECRET) && !site.includes(SITE_KEY));

    assert.match(screen, /Connected/);
    assert.match(screen, /hCaptcha took the site key/);
    assert.ok(screen.includes(SITE_KEY), 'the site key, which every form page prints, is shown');
    assert.ok(!screen.includes(SECRET), 'the secret is never printed back');
    assert.ok(!screen.includes(SECRET.slice(-4)), 'not even the end of it');
  });

  it('still saves a pair hCaptcha refuses, and says so (AC #4)', async () => {
    answer = ['invalid-input-response', 'invalid-sitekey'];
    const { agent, dataDir } = await admin();

    const { screen } = await submit(agent, {
      [HCAPTCHA_FIELDS.siteKey]: 'not-a-site-key',
      [HCAPTCHA_FIELDS.secret]: SECRET,
    });

    assert.equal(pairFile(dataDir)?.['site_key'], 'not-a-site-key');
    assert.equal(pairFile(dataDir)?.['status'], 'invalid');
    assert.match(screen, /hCaptcha refused/);
    assert.match(screen, /no form is challenged until/, 'a refused pair turns the challenge off');
  });

  it('still saves a pair it could not check, and says that instead (AC #4)', async () => {
    answer = undefined;
    const { agent, dataDir } = await admin();

    const { screen } = await submit(agent, {
      [HCAPTCHA_FIELDS.siteKey]: SITE_KEY,
      [HCAPTCHA_FIELDS.secret]: SECRET,
    });

    assert.equal(pairFile(dataDir)?.['status'], 'unchecked');
    assert.match(screen, /could not be reached/);
  });

  it('keeps the stored secret when the secret box is left blank (AC #3)', async () => {
    const { agent, dataDir } = await admin();
    await storePair(dataDir);

    const shown = await (await agent.get(SETTINGS_PATH)).text();
    assert.ok(!shown.includes(SECRET), 'the stored secret is not in the page');
    assert.match(shown, /value=""[^>]*name="hcaptcha_secret"|name="hcaptcha_secret"[^>]*value=""/);

    await submit(agent, {
      [HCAPTCHA_FIELDS.siteKey]: '20000000-ffff-ffff-ffff-000000000002',
      [HCAPTCHA_FIELDS.secret]: '',
    });

    assert.equal(pairFile(dataDir)?.['site_key'], '20000000-ffff-ffff-ffff-000000000002');
    assert.equal(pairFile(dataDir)?.['secret'], SECRET);
    assert.equal(verified[0]?.['secret'], SECRET);
  });

  it('refuses a pair with an empty site key or no secret at all, storing nothing', async () => {
    const { agent, dataDir } = await admin();

    const noSiteKey = await submit(agent, {
      [HCAPTCHA_FIELDS.siteKey]: '  ',
      [HCAPTCHA_FIELDS.secret]: SECRET,
    });
    assert.match(noSiteKey.screen, /site key cannot be empty/i);

    const noSecret = await submit(agent, {
      [HCAPTCHA_FIELDS.siteKey]: SITE_KEY,
      [HCAPTCHA_FIELDS.secret]: '',
    });
    assert.match(noSecret.screen, /secret cannot be empty/i);

    assert.equal(pairFile(dataDir), undefined);
    assert.deepEqual(verified, []);
  });

  it('removes both values when asked (AC #3)', async () => {
    const { agent, dataDir } = await admin();
    await storePair(dataDir);

    const { screen } = await submit(agent, { [HCAPTCHA_FIELDS.action]: HCAPTCHA_REMOVE });

    assert.deepEqual(pairFile(dataDir), {});
    assert.match(screen, /hCaptcha site key and secret are gone/);
    assert.match(screen, /Not connected/);
  });

  it('checks the stored pair again when asked', async () => {
    answer = ['sitekey-secret-mismatch'];
    const { agent, dataDir } = await admin();
    await storePair(dataDir);

    const { screen } = await submit(agent, { [HCAPTCHA_FIELDS.action]: HCAPTCHA_VERIFY });

    assert.equal(verified[0]?.['secret'], SECRET);
    assert.equal(pairFile(dataDir)?.['status'], 'invalid');
    assert.equal(pairFile(dataDir)?.['checked_at'], NOW.toISOString());
    assert.match(screen, /hCaptcha refused/);
  });

  it('shows values the environment sets as set by it, and refuses to store one over them (AC #2)', async () => {
    await withEnv(
      {
        GEEKITY_HCAPTCHA__SITE_KEY: 'env-site-key',
        GEEKITY_HCAPTCHA__SECRET: 'env-secret-value',
      },
      async () => {
        const { agent, dataDir } = await admin();

        const shown = await (await agent.get(SETTINGS_PATH)).text();
        assert.match(shown, /set by <code>GEEKITY_HCAPTCHA__SITE_KEY<\/code>/);
        assert.match(shown, /set by <code>GEEKITY_HCAPTCHA__SECRET<\/code>/);
        assert.ok(!shown.includes('env-secret-value'), 'the screen never prints the secret');
        assert.ok(!shown.includes(`name="${HCAPTCHA_FIELDS.secret}"`), 'no box to type over it');
        assert.ok(!shown.includes(`name="${HCAPTCHA_FIELDS.siteKey}"`));

        const { screen } = await submit(agent, {
          [HCAPTCHA_FIELDS.siteKey]: 'typed-site-key',
          [HCAPTCHA_FIELDS.secret]: 'typed-secret',
        });
        assert.match(screen, /hcaptcha\.site_key is set by GEEKITY_HCAPTCHA__SITE_KEY/);
        assert.equal(pairFile(dataDir), undefined);
        assert.deepEqual(verified, [], 'a refused pair is not sent to hCaptcha');

        const checked = await submit(agent, { [HCAPTCHA_FIELDS.action]: HCAPTCHA_VERIFY });
        assert.equal(verified[0]?.['secret'], 'env-secret-value');
        assert.equal(verified[0]?.['sitekey'], 'env-site-key');
        assert.match(checked.screen, /hCaptcha took the site key/);
        assert.ok(!JSON.stringify(pairFile(dataDir)).includes('env-secret-value'));
      },
    );
  });

  it('takes a secret typed beside a site key the environment sets', async () => {
    await withEnv({ GEEKITY_HCAPTCHA__SITE_KEY: 'env-site-key' }, async () => {
      const { agent, dataDir } = await admin();

      const shown = await (await agent.get(SETTINGS_PATH)).text();
      assert.match(shown, /set by <code>GEEKITY_HCAPTCHA__SITE_KEY<\/code>/);
      assert.ok(shown.includes(`name="${HCAPTCHA_FIELDS.secret}"`));

      await submit(agent, { [HCAPTCHA_FIELDS.secret]: SECRET });

      assert.equal(pairFile(dataDir)?.['secret'], SECRET);
      assert.equal(pairFile(dataDir)?.['site_key'], undefined);
      assert.equal(verified[0]?.['sitekey'], 'env-site-key');
    });
  });
});
