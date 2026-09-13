import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { writeMailCredentials } from './credentials.ts';
import { createMemoryMailProvider } from './memory.ts';
import type { MailProvider, OutgoingMail } from './provider.ts';
import { createMailService } from './service.ts';
import type { MailService } from './service.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dir(prefix: string): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(created);
  return created;
}

/** Everything the logger was told, one string per line. */
class Log {
  readonly lines: string[] = [];
  info = (message: string): void => {
    this.lines.push(`info: ${message}`);
  };
  warn = (message: string): void => {
    this.lines.push(`warn: ${message}`);
  };
}

/** A site with the given settings, and a mail service over it. */
async function site(
  options: {
    settings?: Partial<SiteSettings>;
    provider?: MailProvider | undefined;
    log?: Log | undefined;
    attempts?: number | undefined;
    backoff?: number[] | undefined;
  } = {},
): Promise<{ mail: MailService; contentDir: string; dataDir: string; waited: number[] }> {
  const contentDir = await dir('geekity-mail-content-');
  const dataDir = await dir('geekity-mail-data-');
  const themesDir = await dir('geekity-mail-themes-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, title: 'A Site', ...options.settings },
  });

  const waited: number[] = [];

  const mail = createMailService({
    config: { baseUrl: 'https://blog.example', contentDir, dataDir, themesDir, watch: false },
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    // Always a logger of the test's own, so a passing run says nothing.
    logger: options.log ?? new Log(),
    ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
    backoffMs: (attempt) => attempt * 1000,
    wait: (ms) => {
      waited.push(ms);
      return Promise.resolve();
    },
  });

  return { mail, contentDir, dataDir, waited };
}

describe('a site with no mail configuration (AC #5)', () => {
  it('resolves successfully and sends nothing, so a feature that emails keeps working', async () => {
    const log = new Log();
    const { mail } = await site({ log });

    assert.equal(mail.configured(), false);

    const result = await mail.send({ to: 'ada@example.com', template: 'test' });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.provider, 'none');
    assert.equal(result.attempts, 0);
  });

  it('says in the log that the message was not sent', async () => {
    const log = new Log();
    const { mail } = await site({ log });

    await mail.send({ to: 'ada@example.com', template: 'test' });

    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0] ?? '', /not sent/i);
    assert.match(log.lines[0] ?? '', /ada@example\.com/);
  });

  it('is not configured when the provider is named but its credential is missing', async () => {
    const { mail } = await site({ settings: { mailProvider: 'brevo' } });
    assert.equal(mail.configured(), false);
  });

  it('is configured the moment the credential lands, with no restart', async () => {
    const { mail, dataDir } = await site({ settings: { mailProvider: 'brevo' } });
    assert.equal(mail.configured(), false);

    await writeMailCredentials(dataDir, { brevo: { apiKey: 'xkeysib-secret' } });
    assert.equal(mail.configured(), true);
  });
});

describe('sending a templated message', () => {
  it('renders the template and addresses it from the settings', async () => {
    const provider = createMemoryMailProvider();
    const { mail } = await site({
      provider,
      settings: {
        mailFromName: 'A Site',
        mailFromAddress: 'site@blog.example',
        mailReplyTo: 'hello@blog.example',
      },
    });

    const result = await mail.send({ to: 'ada@example.com', template: 'test' });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.provider, 'memory');
    assert.equal(result.attempts, 1);

    assert.equal(provider.sent.length, 1);
    const message = provider.sent[0];
    assert.ok(message !== undefined);
    assert.deepEqual(message.from, { name: 'A Site', address: 'site@blog.example' });
    assert.deepEqual([...message.to], [{ address: 'ada@example.com' }]);
    assert.deepEqual(message.replyTo, { address: 'hello@blog.example' });
    assert.match(message.subject, /A Site/);
    assert.match(message.text, /A Site/);
    assert.ok(message.html !== undefined);
  });

  it('falls back to an address at the site host when the settings name none', async () => {
    const provider = createMemoryMailProvider();
    const { mail } = await site({ provider });

    await mail.send({ to: 'ada@example.com', template: 'test' });

    assert.deepEqual(provider.sent[0]?.from, { name: 'A Site', address: 'no-reply@blog.example' });
  });

  it("lets the caller's own subject and reply-to win over the template and the settings", async () => {
    const provider = createMemoryMailProvider();
    const { mail } = await site({ provider, settings: { mailReplyTo: 'hello@blog.example' } });

    await mail.send({
      to: [{ address: 'ada@example.com', name: 'Ada' }],
      template: 'test',
      subject: 'Something else',
      replyTo: 'someone@example.com',
    });

    assert.equal(provider.sent[0]?.subject, 'Something else');
    assert.deepEqual(provider.sent[0]?.replyTo, { address: 'someone@example.com' });
    assert.deepEqual(
      [...(provider.sent[0]?.to ?? [])],
      [{ address: 'ada@example.com', name: 'Ada' }],
    );
  });

  it('puts the data and the site settings in front of the template', async () => {
    const provider = createMemoryMailProvider();
    // A named theme the site has chosen, which is where a message that is not
    // the package's comes from (decision-15).
    const themesDir = await dir('geekity-mail-themes-');
    await mkdir(path.join(themesDir, 'fixture', 'mail'), { recursive: true });
    await writeFile(
      path.join(themesDir, 'fixture', 'theme.json'),
      JSON.stringify({ name: 'Fixture', kind: 'site' }),
      'utf8',
    );
    await writeFile(
      path.join(themesDir, 'fixture', 'mail', 'greeting.txt.njk'),
      'Hello {{ name }}, from {{ site.title }} at {{ baseUrl }}.\n',
      'utf8',
    );

    const contentDir = await dir('geekity-mail-content-');
    await writeSiteJson({
      contentDir,
      settings: { ...DEFAULT_SITE_SETTINGS, title: 'A Site', theme: 'fixture' },
    });

    const mail = createMailService({
      config: {
        baseUrl: 'https://blog.example',
        contentDir,
        dataDir: await dir('geekity-mail-data-'),
        themesDir,
        watch: false,
      },
      provider,
      logger: new Log(),
    });

    await mail.send({ to: 'ada@example.com', template: 'greeting', data: { name: 'Ada' } });

    assert.equal(provider.sent[0]?.text.trim(), 'Hello Ada, from A Site at https://blog.example.');
  });

  it('sends a message the caller built itself, with no template at all', async () => {
    const provider = createMemoryMailProvider();
    const { mail } = await site({ provider });

    const result = await mail.sendRaw({
      to: 'ada@example.com',
      subject: 'Straight through',
      text: 'Words.',
    });

    assert.equal(result.ok, true);
    assert.equal(provider.sent[0]?.subject, 'Straight through');
    assert.equal(provider.sent[0]?.html, undefined);
  });
});

