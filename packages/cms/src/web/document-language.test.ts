/**
 * A post or a page in a language other than the site's (TASK-154 AC #2): the
 * default theme marks its article with `lang`, so a screen reader pronounces
 * it and a browser offers to translate it, and says nothing for one in the
 * site's own language, which the `<html lang>` already names.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en' }),
  'posts/bonjour.md':
    "---\ntitle: Bonjour\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/bonjour/\nlang: fr-ca\n---\n\nUn billet.\n",
  'posts/hello.md':
    "---\ntitle: Hello\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/hello/\nlang: en\n---\n\nA post.\n",
  'posts/garbled.md':
    "---\ntitle: Garbled\ndate: '2026-08-31T09:00:00Z'\npermalink: /2026/08/garbled/\nlang: not a tag\n---\n\nA post.\n",
  'pages/a-propos.md': '---\ntitle: À propos\npermalink: /a-propos/\nlang: fr\n---\n\nNous.\n',
};

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-lang-content-');
  const dataDir = await box.dir('geekity-lang-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return box.open({ contentDir, dataDir, now: () => new Date('2026-09-13T12:00:00Z') });
}

async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** Every `<article …>` opening tag on a page, in order. */
function articles(html: string): string[] {
  return [...html.matchAll(/<article\b[^>]*>/g)].map((match) => match[0]);
}

describe('the article lang (TASK-154 AC #2)', () => {
  it('marks a post in another language, in its canonical spelling', async () => {
    const html = await body(await site(), '/2026/09/bonjour/');

    assert.match(html, /<html lang="en">/);
    assert.deepEqual(articles(html), ['<article class="blog-post h-entry" lang="fr-CA">']);
  });

  it('marks a page in another language', async () => {
    const html = await body(await site(), '/a-propos/');

    assert.deepEqual(articles(html), ['<article class="blog-post h-entry" lang="fr">']);
  });

  it('leaves out a lang that is the site’s, or that is no language tag', async () => {
    const cms = await site();

    assert.deepEqual(articles(await body(cms, '/2026/09/hello/')), [
      '<article class="blog-post h-entry">',
    ]);
    assert.deepEqual(articles(await body(cms, '/2026/08/garbled/')), [
      '<article class="blog-post h-entry">',
    ]);
  });

  it('marks each post in a listing by its own language', async () => {
    const html = await body(await site(), '/');

    assert.deepEqual(articles(html), [
      '<article class="feed-item h-entry" lang="fr-CA">',
      '<article class="feed-item h-entry">',
      '<article class="feed-item h-entry">',
    ]);
  });

  it('marks each search result by its own language', async () => {
    const html = await body(await site(), '/search/?q=bonjour');

    assert.deepEqual(articles(html), ['<article class="search-result h-entry" lang="fr-CA">']);
  });
});
