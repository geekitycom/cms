import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createThemeSource } from '../web/themes.ts';
import type { ThemeSource } from '../web/themes.ts';
import { createMailTemplates, mailTemplateFiles } from './templates.ts';

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
    });

    const message = templates.render('test', { site: SITE, baseUrl: 'https://blog.example' });

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

    const message = createMailTemplates({ themes, baseUrl: 'https://blog.example' }).render(
      'test',
      { site: SITE, baseUrl: 'https://blog.example' },
    );

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

    const message = createMailTemplates({ themes, baseUrl: 'https://blog.example' }).render(
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
      themes: await themeSource(),
      baseUrl: 'https://blog.example',
    });

    assert.throws(() => templates.render('nothing-like-this'), /mail\/nothing-like-this\.txt\.njk/);
  });

  it('has the site filters, so a template may write an absolute URL', async () => {
    const themes = await themeSource({
      'mail/link.txt.njk': '{{ "/admin/" | absoluteUrl }}\n',
    });

    const message = createMailTemplates({ themes, baseUrl: 'https://blog.example' }).render(
      'link',
      {},
    );

    assert.equal(message.text.trim(), 'https://blog.example/admin/');
  });
});