describe('a send that fails (AC #4)', () => {
  it('is tried again after a backoff and logged every time', async () => {
    const log = new Log();
    const provider = createMemoryMailProvider();
    provider.failNext(2, 'the server said no');
    const { mail, waited } = await site({ provider, log, attempts: 3 });

    const result = await mail.send({ to: 'ada@example.com', template: 'test' });

    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3);
    assert.equal(provider.sent.length, 1);

    // Waited between the tries, and for longer each time.
    assert.deepEqual(waited, [1000, 2000]);

    // One line per attempt, and the last one carries the provider's message id.
    assert.equal(log.lines.length, 3);
    assert.match(log.lines[0] ?? '', /warn:.*attempt 1 of 3.*the server said no/);
    assert.match(log.lines[1] ?? '', /warn:.*attempt 2 of 3.*the server said no/);
    assert.match(log.lines[2] ?? '', /info:.*attempt 3 of 3/);
    assert.match(log.lines[2] ?? '', new RegExp(provider.sent[0]?.subject ?? ''));
    assert.match(log.lines[2] ?? '', /memory-1/);
  });

  it('gives up after the last attempt and says why, without throwing', async () => {
    const log = new Log();
    const provider = createMemoryMailProvider();
    provider.failNext(5, 'the server said no');
    const { mail } = await site({ provider, log, attempts: 2 });

    const result = await mail.send({ to: 'ada@example.com', template: 'test' });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.attempts, 2);
    assert.match(result.error ?? '', /the server said no/);

    assert.equal(log.lines.filter((line) => line.startsWith('warn:')).length, 3);
    assert.match(log.lines.at(-1) ?? '', /gave up/i);
  });

  it('does not lose the message when the template will not render', async () => {
    const log = new Log();
    const { mail } = await site({ provider: createMemoryMailProvider(), log });

    const result = await mail.send({ to: 'ada@example.com', template: 'nothing-like-this' });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /nothing-like-this/);
    assert.match(log.lines.at(-1) ?? '', /warn:/);
  });
});

describe('the queue', () => {
  it('sends one message at a time, whatever order they were asked in', async () => {
    const order: string[] = [];
    let inFlight = 0;

    const provider: MailProvider = {
      name: 'memory',
      async deliver(message: OutgoingMail) {
        inFlight += 1;
        assert.equal(inFlight, 1, 'two messages were in flight at once');
        order.push(`start ${message.subject}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end ${message.subject}`);
        inFlight -= 1;
        return { messageId: message.subject };
      },
    };

    const { mail } = await site({ provider });

    const first = mail.sendRaw({ to: 'a@example.com', subject: 'one', text: '.' });
    const second = mail.sendRaw({ to: 'b@example.com', subject: 'two', text: '.' });

    await Promise.all([first, second]);
    await mail.settled();

    assert.deepEqual(order, ['start one', 'end one', 'start two', 'end two']);
  });

  it('settles even when a send failed, so closing the site never hangs', async () => {
    const provider = createMemoryMailProvider();
    provider.failNext(9);
    const { mail } = await site({ provider, attempts: 1 });

    void mail.send({ to: 'ada@example.com', template: 'test' });
    await mail.settled();

    assert.equal(provider.sent.length, 0);
  });
});
