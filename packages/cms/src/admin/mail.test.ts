import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import type { Cms, GeekityConfig } from '../index.ts';
import { startTestSmtpServer } from '../mail/__testing__/smtp-server.ts';
import type { TestSmtpServer } from '../mail/__testing__/smtp-server.ts';
import { writeMailCredentials } from '../mail/credentials.ts';
import type { MailCredentials } from '../mail/credentials.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  DEFAULT_SITE_SETTINGS,
  MAIL_FIELDS,
  MAIL_PATH,
  MAIL_REMOVE,
  MAIL_TEST_FIELDS,
  MAIL_TEST_PATH,
  SETTINGS_PATH,
  writeSiteJson,
} from './settings.ts';

/**
 * Email on the settings screen: where the credential lands, what the screen
 * says about it, and what the Send test email button actually does.
 *
 * Brevo is a stubbed endpoint and SMTP is a loopback server this file starts,
 * so nothing here touches the network. What is under test is that the whole
 * chain runs — the settings, the credential file, the template, the provider —
 * and that the credential never appears in `site.json` or in a rendered page.
 */

const box = sandbox();

/** Every call the stubbed Brevo saw. */
interface BrevoCall {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let brevo: BrevoCall[] = [];
/** What the stub answers with. */
let brevoAnswer: { body: string; status: number } = {
  body: JSON.stringify({ messageId: '<queued@brevo>' }),
  status: 201,
};

const restoreFetch = stubBrevo();

after(async () => {
  restoreFetch();
  await box.cleanup();
});

beforeEach(() => {
  brevo = [];
  brevoAnswer = { body: JSON.stringify({ messageId: '<queued@brevo>' }), status: 201 };
});

function stubBrevo(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.brevo.com/')) {
      return Promise.resolve(new Response('missing', { status: 404 }));
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = value;
    }
    brevo.push({
      headers,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });

    return Promise.resolve(new Response(brevoAnswer.body, { status: brevoAnswer.status }));
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

/** A signed-in admin over a site whose settings the caller chose. */
async function admin(
  settings: Partial<typeof DEFAULT_SITE_SETTINGS> = {},
  config: GeekityConfig = {},
): Promise<{ cms: Cms; agent: Browser; contentDir: string; dataDir: string }> {
  const contentDir = await box.dir('geekity-mail-admin-content-');
  const dataDir = await box.dir('geekity-mail-admin-data-');
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'A Site',
      baseUrl: 'https://blog.example',
      ...settings,
    },
  });

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    // No real backoff and a logger of the test's own: what the retry is worth
    // is proved at the service's own seam, and this file should not spend ten
    // seconds waiting for it or print four lines while it does.
    mail: { backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } },
    ...config,
  });
  return { cms, agent: await signedIn(cms), contentDir, dataDir };
}

/** Post to one of the mail forms, and hand back the screen afterwards. */
async function post(
  agent: Browser,
  url: string,
  fields: Record<string, string>,
): Promise<{ response: Response; screen: string }> {
  const token = csrfField(await (await agent.get(SETTINGS_PATH)).text());
  assert.ok(token !== undefined, 'the settings screen carried a CSRF token');

  const response = await agent.post(url, { csrf_token: token, ...fields });
  return { response, screen: await (await agent.get(SETTINGS_PATH)).text() };
}

/** `data/mail.json` as it stands, or `undefined` when there is none. */
function credentialFile(dataDir: string): MailCredentials | undefined {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, 'mail.json'), 'utf8')) as MailCredentials;
  } catch {
    return undefined;
  }
}

