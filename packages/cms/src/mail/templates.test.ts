import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createMailTemplates, mailTemplateFiles } from './templates.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A theme directory of its own, with whatever files the caller names in it. */
async function themeDir(files: Record<string, string> = {}): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), 'geekity-mail-theme-'));
  dirs.push(created);

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(created, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  return created;
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
      themeDir: await themeDir(),
      baseUrl: 'https://blog.example',
    });

    const message = templates.render('test', { site: SITE, baseUrl: 'https://blog.example' });

    assert.match(message.subject, /A Site/);
    assert.equal(message.subject.includes('\n'), false);
    assert.match(message.text, /A Site/);
    assert.ok(message.html !== undefined);
    assert.match(message.html, /<p>/);
  });

  it('lets a theme override one part of a message and keep the rest (AC #6)', async () => {
    const dir = await themeDir({
      'mail/test.txt.njk': 'The theme wrote this for {{ site.title }}.\n',
    });

    const message = createMailTemplates({ themeDir: dir, baseUrl: 'https://blog.example' }).render(
      'test',
      { site: SITE, baseUrl: 'https://blog.example' },
    );

    assert.equal(message.text.trim(), 'The theme wrote this for A Site.');
    // The subject and the HTML twin still come from the package.
    assert.match(message.subject, /A Site/);
    assert.ok(message.html !== undefined);
  });

  it('lets a theme add a message the package does not ship', async () => {
    const dir = await themeDir({
      'mail/welcome.subject.njk': 'Welcome to {{ site.title }}\n',
      'mail/welcome.txt.njk': 'Hello, {{ name }}.\n',
    });

    const message = createMailTemplates({ themeDir: dir, baseUrl: 'https://blog.example' }).render(
      'welcome',
      { site: SITE, name: 'Ada' },
    );

    assert.equal(message.subject, 'Welcome to A Site');
    assert.equal(message.text.trim(), 'Hello, Ada.');
    // No HTML twin was written, so the message is plain text and says so.
    assert.equal(message.html, undefined);
  });

  it('says which template is missing rather than sending an empty message', async () => {
    const templates = createMailTemplates({
      themeDir: await themeDir(),
      baseUrl: 'https://blog.example',
    });

    assert.throws(() => templates.render('nothing-like-this'), /mail\/nothing-like-this\.txt\.njk/);
  });

  it('has the site filters, so a template may write an absolute URL', async () => {
    const dir = await themeDir({
      'mail/link.txt.njk': '{{ "/admin/" | absoluteUrl }}\n',
    });

    const message = createMailTemplates({ themeDir: dir, baseUrl: 'https://blog.example' }).render(
      'link',
      {},
    );

    assert.equal(message.text.trim(), 'https://blog.example/admin/');
  });
});
