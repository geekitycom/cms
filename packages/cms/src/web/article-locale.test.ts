/**
 * The dates inside an article follow the article's language (TASK-189): a
 * post that says `lang: fr` on an `en` site is published "2 septembre 2026",
 * while everything around it (the listing's other entries, the archive
 * headings, the footer) stays in the site's locale. Asserted over HTTP
 * against the default theme, because the markup is the behaviour.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** A post the replies answer, whose preview is already stored, so nothing is fetched. */
const TARGET = 'https://them.example/2026/07/tomatoes/';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  'posts/bonjour.md':
    "---\ntitle: Bonjour\ndate: '2026-09-02T09:00:00Z'\nupdated: '2026-09-05T09:00:00Z'\npermalink: /2026/09/bonjour/\nlang: fr\n---\n\nUn billet.\n",
  'posts/salut.md':
    "---\ndate: '2026-08-20T09:00:00Z'\npermalink: /2026/08/salut/\nlang: fr\n---\n\nUne note.\n",
  'posts/hello.md':
    "---\ntitle: Hello\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/hello/\n---\n\nA post.\n",
  'posts/reponse.md': `---\ntitle: Réponse\ndate: '2026-08-10T09:00:00Z'\npermalink: /2026/08/reponse/\nin-reply-to: ${TARGET}\nlang: fr\n---\n\nD’accord.\n`,
  'posts/reply.md': `---\ntitle: Reply\ndate: '2026-08-09T09:00:00Z'\npermalink: /2026/08/reply/\nin-reply-to: ${TARGET}\n---\n\nAgreed.\n`,
  '_data/replyContexts.json': JSON.stringify({
    [TARGET]: { name: 'Tomatoes', published: '2026-07-14T12:00:00Z' },
  }),
  'pages/archives.md':
    "---\ntitle: Archives\ndate: '2026-08-01T09:00:00Z'\npermalink: /archives/\nlang: fr\narchive: true\n---\n\nTout.\n",
};

const FRENCH =
  /\b(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/;

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-article-locale-content-');
  const dataDir = await box.dir('geekity-article-locale-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({ contentDir, dataDir, now: () => new Date('2026-09-13T12:00:00Z') });
});

async function body(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** Each `<article>` on a page, whole, with its `lang` when it has one. */
function articles(html: string): { lang: string | undefined; html: string }[] {
  return [...html.matchAll(/<article\b([^>]*)>[\s\S]*?<\/article>/g)].map((match) => ({
    lang: /\blang="([^"]+)"/.exec(match[1] ?? '')?.[1],
    html: match[0],
  }));
}

/** The page with every article marked `lang="fr"` cut out. */
function outsideFrench(html: string): string {
  return articles(html)
    .filter((article) => article.lang === 'fr')
    .reduce((rest, article) => rest.replace(article.html, ''), html);
}

describe('dates inside an article in another language (TASK-189 AC #1)', () => {
  it('writes a post’s Published and Updated dates in its language', async () => {
    const [article] = articles(await body('/2026/09/bonjour/'));

    assert.equal(article?.lang, 'fr');
    assert.match(article.html, /Published 2 septembre 2026<\/time>/);
    assert.match(article.html, /Updated 5 septembre 2026<\/time>/);
  });

  it('writes the hidden heading of a note without a title in its language', async () => {
    const [article] = articles(await body('/2026/08/salut/'));

    assert.match(article?.html ?? '', /<h1 class="screen-reader-text">Note, 20 août 2026<\/h1>/);
  });

  it('writes a page’s Published date in its language', async () => {
    const [article] = articles(await body('/archives/'));

    assert.match(article?.html ?? '', /Published 1 août 2026<\/time>/);
  });

  it('writes each entry’s kicker date in a listing in that entry’s language', async () => {
    const dates = articles(await body('/')).map(
      (article) => /<time class="feed-date[^>]*>([^<]+)<\/time>/.exec(article.html)?.[1],
    );

    assert.deepEqual(dates, [
      '2 septembre 2026',
      '1 September 2026',
      '20 août 2026',
      '10 août 2026',
      '9 August 2026',
    ]);
  });

  it('writes the date of the post a reply answers in the reply’s language', async () => {
    const [entry] = articles(await body('/2026/08/reponse/'));
    assert.match(entry?.html ?? '', /<time class="dt-published"[^>]*>14 juillet 2026<\/time>/);

    const cited = articles(await body('/')).map(
      (article) => /<time class="dt-published"[^>]*>([^<]+)<\/time>/.exec(article.html)?.[1],
    );
    assert.deepEqual(cited.filter(Boolean), ['14 juillet 2026', '14 July 2026']);
  });

  it('writes a search result’s date in its language', async () => {
    const html = await body('/search/?q=billet');
    const [article] = articles(html);

    assert.equal(article?.lang, 'fr');
    assert.match(
      article.html,
      /<time class="feed-date dt-published"[^>]*>2 septembre 2026<\/time>/,
    );
  });
});

describe('dates outside the article (TASK-189 AC #2)', () => {
  it('stay in the site locale on every page that carries a French article', async () => {
    for (const pathname of [
      '/',
      '/2026/09/bonjour/',
      '/2026/08/salut/',
      '/2026/08/reponse/',
      '/archives/',
    ]) {
      const html = await body(pathname);

      assert.ok(
        articles(html).some((article) => article.lang === 'fr'),
        pathname,
      );
      assert.doesNotMatch(outsideFrench(html), FRENCH, pathname);
    }
  });

  it('keep the archive’s month headings in the site locale on a French page', async () => {
    const html = await body('/archives/');

    assert.match(html, /<h2>September 2026<\/h2>/);
    assert.match(html, /<h2>August 2026<\/h2>/);
    assert.doesNotMatch(html, /<h2>[^<]*(?:septembre|août)/);
    assert.match(html, /<section class="archive" lang="en">/);
  });

  it('leave a post that names no language in the site locale', async () => {
    const [article] = articles(await body('/2026/09/hello/'));

    assert.equal(article?.lang, undefined);
    assert.match(article?.html ?? '', /Published 1 September 2026<\/time>/);
  });
});