/** `content/_data/site.json` as it stands. */
async function siteJson(contentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('where mail credentials live (AC #3)', () => {
  it('keeps a Brevo key in data/mail.json at 0600 and nowhere near site.json', async () => {
    const { agent, contentDir, dataDir } = await admin({ mailProvider: 'brevo' });

    await post(agent, MAIL_PATH, { [MAIL_FIELDS.brevoApiKey]: 'xkeysib-secret-1234' });

    assert.deepEqual(credentialFile(dataDir)?.brevo, { apiKey: 'xkeysib-secret-1234' });
    assert.equal(statSync(path.join(dataDir, 'mail.json')).mode & 0o777, 0o600);

    const file = JSON.stringify(await siteJson(contentDir));
    assert.equal(file.includes('xkeysib-secret-1234'), false, 'the key reached site.json');
    assert.equal(file.includes('apiKey'), false);
  });

  it('keeps an SMTP password in the same place and never in site.json', async () => {
    const { agent, contentDir, dataDir } = await admin({ mailProvider: 'smtp' });

    await post(agent, MAIL_PATH, {
      [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
      [MAIL_FIELDS.smtpPort]: '587',
      [MAIL_FIELDS.smtpUser]: 'postmaster',
      [MAIL_FIELDS.smtpPassword]: 'hunter2-secret',
    });

    assert.deepEqual(credentialFile(dataDir)?.smtp, {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'postmaster',
      password: 'hunter2-secret',
    });

    const file = JSON.stringify(await siteJson(contentDir));
    assert.equal(file.includes('hunter2-secret'), false, 'the password reached site.json');
  });

  it('never prints a stored secret back into the page', async () => {
    const { agent } = await admin({ mailProvider: 'brevo' });

    const { screen } = await post(agent, MAIL_PATH, {
      [MAIL_FIELDS.brevoApiKey]: 'xkeysib-secret-1234',
      [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
      [MAIL_FIELDS.smtpPort]: '587',
      [MAIL_FIELDS.smtpUser]: 'postmaster',
      [MAIL_FIELDS.smtpPassword]: 'hunter2-secret',
    });

    assert.equal(screen.includes('xkeysib-secret-1234'), false);
    assert.equal(screen.includes('hunter2-secret'), false);
    // Enough to tell which key is in there, and no more.
    assert.match(screen, /…1234/);
    // The parts of an SMTP connection that are not secret are shown, so they
    // can be corrected without being retyped.
    assert.match(screen, /smtp\.example\.com/);
    assert.match(screen, /postmaster/);
  });

  it('keeps the stored secret when the field is left blank', async () => {
    const { agent, dataDir } = await admin({ mailProvider: 'smtp' });

    await post(agent, MAIL_PATH, {
      [MAIL_FIELDS.brevoApiKey]: 'xkeysib-secret-1234',
      [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
      [MAIL_FIELDS.smtpPort]: '587',
      [MAIL_FIELDS.smtpUser]: 'postmaster',
      [MAIL_FIELDS.smtpPassword]: 'hunter2-secret',
    });

    // A second save that changes the port and types no secrets at all.
    await post(agent, MAIL_PATH, {
      [MAIL_FIELDS.brevoApiKey]: '',
      [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
      [MAIL_FIELDS.smtpPort]: '465',
      [MAIL_FIELDS.smtpSecure]: '1',
      [MAIL_FIELDS.smtpUser]: 'postmaster',
      [MAIL_FIELDS.smtpPassword]: '',
    });

    const stored = credentialFile(dataDir);
    assert.equal(stored?.brevo?.apiKey, 'xkeysib-secret-1234');
    assert.equal(stored?.smtp?.password, 'hunter2-secret');
    assert.equal(stored?.smtp?.port, 465);
    assert.equal(stored?.smtp?.secure, true);
  });

  it('forgets everything when the credentials are removed', async () => {
    const { agent, dataDir } = await admin({ mailProvider: 'brevo' });
    await post(agent, MAIL_PATH, { [MAIL_FIELDS.brevoApiKey]: 'xkeysib-secret-1234' });

    const { screen } = await post(agent, MAIL_PATH, { [MAIL_FIELDS.action]: MAIL_REMOVE });

    assert.equal(credentialFile(dataDir), undefined);
    assert.match(screen, /No email is sent any more/);
  });

  it('puts the provider, the From line and the reply-to in site.json like every other setting', async () => {
    const { agent, contentDir } = await admin();

    const token = csrfField(await (await agent.get(SETTINGS_PATH)).text());
    assert.ok(token !== undefined);
    const response = await agent.post(SETTINGS_PATH, {
      csrf_token: token,
      title: 'A Site',
      tagline: '',
      base_url: 'https://blog.example',
      timezone: 'UTC',
      language: 'en',
      posts_per_page: '10',
      author: '',
      actor_handle: 'blog',
      actor_type: 'Person',
      tag_base: 'tag',
      category_base: 'category',
      comments: '1',
      comments_close_after_days: '14',
      notify_server: '',
      mail_provider: 'brevo',
      mail_from_name: 'A Site',
      mail_from_address: 'blog@example.com',
      mail_reply_to: 'hello@example.com',
    });

    assert.equal(response.status, 303);
    const file = await siteJson(contentDir);
    assert.equal(file['mailProvider'], 'brevo');
    assert.equal(file['mailFromName'], 'A Site');
    assert.equal(file['mailFromAddress'], 'blog@example.com');
    assert.equal(file['mailReplyTo'], 'hello@example.com');
  });
});

describe('the Send test email button with Brevo configured (AC #1)', () => {
  it('calls the transactional endpoint with the documented fields and reports the outcome', async () => {
    const { agent, dataDir } = await admin({
      mailProvider: 'brevo',
      mailFromName: 'A Site',
      mailFromAddress: 'blog@example.com',
      mailReplyTo: 'hello@example.com',
    });
    await writeMailCredentials(dataDir, { brevo: { apiKey: 'xkeysib-secret-1234' } });

    const { screen } = await post(agent, MAIL_TEST_PATH, {
      [MAIL_TEST_FIELDS.to]: 'ada@example.com',
    });

    assert.equal(brevo.length, 1);
    const call = brevo[0];
    assert.ok(call !== undefined);
    assert.equal(call.headers['api-key'], 'xkeysib-secret-1234');
    assert.deepEqual(call.body['sender'], { email: 'blog@example.com', name: 'A Site' });
    assert.deepEqual(call.body['to'], [{ email: 'ada@example.com' }]);
    assert.deepEqual(call.body['replyTo'], { email: 'hello@example.com' });
    assert.match(String(call.body['subject']), /A Site/);
    assert.match(String(call.body['textContent']), /test message/i);
    assert.match(String(call.body['htmlContent']), /<p>/);

    assert.match(screen, /test message was sent to ada@example\.com via brevo/);
    assert.match(screen, /queued@brevo/);
  });

  it("puts Brevo's own words on the screen when it refuses", async () => {
    const { agent, dataDir } = await admin({ mailProvider: 'brevo' });
    await writeMailCredentials(dataDir, { brevo: { apiKey: 'xkeysib-wrong' } });
    brevoAnswer = {
      status: 400,
      body: JSON.stringify({ code: 'invalid_parameter', message: 'sender is not valid' }),
    };

    const { screen } = await post(agent, MAIL_TEST_PATH, {
      [MAIL_TEST_FIELDS.to]: 'ada@example.com',
    });

    assert.match(screen, /would not send to ada@example\.com/);
    assert.match(screen, /sender is not valid/);
    // Every attempt was made before it gave up.
    assert.equal(brevo.length, 3);
  });

  it('says so rather than sending when the site has no mail configuration (AC #5)', async () => {
    const { agent } = await admin();

    const { screen } = await post(agent, MAIL_TEST_PATH, {
      [MAIL_TEST_FIELDS.to]: 'ada@example.com',
    });

    assert.equal(brevo.length, 0);
    assert.match(screen, /No mail is configured/);
  });

  it('refuses an address that is not one, without sending anything', async () => {
    const { agent, dataDir } = await admin({ mailProvider: 'brevo' });
    await writeMailCredentials(dataDir, { brevo: { apiKey: 'xkeysib-secret-1234' } });

    const { screen } = await post(agent, MAIL_TEST_PATH, { [MAIL_TEST_FIELDS.to]: 'not-an-email' });

    assert.equal(brevo.length, 0);
    assert.match(screen, /Type the address/);
  });
});

describe('the Send test email button with SMTP configured (AC #2)', () => {
  let server: TestSmtpServer;

  after(async () => {
    await server.close();
  });

  it('delivers the message to the configured server', async () => {
    server = await startTestSmtpServer();

    const { agent, dataDir } = await admin({
      mailProvider: 'smtp',
      mailFromName: 'A Site',
      mailFromAddress: 'blog@example.com',
    });
    await writeMailCredentials(dataDir, {
      smtp: {
        host: '127.0.0.1',
        port: server.port,
        secure: false,
        user: 'postmaster',
        password: 'hunter2',
      },
    });

    const { screen } = await post(agent, MAIL_TEST_PATH, {
      [MAIL_TEST_FIELDS.to]: 'ada@example.com',
    });

    assert.equal(server.received.length, 1);
    const message = server.received[0];
    assert.ok(message !== undefined);
    assert.equal(message.from, 'blog@example.com');
    assert.deepEqual(message.to, ['ada@example.com']);
    assert.deepEqual(message.auth, { user: 'postmaster', password: 'hunter2' });
    assert.match(message.data, /^Subject: .*A Site/m);
    assert.match(message.data, /test message/i);

    assert.match(screen, /test message was sent to ada@example\.com via smtp/);
  });
});
