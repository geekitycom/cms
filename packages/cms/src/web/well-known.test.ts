/**
 * The two well-known files a site answers for itself (TASK-133): RFC 9116's
 * security.txt, read from the settings in `site.json`, and the change-password
 * URL a password manager follows to the admin's own form.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { browser, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { saveSettings } from '../admin/__testing__/settings.ts';
import type { Cms } from '../index.ts';
import { enterMaintenance } from '../maintenance.ts';

const box = sandbox();
after(() => box.cleanup());

const START = Date.parse('2026-09-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

interface Site {
  cms: Cms;
  contentDir: string;
  dataDir: string;
  advance: (ms: number) => void;
}

async function site(siteJson?: Record<string, unknown>): Promise<Site> {
  let current = START;
  const contentDir = await box.dir('geekity-well-known-content-');
  const dataDir = await box.dir('geekity-well-known-data-');
  if (siteJson !== undefined) {
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(path.join(contentDir, '_data', 'site.json'), JSON.stringify(siteJson), 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => new Date(current),
  });
  return {
    cms,
    contentDir,
    dataDir,
    advance: (ms) => {
      current += ms;
    },
  };
}

function field(body: string, name: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith(`${name}: `))
    .map((line) => line.slice(name.length + 2));
}

describe('/.well-known/security.txt', () => {
  it('is a 404 on a site that has named no security contact', async () => {
    const { cms } = await site({ title: 'Quiet', contactEmail: 'hello@blog.example' });

    const response = await cms.app.request('/.well-known/security.txt');

    assert.equal(response.status, 404);
    assert.doesNotMatch(
      await response.text(),
      /hello@blog\.example/,
      'the contact form address is never published in its place',
    );
  });

  it('serves every field the site set, as UTF-8 plain text', async () => {
    const { cms } = await site({
      securityContacts: ['mailto:security@blog.example', 'https://blog.example/security'],
      securityPolicy: 'https://blog.example/disclosure',
      securityLanguages: 'en, fr',
    });

    const response = await cms.app.request('/.well-known/security.txt');
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.deepEqual(field(body, 'Contact'), [
      'mailto:security@blog.example',
      'https://blog.example/security',
    ]);
    assert.deepEqual(field(body, 'Expires'), [new Date(START + 30 * DAY).toISOString()]);
    assert.deepEqual(field(body, 'Policy'), ['https://blog.example/disclosure']);
    assert.deepEqual(field(body, 'Preferred-Languages'), ['en, fr']);
    assert.deepEqual(field(body, 'Canonical'), ['https://blog.example/.well-known/security.txt']);
  });

  it('leaves out the optional fields a site did not set', async () => {
    const { cms } = await site({ securityContacts: ['mailto:security@blog.example'] });

    const body = await (await cms.app.request('/.well-known/security.txt')).text();

    assert.deepEqual(field(body, 'Contact'), ['mailto:security@blog.example']);
    assert.deepEqual(field(body, 'Policy'), []);
    assert.deepEqual(field(body, 'Preferred-Languages'), []);
  });

  it('computes Expires from the time of the request, so it never goes stale', async () => {
    const { cms, advance } = await site({ securityContacts: ['mailto:security@blog.example'] });

    advance(400 * DAY);
    const body = await (await cms.app.request('/.well-known/security.txt')).text();

    assert.deepEqual(field(body, 'Expires'), [new Date(START + 430 * DAY).toISOString()]);
  });

  it('stays reachable in maintenance mode, when a researcher may need it most', async () => {
    const { cms, dataDir, advance } = await site({
      securityContacts: ['mailto:security@blog.example'],
    });
    await enterMaintenance(dataDir, {});
    advance(1001);

    assert.equal((await cms.app.request('/2026/09/anything/')).status, 503, 'the site is down');
    const response = await cms.app.request('/.well-known/security.txt');
    assert.equal(response.status, 200);
    assert.deepEqual(field(await response.text(), 'Contact'), ['mailto:security@blog.example']);
  });
});

describe('the security settings on Settings > Email', () => {
  it('are written to site.json, a bare address becoming a mailto: URI', async () => {
    const { cms, contentDir } = await site();
    const agent = await signedIn(cms);

    const page = await (await agent.get('/admin/settings/email')).text();
    assert.match(page, /name="security_contacts"/);
    assert.match(page, /name="security_policy"/);
    assert.match(page, /name="security_languages"/);

    const saved = await saveSettings(agent, 'email', {
      security_contacts: 'security@blog.example\nhttps://blog.example/security\n',
      security_policy: 'https://blog.example/disclosure',
      security_languages: 'en,fr',
    });
    assert.equal(saved.status, 303);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(written['securityContacts'], [
      'mailto:security@blog.example',
      'https://blog.example/security',
    ]);
    assert.equal(written['securityPolicy'], 'https://blog.example/disclosure');
    assert.equal(written['securityLanguages'], 'en, fr');

    const body = await (await cms.app.request('/.well-known/security.txt')).text();
    assert.deepEqual(field(body, 'Contact'), [
      'mailto:security@blog.example',
      'https://blog.example/security',
    ]);
  });

  it('refuses a contact that is neither an address nor an https:// or tel: URI', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const refused = await saveSettings(agent, 'email', {
      security_contacts: 'http://blog.example/security',
    });

    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /&quot;http:\/\/blog\.example\/security&quot; is not one/);
  });

  it('refuses a policy that is not an https:// URL, and languages that are not tags', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const refused = await saveSettings(agent, 'email', {
      security_policy: 'ftp://blog.example/policy',
      security_languages: 'english please',
    });
    const text = await refused.text();

    assert.equal(refused.status, 400);
    assert.match(text, /A security policy is an https:\/\/ URL/);
    assert.match(text, /Preferred languages are language tags/);
  });
});

describe('/.well-known/change-password', () => {
  it('sends a signed-in user to the change-password form on their own page', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const response = await agent.get('/.well-known/change-password');

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/users/1#change-password');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(
      await (await agent.get('/admin/users/1')).text(),
      /<form[^>]*id="change-password"/,
      'the fragment names the form',
    );
  });

  it('sends somebody signed out to the login form', async () => {
    const { cms } = await site();
    await signedIn(cms);

    const response = await browser(cms).get('/.well-known/change-password');

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/login');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('still redirects in maintenance mode, since the admin it leads to is open', async () => {
    const { cms, dataDir, advance } = await site();
    const agent = await signedIn(cms);
    await enterMaintenance(dataDir, {});
    advance(1001);

    assert.equal(
      (await browser(cms).get('/.well-known/change-password')).headers.get('location'),
      '/admin/login',
    );
    assert.equal(
      (await agent.get('/.well-known/change-password')).headers.get('location'),
      '/admin/users/1#change-password',
    );
  });
});
