import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { settingsOver } from '../__testing__/settings.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { startTestSmtpServer } from '../mail/__testing__/smtp-server.ts';
import type { TestSmtpServer } from '../mail/__testing__/smtp-server.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import { writeSiteJson } from '../site/site-json.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  EMAIL_SETTINGS,
  MAIL_FIELDS,
  MAIL_PATH,
  MAIL_REMOVE,
  MAIL_TEST_FIELDS,
  MAIL_TEST_PATH,
} from './settings-email.ts';

/** The page the credential lives on: Email, beside the From line it sends as. */
const SETTINGS_PATH = EMAIL_SETTINGS.path;

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
      base_url: 'https://blog.example',
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

interface Credentials {
  brevo?: { apiKey: string };
  smtp?: { host: string; port: number; secure: boolean; user: string; password: string };
}

async function storeMail(dataDir: string, credentials: Credentials): Promise<void> {
  const { brevo, smtp } = credentials;
  const result = await settingsOver({ dataDir }).set(
    'mail',
    new Map<string, unknown>([
      ...(brevo === undefined ? [] : [['brevo_api_key', brevo.apiKey] as const]),
      ...(smtp === undefined
        ? []
        : ([
            ['smtp_host', smtp.host],
            ['smtp_port', smtp.port],
            ['smtp_secure', smtp.secure],
            ['smtp_user', smtp.user],
            ['smtp_password', smtp.password],
          ] as const)),
    ]),
    'admin',
  );
  assert.deepEqual(result, { ok: true });
}

