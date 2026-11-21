import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createThemeSource } from '../theme/themes.ts';
import type { ThemeSource } from '../theme/themes.ts';
import { createMailTemplates, mailTemplateFiles } from './mail-templates.ts';
import { systemClock } from '../util/clock.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A site whose chosen theme holds whatever files the caller names, as the
 * source the mail templates read it through. No files is a site on the
 * packaged theme.
 */
async function themeSource(files: Record<string, string> = {}): Promise<ThemeSource> {
  const themesDir = await mkdtemp(path.join(tmpdir(), 'geekity-mail-themes-'));
  dirs.push(themesDir);
  const chosen = Object.keys(files).length === 0 ? '' : 'fixture';

  if (chosen !== '') {
    for (const [name, contents] of Object.entries({
      'theme.json': JSON.stringify({ name: 'Fixture', kind: 'site' }),
      ...files,
    })) {
      const file = path.join(themesDir, chosen, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, 'utf8');
    }
  }

  return createThemeSource({ themesDir, chosen: () => chosen });
}

const SITE = { title: 'A Site', author: 'Ada' };

describe('mail templates', () => {
  it('names the three files one message is built from', () => {
    assert.deepEqual(mailTemplateFiles('test'), {
      subject: 'mail/test.subject.njk',
      text: 'mail/test.txt.njk',
      html: 'mail/test.html.njk',
    });
  });

  it('renders the packaged test message', async () => {
    const templates = createMailTemplates({
      themes: await themeSource(),
      baseUrl: 'https://blog.example',
      now: systemClock,
    });

    const message = templates.render('test', {
      site: SITE,
      baseUrl: 'https://blog.example',
      now: systemClock,
    });

    assert.match(message.subject, /A Site/);
    assert.equal(message.subject.includes('\n'), false);
    assert.match(message.text, /A Site/);
    assert.ok(message.html !== undefined);
    assert.match(message.html, /<p>/);
  });

  it('lets a theme override one part of a message and keep the rest (AC #6)', async () => {
    const themes = await themeSource({
      'mail/test.txt.njk': 'The theme wrote this for {{ site.title }}.\n',
    });

    const message = createMailTemplates({
      themes,
      baseUrl: 'https://blog.example',
      now: systemClock,
    }).render('test', { site: SITE, baseUrl: 'https://blog.example', now: systemClock });

    assert.equal(message.text.trim(), 'The theme wrote this for A Site.');
    // The subject and the HTML twin still come from the package.
    assert.match(message.subject, /A Site/);
    assert.ok(message.html !== undefined);
  });

  it('lets a theme add a message the package does not ship', async () => {
    const themes = await themeSource({
      'mail/welcome.subject.njk': 'Welcome to {{ site.title }}\n',
      'mail/welcome.txt.njk': 'Hello, {{ name }}.\n',
    });

    const message = createMailTemplates({
      themes,
      baseUrl: 'https://blog.example',
      now: systemClock,
    }).render('welcome', { site: SITE, name: 'Ada' });

    assert.equal(message.subject, 'Welcome to A Site');
    assert.equal(message.text.trim(), 'Hello, Ada.');
    // No HTML twin was written, so the message is plain text and says so.
    assert.equal(message.html, undefined);
  });

  it('says which template is missing rather than sending an empty message', async () => {
    const templates = createMailTemplates({
      themes: await themeSource(),
      baseUrl: 'https://blog.example',
      now: systemClock,
    });

    assert.throws(() => templates.render('nothing-like-this'), /mail\/nothing-like-this\.txt\.njk/);
  });

  it('has the site filters, so a template may write an absolute URL', async () => {
    const themes = await themeSource({
      'mail/link.txt.njk': '{{ "/admin/" | absoluteUrl }}\n',
    });

    const message = createMailTemplates({
      themes,
      baseUrl: 'https://blog.example',
      now: systemClock,
    }).render('link', {});

    assert.equal(message.text.trim(), 'https://blog.example/admin/');
  });

  describe('the packaged plain text bodies', () => {
    async function packaged(name: string, context: Record<string, unknown>): Promise<string> {
      return createMailTemplates({
        themes: await themeSource(),
        baseUrl: 'https://blog.example',
        now: systemClock,
      }).render(name, { site: SITE, baseUrl: 'https://blog.example', ...context }).text;
    }

    const comment = {
      source: 'comment',
      author: 'Grace',
      website: 'https://grace.example/',
      url: 'https://grace.example/2026/09/about-that/',
      submitted: '4 September 2026',
      text: 'Good post.',
      kind: 'reply',
    };
    const pending = {
      post: { title: 'Hello', url: 'https://blog.example/hello/' },
      actions: [{ label: 'Approve', url: 'https://blog.example/a' }],
      queueUrl: 'https://blog.example/admin/comments',
    };

    it('puts each header of a moderation notice on its own line', async () => {
      const text = await packaged('comment-pending', { ...pending, comment });

      assert.ok(
        text.includes(
          'From: Grace\nSite: https://grace.example/\nPage: https://grace.example/2026/09/about-that/\nWhen: 4 September 2026\n\nGood post.',
        ),
        text,
      );
    });

    it('puts the headers a moderation notice has on their own lines when some are missing', async () => {
      const text = await packaged('comment-pending', {
        ...pending,
        comment: { ...comment, website: null, url: null },
      });

      assert.ok(text.includes('From: Grace\nWhen: 4 September 2026\n\nGood post.'), text);
    });

    const notice = {
      key: 'https://remote.example/users/grace#likes/1',
      actor: { name: 'Grace', url: 'https://remote.example/@grace' },
      action: 'quoted',
      post: { title: 'Hello', url: 'https://blog.example/hello/' },
      text: 'Worth reading.',
      url: 'https://remote.example/@grace/99',
    };

    it('says who did what to which post in a fediverse notice, each link on its own line', async () => {
      const text = await packaged('fediverse-notice', { event: 'quotes', notice });

      assert.ok(
        text.startsWith(
          'Grace quoted “Hello”.\n\nWho: https://remote.example/@grace\nPost: https://blog.example/hello/\nLink: https://remote.example/@grace/99\n\nWorth reading.\n',
        ),
        text,
      );
    });

    it('leaves out what a fediverse notice does not have', async () => {
      const text = await packaged('fediverse-notice', {
        event: 'reactions',
        notice: { key: 'k', actor: { name: 'Grace' }, action: 'liked', post: notice.post },
      });

      assert.ok(
        text.startsWith('Grace liked “Hello”.\n\nPost: https://blog.example/hello/\n\n--'),
        text,
      );
    });

    const bodies: Record<string, Record<string, unknown>> = {
      'comment-digest': {
        sections: [
          {
            event: 'comments',
            label: 'Waiting for review',
            total: 1,
            more: 0,
            items: [{ ...pending, comment }],
            url: pending.queueUrl,
          },
        ],
        settingsUrl: 'https://blog.example/admin/settings/notifications',
      },
      'comment-pending': { ...pending, comment },
      'comment-published': {
        post: pending.post,
        comment,
        link: 'https://blog.example/hello/#comment-0123456789abcdef',
      },
      'comment-reply': {
        post: pending.post,
        reply: { author: 'Ada', url: 'https://blog.example/hello/#c2', text: 'Thanks.' },
        comment: { text: 'Good post.' },
        unsubscribeUrl: 'https://blog.example/u',
      },
      'contact-message': {
        from: { name: 'Grace', email: 'grace@example.com' },
        page: { title: 'Contact', url: 'https://blog.example/contact/' },
        message: { received: '4 September 2026', text: 'Hi.' },
        messagesUrl: 'https://blog.example/admin/messages',
      },
      'email-changed': { username: 'ada', email: 'ada@example.com' },
      'fediverse-notice': {
        event: 'reactions',
        notice,
        settingsUrl: 'https://blog.example/admin/settings/notifications',
      },
      'password-changed': { username: 'ada' },
      'password-reset': {
        username: 'ada',
        resetUrl: 'https://blog.example/r',
        expiresInHours: 1,
      },
      test: {},
    };
    for (const [name, context] of Object.entries(bodies)) {
      it(`starts the ${name} body on its first line of text`, async () => {
        const text = await packaged(name, context);

        assert.match(text, /^\S/, JSON.stringify(text.slice(0, 40)));
      });
    }

    it('has a body test for every packaged plain text template', async () => {
      const names = (await readdir(path.join(import.meta.dirname, '../../themes/default/mail')))
        .filter((file) => file.endsWith('.txt.njk'))
        .map((file) => file.slice(0, -'.txt.njk'.length));

      assert.deepEqual(names.sort(), Object.keys(bodies).sort());
    });

    for (const subject of ['Hello there', undefined]) {
      it(`leaves a blank line between a contact message's headers and its words${subject === undefined ? ' when it has no subject' : ''}`, async () => {
        const text = await packaged('contact-message', {
          from: { name: 'Grace', email: 'grace@example.com' },
          page: { title: 'Contact', url: 'https://blog.example/contact/' },
          message: { received: '4 September 2026', subject, text: 'Hi.' },
          messagesUrl: 'https://blog.example/admin/messages',
        });

        const headers =
          subject === undefined
            ? 'When: 4 September 2026'
            : `When: 4 September 2026\nSubject: ${subject}`;
        assert.ok(text.includes(`${headers}\n\nHi.`), text);
      });
    }
  });
});
