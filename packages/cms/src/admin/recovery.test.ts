import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import type { Cms, GeekityConfig } from '../index.ts';
import { writeMailCredentials } from '../mail/credentials.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import type { OutgoingMail } from '../mail/provider.ts';
import { createUser, verifyUserPassword } from './accounts.ts';
import { browser, csrfField, FIRST_ADMIN, sandbox, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { FORGOT_PATH, RESET_PATH } from './recovery.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from './settings.ts';

/**
 * Forgetting a password and getting back in.
 *
 * Everything here goes through the whole chain — the form, the users file, the
 * token in the cache, the mail service, the link, the new password, the
 * sessions that end — because that chain is the feature. The provider is
 * {@link createMemoryMailProvider}, so the message that would have gone out is
 * readable without a network.
 */

const box = sandbox();
after(() => box.cleanup());

/** A site whose mail goes into a list, with one admin who has an address. */
async function site(
  options: { email?: string | undefined; config?: GeekityConfig } = {},
): Promise<{ cms: Cms; provider: MemoryMailProvider }> {
  const provider = createMemoryMailProvider();
  const contentDir = await box.dir('geekity-recovery-content-');
  const dataDir = await box.dir('geekity-recovery-data-');

  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, title: 'A Site', baseUrl: 'https://blog.example' },
  });

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    mail: { provider, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } },
    ...options.config,
  });

  await createUser({
    dataDir,
    username: FIRST_ADMIN.username,
    password: FIRST_ADMIN.password,
    ...(options.email === undefined ? {} : { email: options.email }),
  });

  return { cms, provider };
}

/** A site whose mail service has nothing to send with. */
async function siteWithoutMail(): Promise<Cms> {
  const contentDir = await box.dir('geekity-recovery-nomail-content-');
  const dataDir = await box.dir('geekity-recovery-nomail-data-');
  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, title: 'A Site', baseUrl: 'https://blog.example' },
  });

  const cms = await box.open({ contentDir, dataDir, baseUrl: 'https://blog.example' });
  await createUser({
    dataDir,
    username: FIRST_ADMIN.username,
    password: FIRST_ADMIN.password,
    email: 'ada@example.com',
  });
  return cms;
}

/** Ask for a reset, the way a browser would: read the form, then post it. */
async function askForReset(
  cms: Cms,
  identifier: string,
): Promise<{ agent: Browser; response: Response; html: string }> {
  const agent = browser(cms);
  const form = await agent.get(FORGOT_PATH);
  const token = csrfField(await form.text());
  assert.ok(token !== undefined, 'the forgot-password form carried a CSRF token');

  const response = await agent.post(FORGOT_PATH, { csrf_token: token, identifier });
  const html = await response.text();
  await cms.mail.settled();
  return { agent, response, html };
}

/** The reset link out of the one message that was sent. */
function linkIn(message: OutgoingMail | undefined): string {
  assert.ok(message !== undefined, 'a message was sent');
  const found = /https:\/\/blog\.example\/admin\/reset\?token=[0-9a-f]{64}/.exec(message.text);
  assert.ok(found !== null, `no reset link in the message:\n${message.text}`);
  return found[0];
}

/** Just the path and query of a link, which is what the test app answers on. */
function pathOf(link: string): string {
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
}

describe('the forgot-password form (AC #2)', () => {
  it('is offered on the login form', async () => {
    const { cms } = await site({ email: 'ada@example.com' });
    const agent = browser(cms);

    const html = await (await agent.get('/admin/login')).text();

    assert.match(html, new RegExp(`href="${FORGOT_PATH}"`));
    assert.match(html, /Forgot(ten)? .{0,20}password/i);
  });

  it('answers a known and an unknown name identically, and mails only the known one', async () => {
    const { cms, provider } = await site({ email: 'ada@example.com' });

    const known = await askForReset(cms, 'ada');
    const unknown = await askForReset(cms, 'nobody-at-all');

    assert.equal(known.response.status, unknown.response.status);
    // The one thing the two pages may not disagree about is what they say.
    assert.equal(bodyText(known.html), bodyText(unknown.html));
    assert.equal(provider.sent.length, 1, 'only the account that exists was written to');
    assert.deepEqual(
      provider.sent[0]?.to.map((recipient) => recipient.address),
      ['ada@example.com'],
    );
  });

  it('says nothing different for a user who has no email address', async () => {
    const { cms, provider } = await site();

    const known = await askForReset(cms, 'ada');
    const unknown = await askForReset(cms, 'nobody-at-all');

    assert.equal(bodyText(known.html), bodyText(unknown.html));
    assert.equal(provider.sent.length, 0, 'there was nowhere to send it');
  });

  it('takes the email address as well as the username', async () => {
    const { cms, provider } = await site({ email: 'Ada@Example.com' });

    await askForReset(cms, 'ADA@EXAMPLE.COM');

    assert.equal(provider.sent.length, 1);
    assert.deepEqual(
      provider.sent[0]?.to.map((recipient) => recipient.address),
      ['Ada@Example.com'],
    );
  });

  it('sends a message naming the site, the user and a link that expires', async () => {
    const { cms, provider } = await site({ email: 'ada@example.com' });

    await askForReset(cms, 'ada');

    const message = provider.sent[0];
    assert.ok(message !== undefined);
    assert.match(message.subject, /A Site/);
    assert.match(message.text, /ada/);
    assert.match(message.text, /hour/i);
    assert.match(message.text, /https:\/\/blog\.example\/admin\/reset\?token=[0-9a-f]{64}/);
    // The link is not in the page that was rendered, only in the message.
    assert.doesNotMatch(
      (await askForReset(cms, 'ada')).html,
      /token=/,
      'the token reached the browser that asked',
    );
  });
});