/** `data/mail.json` as it stands, or `undefined` when there is none. */
function credentialFile(dataDir: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, 'mail.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

async function withEnv<T>(name: string, value: string, body: () => Promise<T>): Promise<T> {
  process.env[name] = value;
  try {
    return await body();
  } finally {
    delete process.env[name];
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
    const { agent, contentDir, dataDir } = await admin({ mail_provider: 'brevo' });

    await post(agent, MAIL_PATH, { [MAIL_FIELDS.brevoApiKey]: 'xkeysib-secret-1234' });

    assert.equal(credentialFile(dataDir)?.['brevo_api_key'], 'xkeysib-secret-1234');
    assert.equal(statSync(path.join(dataDir, 'mail.json')).mode & 0o777, 0o600);

    const file = JSON.stringify(await siteJson(contentDir));
    assert.equal(file.includes('xkeysib-secret-1234'), false, 'the key reached site.json');
    assert.equal(file.includes('brevo_api_key'), false);
  });

  it('keeps an SMTP password in the same place and never in site.json', async () => {
    const { agent, contentDir, dataDir } = await admin({ mail_provider: 'smtp' });

    await post(agent, MAIL_PATH, {
      [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
      [MAIL_FIELDS.smtpPort]: '587',
      [MAIL_FIELDS.smtpUser]: 'postmaster',
      [MAIL_FIELDS.smtpPassword]: 'hunter2-secret',
    });

    assert.deepEqual(credentialFile(dataDir), {
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: 'postmaster',
      smtp_password: 'hunter2-secret',
    });

    const file = JSON.stringify(await siteJson(contentDir));
    assert.equal(file.includes('hunter2-secret'), false, 'the password reached site.json');
  });

  it('never prints a stored secret back into the page', async () => {
    const { agent } = await admin({ mail_provider: 'brevo' });

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
    const { agent, dataDir } = await admin({ mail_provider: 'smtp' });

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
    assert.equal(stored?.['brevo_api_key'], 'xkeysib-secret-1234');
    assert.equal(stored?.['smtp_password'], 'hunter2-secret');
    assert.equal(stored?.['smtp_port'], 465);
    assert.equal(stored?.['smtp_secure'], true);
  });

  it('forgets everything when the credentials are removed', async () => {
    const { agent, dataDir } = await admin({ mail_provider: 'brevo' });
    await post(agent, MAIL_PATH, { [MAIL_FIELDS.brevoApiKey]: 'xkeysib-secret-1234' });

    const { screen } = await post(agent, MAIL_PATH, { [MAIL_FIELDS.action]: MAIL_REMOVE });

    assert.deepEqual(credentialFile(dataDir), {});
    assert.match(screen, /No email is sent any more/);
  });

  it('refuses an SMTP port that cannot be one, saying so and saving nothing', async () => {
    const { agent, dataDir } = await admin({ mail_provider: 'smtp' });

    const { screen } = await post(agent, MAIL_PATH, {
      [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
      [MAIL_FIELDS.smtpPort]: '70000',
      [MAIL_FIELDS.smtpPassword]: 'hunter2-secret',
    });

    assert.match(screen, /mail\.smtp_port must be a whole number between 1 and 65535/);
    assert.match(screen, /Nothing was saved/);
    assert.equal(credentialFile(dataDir), undefined);
  });

  it('shows an SMTP password the environment sets as set by it, and refuses to store one over it', async () => {
    await withEnv('GEEKITY_MAIL__SMTP_PASSWORD', 'env-held-secret', async () => {
      const { agent, dataDir } = await admin({ mail_provider: 'smtp' });

      const shown = await (await agent.get(SETTINGS_PATH)).text();
      assert.match(shown, /The password is set by <code>GEEKITY_MAIL__SMTP_PASSWORD<\/code>/);
      assert.ok(!shown.includes('env-held-secret'), 'the screen never prints the password');
      assert.ok(!shown.includes(`name="${MAIL_FIELDS.smtpPassword}"`), 'no box to type over it');

      const refused = await post(agent, MAIL_PATH, {
        [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
        [MAIL_FIELDS.smtpPort]: '587',
        [MAIL_FIELDS.smtpUser]: 'postmaster',
        [MAIL_FIELDS.smtpPassword]: 'typed-secret',
      });
      assert.match(
        refused.screen,
        /mail\.smtp_password is set by GEEKITY_MAIL__SMTP_PASSWORD and cannot be changed here\. Nothing was saved\./,
      );
      assert.equal(credentialFile(dataDir), undefined);

      const saved = await post(agent, MAIL_PATH, {
        [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
        [MAIL_FIELDS.smtpPort]: '587',
        [MAIL_FIELDS.smtpUser]: 'postmaster',
      });
      assert.match(saved.screen, /Mail is configured/);
      assert.equal(credentialFile(dataDir)?.['smtp_host'], 'smtp.example.com');
      assert.equal(JSON.stringify(credentialFile(dataDir)).includes('env-held-secret'), false);

      const forgotten = await post(agent, MAIL_PATH, { [MAIL_FIELDS.action]: MAIL_REMOVE });
      assert.match(
        forgotten.screen,
        /GEEKITY_MAIL__SMTP_PASSWORD still sets mail\.smtp_password\./,
      );
      assert.deepEqual(credentialFile(dataDir), {});
    });
  });

  it('removes the stored credentials while the environment forces the SMTP port', async () => {
    await withEnv('GEEKITY_MAIL__SMTP_PORT', '465', async () => {
      const { agent, dataDir } = await admin({ mail_provider: 'smtp' });
      await post(agent, MAIL_PATH, {
        [MAIL_FIELDS.smtpHost]: 'smtp.example.com',
        [MAIL_FIELDS.smtpSecure]: 'on',
        [MAIL_FIELDS.smtpPassword]: 'hunter2-secret',
      });
      assert.equal(credentialFile(dataDir)?.['smtp_password'], 'hunter2-secret');

      const { screen } = await post(agent, MAIL_PATH, { [MAIL_FIELDS.action]: MAIL_REMOVE });

      assert.match(screen, /credentials are gone/);
      assert.equal(credentialFile(dataDir)?.['smtp_password'], undefined);
    });
  });

  it('says nothing was removed when forgetting the stored credentials is refused', async () => {
    await withEnv('GEEKITY_MAIL__SMTP_HOST', 'smtp.example.com', async () => {
      await withEnv('GEEKITY_MAIL__SMTP_PORT', '465', async () => {
        const { agent, dataDir } = await admin({ mail_provider: 'smtp' });
        await post(agent, MAIL_PATH, {
          [MAIL_FIELDS.smtpSecure]: 'on',
          [MAIL_FIELDS.smtpPassword]: 'hunter2-secret',
        });
        assert.equal(credentialFile(dataDir)?.['smtp_password'], 'hunter2-secret');

        const { screen } = await post(agent, MAIL_PATH, { [MAIL_FIELDS.action]: MAIL_REMOVE });

        assert.match(screen, /smtp_secure must be true\. Nothing was removed\./);
        assert.doesNotMatch(screen, /credentials are gone/);
        assert.equal(credentialFile(dataDir)?.['smtp_password'], 'hunter2-secret');
      });
    });
  });

  it('puts the provider, the From line and the reply-to in site.json like every other setting', async () => {
    const { agent, contentDir } = await admin();

    const token = csrfField(await (await agent.get(SETTINGS_PATH)).text());
    assert.ok(token !== undefined);
    const response = await agent.post(SETTINGS_PATH, {
      csrf_token: token,
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
      mail_provider: 'brevo',
      mail_from_name: 'A Site',
      mail_from_address: 'blog@example.com',
      mail_reply_to: 'hello@example.com',
    });
    await storeMail(dataDir, { brevo: { apiKey: 'xkeysib-secret-1234' } });

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

  it('holds the test message in dev mode and says so (TASK-295)', async () => {
    const { agent, dataDir } = await admin({ mail_provider: 'brevo' });
    await storeMail(dataDir, { brevo: { apiKey: 'xkeysib-secret-1234' } });
    await settingsOver({ dataDir }).set('dev_mode', new Map([['on', true]]), 'cli');

    const { screen } = await post(agent, MAIL_TEST_PATH, {
      [MAIL_TEST_FIELDS.to]: 'ada@example.com',
    });

    assert.equal(brevo.length, 0, 'Brevo was not called');
    assert.match(screen, /Dev mode is on, so the test message to ada@example\.com was held/);
  });

  it("puts Brevo's own words on the screen when it refuses", async () => {
    const { agent, dataDir } = await admin({ mail_provider: 'brevo' });
    await storeMail(dataDir, { brevo: { apiKey: 'xkeysib-wrong' } });
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
    const { agent, dataDir } = await admin({ mail_provider: 'brevo' });
    await storeMail(dataDir, { brevo: { apiKey: 'xkeysib-secret-1234' } });

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
      mail_provider: 'smtp',
      mail_from_name: 'A Site',
      mail_from_address: 'blog@example.com',
    });
    await storeMail(dataDir, {
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

describe('which credential boxes the panel draws (AC #1, #2, #3, #4, #6)', () => {
  /** Whether the screen carries a box that submits `field`. */
  function hasBox(screen: string, field: string): boolean {
    return screen.includes(`name="${field}"`);
  }

  /** Every box the credential form has ever offered, by the field it submits. */
  const BREVO_BOXES = [MAIL_FIELDS.brevoApiKey];
  const SMTP_BOXES = [
    MAIL_FIELDS.smtpHost,
    MAIL_FIELDS.smtpPort,
    MAIL_FIELDS.smtpSecure,
    MAIL_FIELDS.smtpUser,
    MAIL_FIELDS.smtpPassword,
  ];

  /** The Email screen of a site with this provider saved and this stored. */
  async function screenFor(
    mailProvider: 'none' | 'brevo' | 'smtp',
    stored?: Credentials,
  ): Promise<string> {
    const { agent, dataDir } = await admin({ mail_provider: mailProvider });
    if (stored !== undefined) await storeMail(dataDir, stored);
    return await (await agent.get(SETTINGS_PATH)).text();
  }

  /**
   * Just the Mail credentials panel.
   *
   * What the panel says has to be read apart from the settings form above it,
   * or "saved" and "Save settings" match that form's own words and the
   * assertion proves nothing.
   */
  function panel(screen: string): string {
    const start = screen.indexOf('>Mail credentials</h2>');
    assert.notEqual(start, -1, 'the Mail credentials panel was gone');
    return screen.slice(start, screen.indexOf('</main>', start));
  }

  it('offers the API key and no SMTP box when Brevo is the saved provider', async () => {
    const screen = await screenFor('brevo');

    for (const field of BREVO_BOXES) assert.ok(hasBox(screen, field), `${field} was missing`);
    for (const field of SMTP_BOXES) {
      assert.equal(hasBox(screen, field), false, `${field} was drawn under Brevo`);
    }
  });

  it('offers the whole SMTP connection and no API key box when SMTP is the saved provider', async () => {
    const screen = await screenFor('smtp');

    for (const field of SMTP_BOXES) assert.ok(hasBox(screen, field), `${field} was missing`);
    for (const field of BREVO_BOXES) {
      assert.equal(hasBox(screen, field), false, `${field} was drawn under SMTP`);
    }
  });

  it('offers no credential box at all, and says the site sends nothing, when no provider is chosen', async () => {
    const screen = await screenFor('none');

    for (const field of [...BREVO_BOXES, ...SMTP_BOXES]) {
      assert.equal(hasBox(screen, field), false, `${field} was drawn with no provider`);
    }
    assert.match(screen, /sends no email/);
  });

  it('still reports an SMTP server stored while Brevo is chosen, and still offers Remove', async () => {
    const screen = await screenFor('brevo', {
      brevo: { apiKey: 'xkeysib-secret-1234' },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'postmaster',
        password: 'hunter2-secret',
      },
    });

    // Hidden, but not forgotten: the only screen that says this is here.
    assert.equal(hasBox(screen, MAIL_FIELDS.smtpHost), false);
    assert.match(screen, /smtp\.example\.com/);
    assert.match(screen, /postmaster/);
    assert.ok(screen.includes(`value="${MAIL_REMOVE}"`), 'Remove credentials was out of reach');
  });

  it('still reports a Brevo key stored while SMTP is chosen, and still offers Remove', async () => {
    const screen = await screenFor('smtp', { brevo: { apiKey: 'xkeysib-secret-1234' } });

    assert.equal(hasBox(screen, MAIL_FIELDS.brevoApiKey), false);
    assert.match(screen, /…1234/);
    assert.ok(screen.includes(`value="${MAIL_REMOVE}"`), 'Remove credentials was out of reach');
  });

  it('reports both stored credentials, and offers Remove, when no provider is chosen', async () => {
    const screen = await screenFor('none', {
      brevo: { apiKey: 'xkeysib-secret-1234' },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'postmaster',
        password: 'hunter2-secret',
      },
    });

    assert.match(screen, /…1234/);
    assert.match(screen, /smtp\.example\.com/);
    assert.ok(screen.includes(`value="${MAIL_REMOVE}"`), 'Remove credentials was out of reach');
  });

  it('says the boxes follow the saved provider and that changing it takes a Save settings (AC #5)', async () => {
    for (const provider of ['none', 'brevo', 'smtp'] as const) {
      const here = panel(await screenFor(provider));
      assert.match(here, /saved/i, `the ${provider} panel did not say which provider it means`);
      assert.match(here, /Save settings/, `the ${provider} panel did not say to save first`);
    }
  });

  it('keeps the paragraph about where credentials are kept in every state', async () => {
    for (const provider of ['none', 'brevo', 'smtp'] as const) {
      const here = panel(await screenFor(provider));
      assert.match(here, /data\/mail\.json/, `the ${provider} panel lost where secrets live`);
      assert.match(here, /Leaving a secret blank/, `the ${provider} panel lost the blank rule`);
    }
  });

  it('draws Send a test message only where the site can actually send', async () => {
    const test = (screen: string): boolean => screen.includes('id="settings-mail-test-to"');

    assert.ok(test(await screenFor('brevo', { brevo: { apiKey: 'xkeysib-secret-1234' } })));
    assert.equal(test(await screenFor('brevo')), false, 'offered a test with no Brevo key');
    assert.equal(
      test(
        await screenFor('none', {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            user: 'postmaster',
            password: 'hunter2-secret',
          },
        }),
      ),
      false,
      'offered a test with no provider',
    );
  });
});
