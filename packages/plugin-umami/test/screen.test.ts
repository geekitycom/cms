import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import umami from '../src/index.ts';
import { fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';
import { closeSites, flashes, pluginFolder, SCREEN, signIn, umamiSite } from './site.ts';

/**
 * The plugin's screen: the API settings and Check connection, through the
 * site's own `host.fetch`, against a fake Umami on loopback in both modes.
 */

let fake: FakeUmami;

before(async () => {
  fake = await fakeUmami();
});
after(async () => {
  await closeSites();
  await fake.close();
});
beforeEach(() => {
  fake.received.length = 0;
  fake.logins = 0;
  fake.refuseAllTokens(false);
});

interface Setup {
  settings: Record<string, string>;
  secrets: Record<string, string>;
}

function cloud(): Setup {
  return {
    settings: {
      umami_url: 'https://cloud.umami.is',
      website_id: WEBSITE.id,
      api_mode: 'cloud',
      api_url: fake.cloudBase,
    },
    secrets: { api_key: fake.apiKey },
  };
}

function selfHosted(): Setup {
  return {
    settings: {
      umami_url: fake.origin,
      website_id: WEBSITE.id,
      api_mode: 'self-hosted',
      username: fake.username,
    },
    secrets: { password: fake.password },
  };
}

async function check(options: Setup): Promise<{ flash: string; html: string }> {
  const cms = await umamiSite(umami, options);
  const admin = await signIn(cms);
  const pressed = await admin.post(SCREEN, { action: 'check-connection' });
  assert.equal(pressed.status, 303);
  const html = await (await admin.get(SCREEN)).text();
  const [flash = ''] = flashes(html);
  return { flash, html };
}

const HOST = () => new URL(fake.origin).host;

describe('the Umami screen', () => {
  it('has the mode, the API key, the username, the password and the API URL', async () => {
    const cms = await umamiSite(umami);
    const html = await (await (await signIn(cms)).get(SCREEN)).text();
    assert.match(html, /<h1[^>]*>Umami<\/h1>/);
    assert.match(html, /Umami Cloud, with an API key/);
    assert.match(html, /Self-hosted Umami, with a username and password/);
    for (const name of ['API_MODE', 'API_KEY', 'USERNAME', 'PASSWORD', 'API_URL']) {
      assert.match(html, new RegExp(`<code>GEEKITY_PLUGIN_UMAMI__${name}</code>`));
    }
    assert.match(html, /<button[^>]*>\s*Check connection/);
    assert.match(html, /Set the website ID and the API key/);
  });

  it('keeps the API key and the password in secrets.json, never on the page', async () => {
    const cms = await umamiSite(umami);
    const admin = await signIn(cms);
    const saved = await admin.post(SCREEN, {
      action: 'save',
      'setting.api_mode': 'self-hosted',
      'setting.umami_url': fake.origin,
      'setting.website_id': WEBSITE.id,
      'setting.username': fake.username,
      'setting.password': fake.password,
      'setting.api_key': fake.apiKey,
    });
    assert.equal(saved.status, 303);

    const secrets = path.join(pluginFolder(cms), 'secrets.json');
    assert.equal(statSync(secrets).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(secrets, 'utf8')), {
      api_key: fake.apiKey,
      password: fake.password,
    });
    const settings = readFileSync(path.join(pluginFolder(cms), 'settings.json'), 'utf8');
    assert.ok(!settings.includes(fake.password) && !settings.includes(fake.apiKey));

    const html = await (await admin.get(SCREEN)).text();
    assert.ok(!html.includes(fake.password), 'the password is never drawn');
    assert.ok(!html.includes(fake.apiKey), 'the API key is never drawn');
    assert.match(html, new RegExp(`as the user <code>${fake.username}</code>`));
  });

  it('checks Umami Cloud with the API key and names the website it found', async () => {
    const { flash, html } = await check(cloud());
    assert.equal(flash, `Umami answered at ${HOST()}. It has the website Geekity (example.com).`);
    assert.ok(!html.includes(fake.apiKey));
    const [sent] = fake.requestsTo(`/websites/${WEBSITE.id}`);
    assert.equal(sent?.headers.authorization, `Bearer ${fake.apiKey}`);
  });

  it('checks a self-hosted Umami by signing in through host.fetch', async () => {
    const { flash } = await check(selfHosted());
    assert.equal(flash, `Umami answered at ${HOST()}. It has the website Geekity (example.com).`);
    assert.equal(fake.logins, 1);
    assert.deepEqual(fake.requestsTo('/auth/login')[0]?.body, {
      username: fake.username,
      password: fake.password,
    });
  });

  it('says when Umami answers but has no such website', async () => {
    const options = cloud();
    const { flash } = await check({
      ...options,
      settings: { ...options.settings, website_id: 'gone' },
    });
    assert.equal(
      flash,
      `${HOST()} answered, but has no website with the ID gone that this account can see.`,
    );

    const hosted = selfHosted();
    const second = await check({ ...hosted, settings: { ...hosted.settings, website_id: 'gone' } });
    assert.equal(
      second.flash,
      `${HOST()} answered, but has no website with the ID gone that this account can see.`,
    );
  });

  it('says when Umami refuses the credentials, and logs neither secret', async () => {
    const logged: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    for (const method of methods) {
      mock.method(console, method, (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    try {
      const refusedKey = cloud();
      const first = await check({ ...refusedKey, secrets: { api_key: 'api_wrong-key-9999' } });
      assert.equal(first.flash, `${HOST()} refused the API key. Check it on Plugins &gt; Umami.`);
      assert.ok(!first.html.includes('api_wrong-key-9999'));

      const hosted = selfHosted();
      const second = await check({ ...hosted, secrets: { password: 'wrong-password-9999' } });
      assert.equal(
        second.flash,
        `${HOST()} refused the username and password. Check them on Plugins &gt; Umami.`,
      );
      assert.ok(!second.html.includes('wrong-password-9999'));
    } finally {
      mock.restoreAll();
    }
    const all = logged.join('\n');
    for (const secret of [
      'api_wrong-key-9999',
      'wrong-password-9999',
      fake.apiKey,
      fake.password,
    ]) {
      assert.ok(!all.includes(secret), `the log holds ${secret}`);
    }
  });

  it('says when Umami cannot be reached', async () => {
    const options = cloud();
    const { flash } = await check({
      ...options,
      settings: { ...options.settings, api_url: 'http://127.0.0.1:1/v1' },
    });
    assert.equal(
      flash,
      '127.0.0.1:1 could not be reached. Check the Umami URL and the API URL on Plugins &gt; Umami.',
    );
  });

  it('sends nothing while the settings are incomplete', async () => {
    const options = selfHosted();
    const { flash } = await check({ settings: options.settings, secrets: {} });
    assert.equal(flash, 'Set the password on Plugins &gt; Umami to read the stats.');
    assert.equal(fake.received.length, 0);
  });
});
