import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser } from '../admin/accounts.ts';
import { readSiteSettings, writeSiteJson } from '../admin/settings.ts';
import type { CommentSubmission, CommentVerdict } from '../comments/submission.ts';
import { MAXIMUM_FORM_AGE_SECONDS, MINIMUM_SUBMIT_SECONDS } from '../forms/protection.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import { CONTACT_ANCHOR, CONTACT_FIELDS, CONTACT_NOTICE_PARAM, CONTACT_POST_PATH } from './form.ts';
import { listContactMessages } from './records.ts';
import { CONTACT_RATE_LIMIT, CONTACT_RATE_WINDOW_SECONDS } from './submission.ts';

/**
 * The contact form as a visitor meets it: a form under a page that asked for
 * one, a message that reaches the site's address, and four defences that each
 * refuse a submission without saying more than they have to.
 *
 * Everything goes through the app, because that is what the acceptance
 * criteria are about — the form being there, the submission being refused, the
 * message being stored — and none of those is a fact about a function.
 */

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** Where the site is, so the URLs in the tests are stable. */
const BASE_URL = 'https://blog.example';

/** The moment the site's clock is stopped at. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** The page the form is on. */
const CONTACT_PAGE = `---
title: Say hello
permalink: /contact/
contact: true
---

Write to me.
`;

/** A page with no form on it. */
const PLAIN_PAGE = `---
title: About
permalink: /about/
---

Words.
`;

const PAGES = {
  'pages/contact.md': CONTACT_PAGE,
  'pages/about.md': PLAIN_PAGE,
};

/** A CMS over those pages, with the clock stopped. */
async function site(
  files: Record<string, string> = PAGES,
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string; dataDir: string }> {
  const contentDir = await temporaryDir('geekity-contact-content-');
  const dataDir = await temporaryDir('geekity-contact-data-');

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  const instance = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir, dataDir };
}

/** One page as HTML. */
async function page(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, 200);
  return await response.text();
}

/** One submitted form, with everything a valid submission needs. */
function submission(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [CONTACT_FIELDS.page]: 'contact',
    [CONTACT_FIELDS.name]: 'Ada Lovelace',
    [CONTACT_FIELDS.email]: 'ada@example.com',
    [CONTACT_FIELDS.subject]: 'About the analytical engine',
    [CONTACT_FIELDS.message]: 'It is a lovely machine. Please write back.',
    [CONTACT_FIELDS.trap]: '',
    // Long enough ago to be a form somebody actually filled in.
    [CONTACT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
    ...overrides,
  };
}

/** A password long enough for the account rules, for the users a test needs. */
const PASSWORD = 'correct horse battery';

/** A config that sends every message into `provider` instead of anywhere. */
function mailing(provider: MemoryMailProvider): GeekityConfig {
  return {
    mail: {
      provider,
      // Instant, so a test never waits on a retry it is not about.
      backoffMs: () => 0,
      logger: { info: () => undefined, warn: () => undefined },
    },
  };
}

/** Set the site's contact address, the way the settings screen does. */
async function writeContactEmail(contentDir: string, contactEmail: string): Promise<void> {
  await writeSiteJson({
    contentDir,
    settings: { ...readSiteSettings(contentDir), contactEmail },
  });
}