describe('the reset link (AC #3)', () => {
  it('sets the password, works only once, and ends every session that user had', async () => {
    const { cms, provider } = await site({ email: 'ada@example.com' });
    const elsewhere = await signIn(cms);
    assert.equal((await elsewhere.get('/admin')).status, 200, 'she was signed in somewhere');

    await askForReset(cms, 'ada');
    const link = pathOf(linkIn(provider.sent[0]));

    const agent = browser(cms);
    const form = await agent.get(link);
    assert.equal(form.status, 200);
    const csrf = csrfField(await form.text());
    assert.ok(csrf !== undefined, 'the reset form carried a CSRF token');
    const token = new URL(linkIn(provider.sent[0])).searchParams.get('token');
    assert.ok(token !== null);

    const response = await agent.post(RESET_PATH, {
      csrf_token: csrf,
      token,
      password: 'a brand new password',
      password_confirmation: 'a brand new password',
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/login');

    // The new password is the real one, and the old one is not.
    assert.ok(
      verifyUserPassword(cms.config.dataDir, 'ada', 'a brand new password') !== undefined,
      'the new password was stored',
    );
    assert.equal(verifyUserPassword(cms.config.dataDir, 'ada', FIRST_ADMIN.password), undefined);

    // Every browser she was signed in on is signed out.
    const other = await elsewhere.get('/admin');
    assert.equal(other.status, 302);
    assert.equal(other.headers.get('location'), '/admin/login');

    // And the link is spent.
    const again = await agent.get(link);
    assert.match(await again.text(), /no longer valid|expired|already been used/i);
  });

  it('emails a confirmation once the password has changed', async () => {
    const { cms, provider } = await site({ email: 'ada@example.com' });
    await askForReset(cms, 'ada');
    const token = new URL(linkIn(provider.sent[0])).searchParams.get('token') ?? '';

    const agent = browser(cms);
    const csrf = csrfField(await (await agent.get(`${RESET_PATH}?token=${token}`)).text());
    assert.ok(csrf !== undefined);
    await agent.post(RESET_PATH, {
      csrf_token: csrf,
      token,
      password: 'a brand new password',
      password_confirmation: 'a brand new password',
    });
    await cms.mail.settled();

    assert.equal(provider.sent.length, 2);
    const confirmation = provider.sent[1];
    assert.ok(confirmation !== undefined);
    assert.deepEqual(
      confirmation.to.map((recipient) => recipient.address),
      ['ada@example.com'],
    );
    assert.match(confirmation.subject, /password/i);
    assert.doesNotMatch(confirmation.text, /token=/, 'a confirmation carries no way back in');
  });

  it('refuses a token nobody was ever sent, and one that has expired', async () => {
    const { cms, provider } = await site({ email: 'ada@example.com' });
    const agent = browser(cms);

    const invented = await agent.get(`${RESET_PATH}?token=${'0'.repeat(64)}`);
    assert.equal(invented.status, 400);
    assert.match(await invented.text(), /no longer valid|expired/i);

    // A real token, expired by the clock the store was given.
    await askForReset(cms, 'ada');
    const token = new URL(linkIn(provider.sent[0])).searchParams.get('token') ?? '';
    const anHourAndABitLater = new Date(Date.now() + 3700 * 1000);
    cms.admin.prunePasswordResets(anHourAndABitLater);

    const stale = await agent.get(`${RESET_PATH}?token=${token}`);
    assert.equal(stale.status, 400);
    assert.match(await stale.text(), /no longer valid|expired/i);
    assert.ok(
      verifyUserPassword(cms.config.dataDir, 'ada', FIRST_ADMIN.password) !== undefined,
      'nothing was changed',
    );
  });

  it('holds the new password to the rules the rest of the admin uses', async () => {
    const { cms, provider } = await site({ email: 'ada@example.com' });
    await askForReset(cms, 'ada');
    const token = new URL(linkIn(provider.sent[0])).searchParams.get('token') ?? '';

    const agent = browser(cms);
    const csrf = csrfField(await (await agent.get(`${RESET_PATH}?token=${token}`)).text());
    assert.ok(csrf !== undefined);

    const short = await agent.post(RESET_PATH, {
      csrf_token: csrf,
      token,
      password: 'short',
      password_confirmation: 'short',
    });
    assert.equal(short.status, 400);
    assert.match(await short.text(), /A password is at least 8 characters/);

    const mismatch = await agent.post(RESET_PATH, {
      csrf_token: csrf,
      token,
      password: 'a brand new password',
      password_confirmation: 'a different one entirely',
    });
    assert.equal(mismatch.status, 400);
    const html = await mismatch.text();
    assert.match(html, /do not match/);
    assert.doesNotMatch(html, /a brand new password/, 'no password is echoed back');

    // Neither refusal spent the link.
    assert.ok(
      verifyUserPassword(cms.config.dataDir, 'ada', FIRST_ADMIN.password) !== undefined,
      'the old password still works',
    );
    const stillGood = await agent.get(`${RESET_PATH}?token=${token}`);
    assert.equal(stillGood.status, 200);
  });

  it('needs the session CSRF token like every other admin form', async () => {
    const { cms, provider } = await site({ email: 'ada@example.com' });
    await askForReset(cms, 'ada');
    const token = new URL(linkIn(provider.sent[0])).searchParams.get('token') ?? '';

    const agent = browser(cms);
    await agent.get(`${RESET_PATH}?token=${token}`);

    const response = await agent.post(RESET_PATH, {
      csrf_token: 'not this session’s token',
      token,
      password: 'a brand new password',
      password_confirmation: 'a brand new password',
    });

    assert.equal(response.status, 403);
    assert.ok(verifyUserPassword(cms.config.dataDir, 'ada', FIRST_ADMIN.password) !== undefined);
  });
});

describe('repeated requests (AC #4)', () => {
  it('are locked out the way repeated sign-ins are, and say for how long', async () => {
    const { cms, provider } = await site({
      email: 'ada@example.com',
      config: { loginAttempts: 3, loginLockout: 900 },
    });

    let last: { response: Response; html: string } | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      last = await askForReset(cms, 'ada');
    }

    assert.equal(last?.response.status, 429);
    assert.equal(last?.response.headers.get('Retry-After'), '900');
    assert.match(last?.html ?? '', /Try again in 15 minutes/);
    assert.equal(provider.sent.length, 3, 'the refused request sent nothing');
  });

  it('does not lock the account out of logging in, so a flood is not a denial of service', async () => {
    const { cms } = await site({
      email: 'ada@example.com',
      config: { loginAttempts: 3, loginLockout: 900 },
    });

    for (let attempt = 0; attempt < 5; attempt += 1) await askForReset(cms, 'ada');

    const agent = await signIn(cms);
    assert.equal((await agent.get('/admin')).status, 200, 'she can still sign in');
  });
});

describe('a site that sends no email (AC #5)', () => {
  it('says recovery is unavailable and names the command that gets back in', async () => {
    const cms = await siteWithoutMail();
    const agent = browser(cms);

    const html = await (await agent.get(FORGOT_PATH)).text();

    assert.match(html, /cannot send email|is not available|no email/i);
    assert.match(html, /geekity user add/);
    // With nothing to send, there is no form to fill in.
    assert.doesNotMatch(html, /name="identifier"/);
  });

  it('sends nothing and says nothing about who exists when the form is posted anyway', async () => {
    const cms = await siteWithoutMail();

    // The page offers no form, so the token comes from the login page on the
    // same session: what is under test is the handler, not the missing form.
    async function post(identifier: string): Promise<string> {
      const agent = browser(cms);
      const token = csrfField(await (await agent.get('/admin/login')).text());
      assert.ok(token !== undefined);
      const response = await agent.post(FORGOT_PATH, { csrf_token: token, identifier });
      assert.equal(response.status, 200);
      return await response.text();
    }

    assert.equal(bodyText(await post('ada')), bodyText(await post('nobody-at-all')));
  });

  it('turns recovery on the moment a credential is saved, with no restart', async () => {
    const cms = await siteWithoutMail();
    await writeSiteJson({
      contentDir: cms.config.contentDir,
      settings: {
        ...DEFAULT_SITE_SETTINGS,
        title: 'A Site',
        baseUrl: 'https://blog.example',
        mailProvider: 'smtp',
      },
    });
    await writeMailCredentials(cms.config.dataDir, {
      smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'a', password: 'b' },
    });

    const html = await (await browser(cms).get(FORGOT_PATH)).text();

    assert.match(html, /name="identifier"/);
  });
});

/**
 * The rendered page with the parts that differ per request taken out, so two
 * answers can be compared for the only thing that matters: whether they say
 * the same thing. The CSRF token and the nonce are different every time and
 * say nothing about who exists.
 */
function bodyText(html: string): string {
  return html
    .replace(/value="[0-9a-f]{64}"/g, 'value="TOKEN"')
    .replace(/nonce="[^"]*"/g, 'nonce="NONCE"');
}