/** Post the contact form. */
async function send(
  cms: Cms,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await cms.app.request(CONTACT_POST_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('a page that asks for a contact form', () => {
  it('renders one below its content, posting to the CMS endpoint (AC #1, #4)', async () => {
    const { cms } = await site();
    const html = await page(cms, '/contact/');

    assert.match(html, /Write to me\./, 'the page body is still there');
    assert.match(html, new RegExp(`action="${CONTACT_POST_PATH}"`), 'the form posts to the CMS');
    assert.match(html, new RegExp(`name="${CONTACT_FIELDS.name}"`));
    assert.match(html, new RegExp(`name="${CONTACT_FIELDS.email}"`));
    assert.match(html, new RegExp(`name="${CONTACT_FIELDS.subject}"`));
    assert.match(html, new RegExp(`name="${CONTACT_FIELDS.message}"`));
    // No script that runs: the form is a form. The one script the page does
    // carry is the head's JSON-LD (TASK-81), which is data rather than code —
    // every page has one and no browser executes it.
    assert.doesNotMatch(
      html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''),
      /<script/i,
      'the page carries a script that runs',
    );
  });

  it('leaves a page that did not ask for one without a form (AC #1)', async () => {
    const { cms } = await site();
    const html = await page(cms, '/about/');

    assert.doesNotMatch(html, new RegExp(`action="${CONTACT_POST_PATH}"`));
  });
});

describe('sending a message', () => {
  it('stores it under data/contact and thanks the sender (AC #2, #4)', async () => {
    const { cms, dataDir } = await site();

    const response = await send(cms, submission());

    assert.equal(response.status, 303, 'a redirect, so a refresh sends nothing twice');
    assert.equal(
      response.headers.get('location'),
      `/contact/?${CONTACT_NOTICE_PARAM}=sent#${CONTACT_ANCHOR}`,
    );

    const stored = listContactMessages(dataDir);
    assert.equal(stored.length, 1);
    const message = stored[0];
    assert.equal(message?.from.name, 'Ada Lovelace');
    assert.equal(message?.from.email, 'ada@example.com');
    assert.equal(message?.subject, 'About the analytical engine');
    assert.equal(message?.message, 'It is a lovely machine. Please write back.');
    assert.equal(message?.status, 'received');
    assert.equal(message?.read, false);
    assert.equal(message?.received, NOW.toISOString());
    assert.equal(message?.page.slug, 'contact');
    assert.equal(message?.page.permalink, '/contact/');
    assert.equal(message?.page.title, 'Say hello');
  });

  it('shows the thank-you where the form was, and not the form (AC #4)', async () => {
    const { cms } = await site();
    await send(cms, submission());

    const html = await page(cms, `/contact/?${CONTACT_NOTICE_PARAM}=sent`);

    assert.match(html, /Thank you/);
    assert.doesNotMatch(html, new RegExp(`action="${CONTACT_POST_PATH}"`), 'the form is gone');
  });

  it('emails the site contact address with reply-to set to the sender (AC #1)', async () => {
    const provider = createMemoryMailProvider();
    const { cms, contentDir } = await site(PAGES, mailing(provider));
    await writeContactEmail(contentDir, 'inbox@example.org');

    await send(cms, submission());
    await cms.mail.settled();

    assert.equal(provider.sent.length, 1);
    const sent = provider.sent[0];
    assert.deepEqual(
      sent?.to.map((recipient) => recipient.address),
      ['inbox@example.org'],
    );
    assert.equal(sent?.replyTo?.address, 'ada@example.com');
    assert.equal(sent?.replyTo?.name, 'Ada Lovelace');
    assert.match(sent?.subject ?? '', /About the analytical engine/);
    assert.match(sent?.text ?? '', /It is a lovely machine\./);
    assert.match(sent?.text ?? '', /ada@example\.com/, 'the message says who wrote it');
  });

  it('writes to the first admin with an email when no address is set (AC #1)', async () => {
    const provider = createMemoryMailProvider();
    const { cms, dataDir } = await site(PAGES, mailing(provider));
    await createUser({ dataDir, username: 'zoe', password: PASSWORD, email: 'zoe@example.org' });
    await createUser({ dataDir, username: 'ada', password: PASSWORD, email: 'ada@example.org' });

    await send(cms, submission());
    await cms.mail.settled();

    assert.deepEqual(
      provider.sent[0]?.to.map((recipient) => recipient.address),
      ['ada@example.org'],
      'the first admin with an address, by username',
    );
  });

  it('never puts the destination address in the page (AC #4)', async () => {
    const { cms, contentDir } = await site();
    await writeContactEmail(contentDir, 'secret-inbox@example.org');

    const before = await page(cms, '/contact/');
    await send(cms, submission());
    const after = await page(cms, `/contact/?${CONTACT_NOTICE_PARAM}=sent`);

    assert.doesNotMatch(before, /secret-inbox/);
    assert.doesNotMatch(after, /secret-inbox/);
  });

  it('stores the message and stays up when the site sends no mail (AC #2)', async () => {
    const { cms, dataDir } = await site();

    const response = await send(cms, submission());
    await cms.mail.settled();

    assert.equal(response.status, 303);
    assert.equal(listContactMessages(dataDir).length, 1, 'the file is the message');
  });

  it('keeps the address it came from as a salted hash rather than an address', async () => {
    const { cms, dataDir } = await site(PAGES, { trustProxy: true });
    await send(cms, submission(), { 'x-forwarded-for': '203.0.113.9' });

    const [message] = listContactMessages(dataDir);
    assert.notEqual(message?.addressHash, null);
    assert.doesNotMatch(JSON.stringify(message), /203\.0\.113\.9/);
  });

  it('refuses a page that never asked for a form', async () => {
    const { cms, dataDir } = await site();

    const response = await send(cms, submission({ [CONTACT_FIELDS.page]: 'about' }));

    assert.equal(response.status, 403);
    assert.equal(listContactMessages(dataDir).length, 0);
  });

  it('puts a refused submission back in the form with the words still in it', async () => {
    const { cms, dataDir } = await site();

    const response = await send(cms, submission({ [CONTACT_FIELDS.email]: 'not-an-address' }));

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /does not look like an email address/);
    assert.match(html, /It is a lovely machine\./, 'the message is still in the textarea');
    assert.equal(listContactMessages(dataDir).length, 0);
  });
});

describe('the defences in front of the contact form', () => {
  it('drops a submission that filled the honeypot, saying nothing (AC #3)', async () => {
    const provider = createMemoryMailProvider();
    const { cms, dataDir, contentDir } = await site(PAGES, mailing(provider));
    await writeContactEmail(contentDir, 'inbox@example.org');

    const response = await send(
      cms,
      submission({ [CONTACT_FIELDS.trap]: 'https://spam.example/' }),
    );
    await cms.mail.settled();

    // The same answer a message that went gets: a robot learns nothing here.
    assert.equal(response.status, 303);
    assert.equal(listContactMessages(dataDir).length, 0, 'nothing was stored');
    assert.equal(provider.sent.length, 0, 'nothing was sent');
  });

  it('refuses one submitted faster than anybody types (AC #3)', async () => {
    const { cms, dataDir } = await site();

    const response = await send(
      cms,
      submission({
        [CONTACT_FIELDS.loaded]: String(NOW.getTime() - (MINIMUM_SUBMIT_SECONDS - 1) * 1000),
      }),
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), /faster than anybody types/);
    assert.equal(listContactMessages(dataDir).length, 0);
  });

  it('refuses one from a form rendered too long ago (AC #3)', async () => {
    const { cms, dataDir } = await site();

    const response = await send(
      cms,
      submission({
        [CONTACT_FIELDS.loaded]: String(NOW.getTime() - (MAXIMUM_FORM_AGE_SECONDS + 60) * 1000),
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(listContactMessages(dataDir).length, 0);
  });

  it('rate limits one address once it has sent enough (AC #3)', async () => {
    const { cms, dataDir } = await site(PAGES, { trustProxy: true });
    const from = { 'x-forwarded-for': '198.51.100.7' };

    for (let sent = 0; sent < CONTACT_RATE_LIMIT; sent += 1) {
      assert.equal(
        (await send(cms, submission(), from)).status,
        303,
        `message ${String(sent + 1)}`,
      );
    }

    const refused = await send(cms, submission(), from);

    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('retry-after'), String(CONTACT_RATE_WINDOW_SECONDS));
    assert.match(await refused.text(), /a lot of messages in a short time/);
    assert.equal(listContactMessages(dataDir).length, CONTACT_RATE_LIMIT);
  });

  it('asks the checker as a contact-form and keeps what it calls spam (AC #3)', async () => {
    const seen: CommentSubmission[] = [];
    const provider = createMemoryMailProvider();
    const { cms, dataDir, contentDir } = await site(PAGES, {
      ...mailing(provider),
      commentChecker: {
        check(incoming): CommentVerdict {
          seen.push(incoming);
          return 'spam';
        },
      },
    });
    await writeContactEmail(contentDir, 'inbox@example.org');

    const response = await send(cms, submission());
    await cms.mail.settled();

    assert.equal(response.status, 303, 'the sender is told nothing about the verdict');
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.type, 'contact-form', 'Akismet is told what this is');
    assert.equal(seen[0]?.comment.author.name, 'Ada Lovelace');
    assert.match(seen[0]?.comment.content.markdown ?? '', /It is a lovely machine\./);

    const [stored] = listContactMessages(dataDir);
    assert.equal(stored?.status, 'spam', 'kept, because a false positive loses a real message');
    assert.equal(provider.sent.length, 0, 'and not mailed on');
  });

  it('stores nothing at all when the checker says to discard it (AC #3)', async () => {
    const { cms, dataDir } = await site(PAGES, {
      commentChecker: { check: (): CommentVerdict => 'discard' },
    });

    const response = await send(cms, submission());

    assert.equal(response.status, 303);
    assert.equal(listContactMessages(dataDir).length, 0);
  });

  it('stores the message when the checker is broken (AC #3)', async () => {
    const { cms, dataDir } = await site(PAGES, {
      commentChecker: {
        check(): CommentVerdict {
          throw new Error('the checker is down');
        },
      },
    });

    assert.equal((await send(cms, submission())).status, 303);
    assert.equal(listContactMessages(dataDir)[0]?.status, 'received');
  });
});
